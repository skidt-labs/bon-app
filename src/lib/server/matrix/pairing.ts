import { createHash, randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { matrixPairingCodes, matrixPairingAttempts, matrixLinks, householdMembers } from '../db/schema';

/**
 * Ohne 0/O und 1/I/L: auf einem Handybildschirm sind die nicht auseinanderzuhalten,
 * und ein falsch abgetippter Code erzeugt einen Fehlversuch — also unnötigen Verdacht
 * und, ab genug davon, eine Sperre gegen den rechtmässigen Nutzer.
 */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LAENGE = 8;

/** 8 Zeichen aus 31 möglichen ≈ 39 Bit. Bei 10 Minuten Gültigkeit nicht erratbar. */
export function erzeugeCode(): string {
	let out = '';
	for (let i = 0; i < CODE_LAENGE; i++) {
		out += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
	}
	return out;
}

/**
 * Nur der Hash wird gespeichert. Wer den Klartext hat, kann sein Matrix-Konto an ein
 * fremdes App-Konto binden — er ist ein Zugangsmittel und wird so behandelt.
 * Normalisiert vorher, weil der Nutzer den Code im Chat abtippt.
 */
export function hashCode(code: string): string {
	return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** 10 Minuten. Lang genug zum Abtippen, kurz genug, dass ein liegengelassener Code verfällt. */
export const GUELTIGKEIT_MS = 10 * 60 * 1000;
export const MAX_FEHLVERSUCHE = 5;
export const VERSUCHSFENSTER_MS = 15 * 60 * 1000;

export type EinloeseErgebnis =
	| { ok: true; userId: string }
	| {
			ok: false;
			grund:
				| 'unbekannt'
				| 'abgelaufen'
				| 'verbraucht'
				// Befund R02: der Code ist gueltig, aber sein Besitzer gehoert gerade zu
				// keinem Haushalt (z. B. entfernt, siehe mitgliedEntfernen()) - ohne
				// diese Pruefung koennte er sich per Code erneut ins alte Setup einklinken.
				| 'kein_mitglied'
				| 'schon_verknuepft'
				| 'konto_schon_gekoppelt'
				| 'zu_viele_versuche'
				| 'fehler';
	  };

export async function codeAnlegen(userId: string): Promise<{ code: string; expiresAt: Date }> {
	const code = erzeugeCode();
	const expiresAt = new Date(Date.now() + GUELTIGKEIT_MS);
	await db.insert(matrixPairingCodes).values({ userId, codeHash: hashCode(code), expiresAt });
	// Der Klartext verlässt diese Funktion genau einmal und wird nirgends gespeichert.
	return { code, expiresAt };
}

export async function codeEinloesen(
	code: string,
	matrixUserId: string,
	jetzt: Date = new Date()
): Promise<EinloeseErgebnis> {
	try {
		// Zähler UND Code in EINER Transaktion: sonst entscheidet die Sperre auf einem
		// Stand, der beim Schreiben schon wieder veraltet ist. Gemessen (Korrekturrunde
		// 2): 20 gleichzeitige Fehlversuche liessen den Zähler vorher nur bis 2 statt
		// bis 5 steigen — dieselbe Fehlerklasse wie der Einlöse-Wettlauf oben, nur am
		// Zähler statt am Code.
		return await db.transaction(async (tx) => {
			// Legt die Zählerzeile an, falls sie fehlt, oder sperrt die vorhandene über
			// den UPDATE-Zweig von ON CONFLICT — und liefert in JEDEM Fall den Stand
			// zurück, auf dem gerade eine Sperre liegt. Kein anderer gleichzeitiger
			// Aufruf für denselben Absender kann diesen Wert mehr ändern, bevor diese
			// Transaktion committet oder zurückrollt.
			const [versuch] = await tx
				.insert(matrixPairingAttempts)
				.values({ matrixUserId, failedCount: 0, windowStartedAt: jetzt })
				.onConflictDoUpdate({
					target: matrixPairingAttempts.matrixUserId,
					set: { matrixUserId } // No-op-Update, nur um Sperre + RETURNING zu bekommen.
				})
				.returning({
					failedCount: matrixPairingAttempts.failedCount,
					windowStartedAt: matrixPairingAttempts.windowStartedAt
				});

			const fensterOffen =
				jetzt.getTime() - versuch.windowStartedAt.getTime() <= VERSUCHSFENSTER_MS;
			if (fensterOffen && versuch.failedCount >= MAX_FEHLVERSUCHE) {
				// Auch bei RICHTIGEM Code. Sonst wäre die Sperre ein Orakel, an dem sich
				// erraten liesse, wann ein Treffer dabei war.
				return { ok: false, grund: 'zu_viele_versuche' };
			}

			// FOR UPDATE sperrt die Codezeile: eine zweite gleichzeitige Einlösung
			// DESSELBEN Codes wartet hier bis zum Commit der ersten und sieht danach
			// usedAt gesetzt — statt an derselben Prüfung "gleichzeitig" vorbeizukommen
			// und den Code ein zweites Mal zu verbrauchen.
			const [zeile] = await tx
				.select()
				.from(matrixPairingCodes)
				.where(eq(matrixPairingCodes.codeHash, hashCode(code)))
				.for('update');

			if (!zeile) return fehlversuch(tx, matrixUserId, jetzt, versuch, fensterOffen, 'unbekannt');
			if (zeile.usedAt) {
				return fehlversuch(tx, matrixUserId, jetzt, versuch, fensterOffen, 'verbraucht');
			}
			if (zeile.expiresAt.getTime() < jetzt.getTime()) {
				// Abgelaufen zählt NICHT als Fehlversuch: das ist kein Rateversuch, sondern
				// ein Nutzer, der zu lang gebraucht hat. Ihn dafür zu sperren wäre absurd.
				return { ok: false, grund: 'abgelaufen' };
			}

			// Befund R02: ein Mitglied konnte sich vor seinem Ausschluss einen Code
			// erzeugen und sich nach `mitgliedEntfernen()` damit erneut koppeln — der
			// Code selbst kannte keine Mitgliedschaft, nur einen Nutzer. Diese Prüfung
			// ist die zweite von drei Schichten (Schicht 1: `mitgliedEntfernen()` räumt
			// offene Codes ab; Schicht 3, die eigentliche Absicherung: `nutzerZuMatrixId()`
			// löst über `household_members` auf, nicht über `users.household_id`).
			// GENAU HIER statt daneben: der Code ist an dieser Stelle bereits per
			// FOR UPDATE gesperrt und als gültig (nicht unbekannt/verbraucht/abgelaufen)
			// erkannt — die Prüfung reiht sich in dieselbe Fallunterscheidung ein, statt
			// eine zweite, unabhängige Transaktion drumherum zu bauen.
			const [mitgliedschaft] = await tx
				.select({ id: householdMembers.id })
				.from(householdMembers)
				.where(eq(householdMembers.userId, zeile.userId));
			if (!mitgliedschaft) {
				// Wie 'abgelaufen' KEIN Fehlversuch: der Code wurde richtig abgetippt, das
				// ist kein Rateversuch. Der Nutzer selbst kann nichts dafür beheben — sein
				// Konto gehört gerade zu keinem Haushalt.
				return { ok: false, grund: 'kein_mitglied' };
			}

			const [schonDa] = await tx
				.select()
				.from(matrixLinks)
				.where(eq(matrixLinks.matrixUserId, matrixUserId));
			if (schonDa) return { ok: false, grund: 'schon_verknuepft' };

			await tx.insert(matrixLinks).values({ userId: zeile.userId, matrixUserId });
			await tx
				.update(matrixPairingCodes)
				.set({ usedAt: jetzt })
				.where(eq(matrixPairingCodes.id, zeile.id));
			return { ok: true, userId: zeile.userId };
		});
	} catch (err) {
		// Gürtel und Hosenträger: FOR UPDATE serialisiert nur den Wettlauf um
		// DENSELBEN Code. Zwei verschiedene Codes, die gleichzeitig auf dasselbe
		// Matrix-Konto oder auf dasselbe App-Konto zielen, fängt erst das hier ab —
		// als ordentliches Ergebnis statt eines rohen Datenbankfehlers, auf den der
		// Bot mit gar keiner Antwort reagieren würde.
		const grund = eindeutigkeitsGrund(err);
		if (grund) return { ok: false, grund };

		// codeEinloesen darf UNTER KEINEN UMSTÄNDEN werfen: der Bot bekäme sonst gar
		// keine Antwort — die schlimmste Form eines Rückfallwerts, den niemand
		// bemerkt. 'unbekannt' wäre hier aber eine FALSCHE Behauptung: der Code könnte
		// richtig sein, wir wissen es nur gerade nicht, weil etwas auf unserer Seite
		// kaputt ist. Der echte Fehler (kann Endpunkte/Konfiguration nennen) geht nur
		// ins Log, nie an den Nutzer.
		console.error('[pairing] codeEinloesen: unerwarteter Fehler', err);
		return { ok: false, grund: 'fehler' };
	}
}

/**
 * Übersetzt eine verletzte Eindeutigkeitsbedingung auf matrix_links (Postgres
 * SQLSTATE 23505) in einen passenden Grund. `matrix_user_id` ist doppelt belegt:
 * dieses Matrix-Konto ist schon verknüpft. `user_id` ist doppelt belegt: das
 * APP-Konto trägt schon eine andere Verknüpfung — eine andere Auskunft, denn der
 * Nutzer muss die BESTEHENDE Verknüpfung in der App lösen, nicht einen neuen Code
 * holen.
 */
function eindeutigkeitsGrund(
	err: unknown
): 'schon_verknuepft' | 'konto_schon_gekoppelt' | undefined {
	if (!err || typeof err !== 'object' || (err as { code?: unknown }).code !== '23505') {
		return undefined;
	}
	const constraint = (err as { constraint?: unknown }).constraint;
	if (constraint === 'matrix_links_matrix_user_id_unique') return 'schon_verknuepft';
	if (constraint === 'matrix_links_user_id_unique') return 'konto_schon_gekoppelt';
	return undefined;
}

/**
 * Die Zählerzeile existiert an dieser Stelle immer schon — codeEinloesen() hat sie
 * gerade selbst per Upsert angelegt oder gesperrt, in DERSELBEN Transaktion. Ein
 * reines UPDATE genügt deshalb, kein zweiter Upsert.
 */
async function fehlversuch(
	client: Pick<typeof db, 'update'>,
	matrixUserId: string,
	jetzt: Date,
	versuch: { failedCount: number; windowStartedAt: Date },
	fensterOffen: boolean,
	grund: 'unbekannt' | 'verbraucht'
): Promise<EinloeseErgebnis> {
	await client
		.update(matrixPairingAttempts)
		.set(
			fensterOffen
				? { failedCount: versuch.failedCount + 1 }
				: { failedCount: 1, windowStartedAt: jetzt }
		)
		.where(eq(matrixPairingAttempts.matrixUserId, matrixUserId));
	return { ok: false, grund };
}
