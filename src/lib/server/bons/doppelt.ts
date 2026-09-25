import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { DOPPEL_GRUND } from '$lib/bons/beanstandungen';

/**
 * Doppelte Bons erkennen — derselbe Einkauf, zweimal fotografiert.
 *
 * Warum nach INHALT und nicht nach Datei: die vier Doppel, die es beim Bau (23.09.2026)
 * gab, waren ausnahmslos ZWEI VERSCHIEDENE FOTOS desselben Papierbons — andere Groesse,
 * anderer Hash. Ein Vergleich der Bilddatei haette keinen davon gefunden. Deshalb prueft
 * der Worker NACH dem Auslesen, wenn Kaufzeit und Endsumme bekannt sind.
 *
 * Die Regel: gleiche Endsumme auf den Cent UND Kaufzeiten hoechstens fuenf Minuten
 * auseinander. Der Haendler gehoert bewusst NICHT dazu — ein verlesener Name liesse den
 * Doppel sonst durch, und zwei gleiche Summen auf den Cent binnen fuenf Minuten in zwei
 * Laeden kommen praktisch nicht vor. Belegt am Bestand: das Lidl-Paar vom 26.08. war
 * einmal als "LIDL" ohne zugeordneten Haendler gelesen, einmal als "Lidl". Die Toleranz,
 * weil die Texterkennung die Uhrzeit verliest: beim Lidl-Paar vom 05.08. stand einmal
 * 19:20, einmal 19:21.
 *
 * Entschieden wird NIE automatisch. Der Bon bekommt einen Hinweis, und ein Mensch sagt
 * „doppelt" oder „eigener Einkauf" — zwei gleiche Einkaeufe in derselben Minute gibt es,
 * selten, und ein still verworfener echter Einkauf faellt niemandem auf.
 *
 * Dieselbe Regel steht ein zweites Mal als SQL in der Migration, die den Bestand einmalig
 * markiert hat (drizzle/0028_doppelbons_markieren.sql). Wer sie hier aendert, aendert nur
 * die Zukunft — das ist gewollt, die Migration ist gelaufen.
 */

export const DOPPEL_TOLERANZ_MINUTEN = 5;

/** Der Code in `needs_review_reason` — definiert neben seinem Klartext. */
export { DOPPEL_GRUND };

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];
type Verbindung = typeof Db | Tx;

export function suchfenster(zeit: Date): { von: Date; bis: Date } {
	const spanne = DOPPEL_TOLERANZ_MINUTEN * 60_000;
	return { von: new Date(zeit.getTime() - spanne), bis: new Date(zeit.getTime() + spanne) };
}

/**
 * Das aelteste passende Original zu einem frisch ausgelesenen Bon — oder `null`.
 *
 * Verglichen wird NUR mit Bons, die der Hochladende sehen darf (eigene und geteilte).
 * Sonst verriete der Hinweis „sieht aus wie der Bon vom …" den privaten Bon eines anderen
 * Haushaltsmitglieds. Die hingenommene Luecke: fotografiert der Partner denselben Bon und
 * behaelt ihn privat, gibt es keinen Hinweis.
 *
 * Kandidaten sind nur ausgelesene Bons ('review', 'confirmed'). 'doppelt' faellt heraus —
 * ein verworfener Doppel ist kein Original. 'failed', 'pending', 'extracting' haben keine
 * Summe, mit der man vergleichen koennte.
 */
export async function vermutetesOriginal(
	d: Verbindung,
	neu: {
		id: string;
		householdId: string;
		uploadedBy: string;
		purchasedAt: Date | null;
		totalGrossCents: number | null;
	}
): Promise<string | null> {
	if (neu.totalGrossCents === null || neu.purchasedAt === null) return null;
	const { von, bis } = suchfenster(neu.purchasedAt);
	// Die Rolle spielt fuer die Sichtbarkeit keine Rolle (siehe zugriff/sichtbar.ts).
	const k: Zugriffskontext = { haushaltId: neu.householdId, nutzerId: neu.uploadedBy, rolle: 'mitglied' };
	const [treffer] = await d
		.select({ id: receipts.id })
		.from(receipts)
		.where(
			and(
				sichtbareBons(k),
				ne(receipts.id, neu.id),
				inArray(receipts.status, ['review', 'confirmed']),
				eq(receipts.totalGrossCents, neu.totalGrossCents),
				gte(receipts.purchasedAt, von),
				lte(receipts.purchasedAt, bis)
			)
		)
		.orderBy(asc(receipts.createdAt))
		.limit(1);
	return treffer?.id ?? null;
}

export type DoppelEntscheidung = 'doppelt' | 'eigenerEinkauf' | 'wiederherstellen';

/**
 * Die Entscheidung des Menschen. Jede ist EIN atomares UPDATE mit dem erlaubten
 * Ausgangszustand in der Bedingung — wie bei reprocess und confirm: zwei gleichzeitige
 * Klicks koennen nicht beide greifen. `false` heisst: keine Zeile getroffen (nicht
 * sichtbar oder falscher Zustand); der Aufrufer sagt dann, warum.
 *
 *  - doppelt:          review + Hinweis offen      → Status 'doppelt'
 *  - eigenerEinkauf:   review + Hinweis offen      → Hinweis weg, Bon bleibt in 'review'
 *  - wiederherstellen: 'doppelt'                   → zurueck nach 'review', MIT Hinweis —
 *                      wer es sich anders ueberlegt, muss danach „eigener Einkauf" sagen,
 *                      bevor er bestaetigen kann. Sonst waere Wiederherstellen ein
 *                      Schleichweg um die Bestaetigungssperre.
 */
export async function doppeltEntscheiden(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	entscheidung: DoppelEntscheidung
): Promise<boolean> {
	const dieser = and(eq(receipts.id, bonId), sichtbareBons(k));
	const hinweisOffen = and(eq(receipts.status, 'review'), isNotNull(receipts.vermutetesOriginalId));

	const getroffen =
		entscheidung === 'doppelt'
			? await d.update(receipts).set({ status: 'doppelt' }).where(and(dieser, hinweisOffen)).returning({ id: receipts.id })
			: entscheidung === 'eigenerEinkauf'
				? await d
						.update(receipts)
						.set({
							vermutetesOriginalId: null,
							// Nur den einen Code herausnehmen; die uebrigen Beanstandungen bleiben.
							// nullif: ohne Beanstandung steht dort null, nie ein leeres Array.
							needsReviewReason: sql`nullif(${receipts.needsReviewReason} - ${DOPPEL_GRUND}::text, '[]'::jsonb)`
						})
						.where(and(dieser, hinweisOffen))
						.returning({ id: receipts.id })
				: await d
						.update(receipts)
						.set({ status: 'review' })
						.where(and(dieser, eq(receipts.status, 'doppelt')))
						.returning({ id: receipts.id });
	return getroffen.length > 0;
}

/**
 * Was der Hinweis ueber das Original zeigt. Durch `sichtbareBons` geladen, nicht blind per
 * Id: hat sich die Sichtbarkeit seit dem Auslesen geaendert, zeigt der Hinweis nichts
 * mehr vom Original — nur noch, dass es eines gab.
 */
export async function originalKurz(d: Verbindung, k: Zugriffskontext, originalId: string) {
	const [o] = await d
		.select({
			id: receipts.id,
			merchantNameRaw: receipts.merchantNameRaw,
			purchasedAt: receipts.purchasedAt,
			totalGrossCents: receipts.totalGrossCents,
			status: receipts.status
		})
		.from(receipts)
		.where(and(eq(receipts.id, originalId), sichtbareBons(k)));
	return o ?? null;
}

/**
 * Fuer den Worker: das vermutete Original eines Bons, von dem nur die Id und die gerade
 * gelesenen Werte bekannt sind. Haushalt und Hochladender kommen aus der Datenbank — nicht
 * vom Aufrufer, damit niemand aus Versehen im falschen Haushalt sucht.
 */
export async function originalFuerNeuenBon(
	d: Verbindung,
	bonId: string,
	purchasedAt: Date | null,
	totalGrossCents: number | null
): Promise<string | null> {
	if (totalGrossCents === null || purchasedAt === null) return null;
	const [bon] = await d
		.select({ householdId: receipts.householdId, uploadedBy: receipts.uploadedBy })
		.from(receipts)
		.where(eq(receipts.id, bonId));
	if (!bon) return null;
	return vermutetesOriginal(d, { id: bonId, ...bon, purchasedAt, totalGrossCents });
}
