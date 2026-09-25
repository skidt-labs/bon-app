import { redirect, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import { mitgliederMitZaehlung } from '$lib/server/household';
import { mitgliederEinesHaushalts, type Rolle } from '$lib/server/haushalt/mitglieder';
import {
	einladungErzeugen,
	rolleSetzen,
	mitgliedEntfernen,
	LetzterVerwalter,
	MitgliedNichtGefunden,
	entfernenVorschau
} from '$lib/server/haushalt/einladungen';
import { darfGeteiltesVerwalten } from '$lib/server/zugriff/kontext';
import { VERSION } from '$lib/server/version';
import type { Actions, PageServerLoad } from './$types';

function istRolle(wert: FormDataEntryValue | null): wert is Rolle {
	return wert === 'verwalter' || wert === 'mitglied';
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	// Mandantentrennung: ausschliesslich der eigene Haushalt aus dem Zugriffskontext — nie
	// ein Parameter aus der URL, sonst koennte ein Nutzer fremde Haushalte erfragen.
	const { haushaltId } = locals.zugriff!;

	const [[household], grunddaten, rollen] = await Promise.all([
		db.select().from(households).where(eq(households.id, haushaltId)),
		mitgliederMitZaehlung(haushaltId),
		mitgliederEinesHaushalts(haushaltId)
	]);

	// Zwei getrennte Abfragen statt einer gemeinsamen: mitgliederMitZaehlung() lebt in
	// household.ts (unveraendert von Aufgabe 3), die Rolle kommt aus
	// mitgliederEinesHaushalts() in mitglieder.ts. Der Verbund passiert hier, in JS,
	// statt eine dritte, redundante Abfrage zu schreiben.
	const rolleVon = new Map(rollen.map((r) => [r.userId, r.rolle]));
	const members = grunddaten.map((m) => ({ ...m, rolle: rolleVon.get(m.id) ?? ('mitglied' as Rolle) }));

	/*
	 * Die Loeschzahlen gehoeren VOR den Klick, nicht in den Commit.
	 *
	 * `mitgliedEntfernen` loescht die privaten Bons (samt Bilddateien) und privaten
	 * Toepfe des Ausscheidenden unwiderruflich. Der Dialog sagte bis 18.09.2026 nur, dass
	 * die GETEILTEN Bons erhalten bleiben — was stimmt und die eigentliche Folge
	 * verschweigt. entfernenVorschau() gab es dafuer schon, sie war nur nirgends
	 * angeschlossen (Befund R21).
	 *
	 * Nur fuer Verwalter geladen: wer nicht entfernen darf, braucht die Zahlen nicht, und
	 * sie sagen etwas ueber PRIVATE Bestaende anderer aus.
	 */
	const darfVerwalten = darfGeteiltesVerwalten(locals.zugriff!);
	const vorschau = darfVerwalten
		? Object.fromEntries(
				await Promise.all(
					members
						.filter((m) => m.id !== locals.zugriff!.nutzerId)
						.map(async (m) => [m.id, await entfernenVorschau(locals.zugriff!, m.id)] as const)
				)
			)
		: {};

	return { household, members, darfVerwalten, vorschau, version: VERSION };
};

export const actions: Actions = {
	einladen: async ({ locals, request, url }) => {
		if (!locals.zugriff) return fail(401, { grund: 'Nicht angemeldet' });
		if (!darfGeteiltesVerwalten(locals.zugriff)) return fail(403, { grund: 'Keine Berechtigung' });

		const formData = await request.formData();
		const rolle = formData.get('rolle');
		if (!istRolle(rolle)) return fail(400, { grund: 'Ungueltige Rolle' });

		const { token, laeuftAbAm } = await einladungErzeugen(locals.zugriff, rolle);
		// Der Klartext verlaesst diese Aktion genau einmal und wird nirgends gespeichert
		// — weder in der Sitzung noch im Log. Wer den Link hat, kann dem Haushalt
		// beitreten.
		return { link: `${url.origin}/einladung/${token}`, laeuftAbAm };
	},

	rolle: async ({ locals, request }) => {
		if (!locals.zugriff) return fail(401, { grund: 'Nicht angemeldet' });
		if (!darfGeteiltesVerwalten(locals.zugriff)) return fail(403, { grund: 'Keine Berechtigung' });

		const formData = await request.formData();
		const zielUserId = formData.get('zielUserId');
		const rolle = formData.get('rolle');
		if (typeof zielUserId !== 'string' || !istRolle(rolle)) return fail(400, { grund: 'Ungueltige Eingabe' });

		try {
			await rolleSetzen(locals.zugriff, zielUserId, rolle);
		} catch (err) {
			if (err instanceof LetzterVerwalter) return fail(400, { grund: 'letzter-verwalter' });
			// Kein stiller Rueckfall auf "geaendert": traf das UPDATE keine Zeile (das
			// Mitglied gehoert nicht mehr zu diesem Haushalt), waere eine Erfolgsmeldung
			// eine Behauptung ueber etwas, das nicht passiert ist.
			if (err instanceof MitgliedNichtGefunden) return fail(404, { grund: 'unbekanntes-mitglied' });
			throw err;
		}
		return { geaendert: true };
	},

	entfernen: async ({ locals, request }) => {
		if (!locals.zugriff) return fail(401, { grund: 'Nicht angemeldet' });
		if (!darfGeteiltesVerwalten(locals.zugriff)) return fail(403, { grund: 'Keine Berechtigung' });

		const formData = await request.formData();
		const zielUserId = formData.get('zielUserId');
		if (typeof zielUserId !== 'string') return fail(400, { grund: 'Ungueltige Eingabe' });

		try {
			await mitgliedEntfernen(locals.zugriff, zielUserId);
		} catch (err) {
			if (err instanceof LetzterVerwalter) return fail(400, { grund: 'letzter-verwalter' });
			if (err instanceof MitgliedNichtGefunden) return fail(404, { grund: 'unbekanntes-mitglied' });
			throw err;
		}
		return { entfernt: true };
	}
};
