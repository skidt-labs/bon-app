import { redirect, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { exchangeCode } from '$lib/server/auth/oidc';
import { createSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { selbstbedienungLesen } from '$lib/server/betrieb/verwaltung';
import { users } from '$lib/server/db/schema';
import { oidcFehlerMeldung } from '$lib/server/auth/oidc-fehler';
import { erstanmeldungAnlegen, mitgliedschaftWiederherstellen } from '$lib/server/household';
import { mitgliedschaftLaden } from '$lib/server/haushalt/mitglieder';
import { EINLADUNG_TOKEN_COOKIE } from '$lib/server/haushalt/einladungen';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const codeVerifier = cookies.get('oidc_verifier');
	const state = cookies.get('oidc_state');
	// Vor aufraeumen() gelesen und gemerkt: der Wert wird erst ganz unten (Erfolgsfall)
	// wieder gebraucht, das Cookie selbst muss aber auf JEDEM Pfad weg, nicht nur dem
	// erfolgreichen — sonst leitet ein liegengebliebener Token eine spaetere, voellig
	// unabhaengige Anmeldung bis zu zehn Minuten spaeter ueberraschend zur Einladung um.
	// Review-Befund Fix-Runde 1: vorher stand das Aufraeumen nur im Erfolgszweig.
	const einladungToken = cookies.get(EINLADUNG_TOKEN_COOKIE);
	const aufraeumen = () => {
		cookies.delete('oidc_verifier', { path: '/' });
		cookies.delete('oidc_state', { path: '/' });
		cookies.delete(EINLADUNG_TOKEN_COOKIE, { path: '/' });
	};

	// Der Identitätsanbieter meldet Fehler NICHT über einen HTTP-Status, sondern über
	// Parameter an der Rückleitungs-URL. Ohne diese Prüfung fällt das in exchangeCode,
	// fliegt dort als AuthorizationResponseError heraus und der Nutzer bekommt einen
	// 500 samt Stacktrace zu sehen — ausgerechnet auf dem einen Fehlerpfad, den ein
	// Mensch tatsächlich erlebt. Genau so ist es am 14.09. zweimal passiert: der
	// OAuth-Provider hatte grant_types=[], Authentik antwortete mit invalid_request,
	// und die App zeigte einen Stacktrace statt zu sagen, was los ist.
	const fehlercode = url.searchParams.get('error');
	if (fehlercode) {
		console.warn('[auth] Anmeldung von der Anmeldestelle abgelehnt', {
			error: fehlercode,
			description: url.searchParams.get('error_description')
		});
		aufraeumen();
		const { status, text } = oidcFehlerMeldung(fehlercode);
		error(status, text);
	}

	if (!codeVerifier || !state) {
		aufraeumen();
		error(400, 'Anmeldung abgelaufen, bitte erneut versuchen');
	}

	let profile;
	try {
		profile = await exchangeCode(url, codeVerifier, state);
	} catch (err) {
		// Der Tausch kann auch ohne Fehlerparameter scheitern: abgelaufener Code,
		// abweichender state, nicht erreichbare Anmeldestelle. Der Originalfehler darf
		// nicht zum Nutzer — er kann Endpunkte und Konfiguration nennen. Nur ins Log.
		console.error('[auth] Code-Tausch fehlgeschlagen', err);
		aufraeumen();
		error(400, 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es noch einmal.');
	}
	aufraeumen();

	const [bestehenderNutzer] = await db
		.select()
		.from(users)
		.where(eq(users.oidcSub, profile.sub));
	let userId = bestehenderNutzer?.id;
	if (!userId) {
		/*
		 * Selbstbedienung aus: eine Erstanmeldung bekommt KEINEN eigenen Haushalt mehr.
		 *
		 * Die Ausnahme ist wichtig, sonst sperrt der Schalter genau die Leute aus, fuer
		 * die er nicht gedacht ist: wer eine Einladung hat, braucht trotzdem zuerst ein
		 * Konto und eine Sitzung, denn das Einloesen setzt beides voraus. Liegt das
		 * Einladungs-Cookie vor, laeuft die Anlage also weiter — der eigene Haushalt ist
		 * dann ohnehin nur eine Zwischenstation und wird beim Einloesen wieder entfernt.
		 */
		if (!(await selbstbedienungLesen()) && !cookies.get(EINLADUNG_TOKEN_COOKIE)) {
			error(
				403,
				'Für diese Instanz braucht es eine Einladung. Bitte wende dich an die Person, die sie betreibt.'
			);
		}
		// Der Haushalt muss vor dem Nutzer stehen (users.household_id ist NOT NULL),
		// die Mitgliedschaft nach ihm (household_members.user_id) —
		// erstanmeldungAnlegen() fasst das in einer Transaktion zusammen. Bliebe das
		// in der Route verteilt, waere die Reihenfolge eine Sache der Aufmerksamkeit
		// statt eine des Codes, und ein Abbruch in der Mitte hinterliesse einen
		// Nutzer, der sich nie wieder anmelden kann.
		try {
			({ userId } = await erstanmeldungAnlegen(profile));
		} catch (err) {
			// Derselbe Fehlerpfad wie beim Code-Tausch oben: ein roher 500 aus der
			// Datenbank waere derselbe Vorfall wie am 14.09., nur an dieser Stelle.
			console.error('[auth] Erstanmeldung fehlgeschlagen', err);
			error(500, 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es noch einmal.');
		}
	} else {
		// Review-Befund Fix-Runde 2: ein bestehender Nutzer wurde hier bisher OHNE
		// Pruefung auf eine Mitgliedschaft durchgewinkt. mitgliedEntfernen() entfernt
		// genau diese Mitgliedschaft und laesst den Nutzer bewusst bestehen — traf ihn
		// das, fand validateSession() gleich darauf keine Mitgliedschaft mehr, lieferte
		// keine Sitzung, und jede Seite warf ihn zurueck zur Anmeldung: dauerhaft im
		// Kreis, exakt der Zustand, den der Kommentar oben fuer die Erstanmeldung
		// verhindern soll — nur fuer den anderen Fall. Die Regel gilt fuer JEDE
		// erfolgreiche Anmeldung: sie endet mit genau einer Mitgliedschaft. Fehlt sie,
		// bekommt der Nutzer dieselbe Behandlung wie eine Erstanmeldung, nur ohne sich
		// selbst neu anzulegen — das macht ihn wieder handlungsfaehig, insbesondere
		// faehig, eine neue Einladung anzunehmen (die setzt ebenfalls eine Sitzung
		// voraus, die es ohne Mitgliedschaft nicht gibt).
		const mitgliedschaft = await mitgliedschaftLaden(userId);
		if (!mitgliedschaft) {
			try {
				await mitgliedschaftWiederherstellen(userId, profile.name);
			} catch (err) {
				console.error('[auth] Wiederherstellung der Mitgliedschaft fehlgeschlagen', err);
				error(500, 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es noch einmal.');
			}
		}
	}

	const session = await createSession(userId);
	cookies.set(SESSION_COOKIE, session.id, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		expires: session.expiresAt
	});

	// Derselbe Umweg wie oidc_verifier/oidc_state: /einladung/[token] legt dieses Cookie
	// an, wenn beim Aufruf einer Einladung noch niemand angemeldet war, und erwartet nach
	// der Anmeldung eine Rueckleitung dorthin statt nach '/'. Der Wert wurde oben vor dem
	// Loeschen gemerkt — `aufraeumen()` hat das Cookie selbst laengst entfernt.
	if (einladungToken) {
		redirect(302, `/einladung/${einladungToken}`);
	}

	redirect(302, '/');
};
