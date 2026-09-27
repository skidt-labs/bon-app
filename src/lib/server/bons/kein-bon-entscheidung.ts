/**
 * „Doch ein Bon, lesen" (Entwurf docs/superpowers/specs/2026-09-27-kein-bon-design.md).
 *
 * Ein fehlgeschlagener Bon mit Kein-Bon-Hinweis wird neu eingereiht, diesmal OHNE
 * Vorpruefung — sonst scheiterte er gleich wieder an derselben Pruefung. Bei einem gelesenen
 * Bon faellt nur der Hinweis weg, wie „Eigener Einkauf" beim Doppel-Hinweis. Beide Wege
 * schreiben mit Bedingung auf den gelesenen Status: ein zweiter Klick trifft nichts mehr.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { bonLaden, bonReaktivieren, bonAlsFehlgeschlagenMarkieren } from '$lib/server/bons/liste';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { enqueueExtraction } from '$lib/server/queue/boss';
import { keinBonCode } from '$lib/bons/beanstandungen';

type Verbindung = typeof Db;
export type DochEinBonErgebnis = { ok: true } | { ok: false; status: 404 | 409; meldung: string };

const SCHON_ENTSCHIEDEN: DochEinBonErgebnis = {
	ok: false,
	status: 409,
	meldung: 'Dazu ist schon entschieden worden. Bitte die Seite neu laden.'
};

export async function dochEinBon(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	einreihen: (id: string) => Promise<void> = (id) => enqueueExtraction(id, { ohneVorpruefung: true })
): Promise<DochEinBonErgebnis> {
	const bon = await bonLaden(d, k, bonId);
	if (!bon) return { ok: false, status: 404, meldung: 'Bon nicht gefunden' };
	if (keinBonCode(bon.needsReviewReason) === null) return SCHON_ENTSCHIEDEN;

	if (bon.status === 'failed') {
		const reaktiviert = await bonReaktivieren(d, k, bon.id);
		if (!reaktiviert) return SCHON_ENTSCHIEDEN;
		try {
			await einreihen(bon.id);
		} catch (err) {
			// Wie beim Reprocess: ohne Job bliebe er fuer immer „wartet".
			await bonAlsFehlgeschlagenMarkieren(d, bon.id, err instanceof Error ? err.message : String(err));
		}
		return { ok: true };
	}

	// Nur ein ausgelesener Bon verliert hier bloss den Hinweis. Wartet er schon wieder (ein
	// zweiter Klick) oder liegt er im Papierkorb, ist nichts mehr zu entscheiden.
	if (bon.status !== 'review' && bon.status !== 'confirmed') return SCHON_ENTSCHIEDEN;

	const getroffen = await d
		.update(receipts)
		.set({
			// Nur die Kein-Bon-Codes heraus; nullif: ohne Beanstandung steht dort null, nie [].
			needsReviewReason: sql`nullif(${receipts.needsReviewReason} - 'kein_bon_leer'::text - 'kein_bon_ohne_preise'::text - 'kein_bon_kartenbeleg'::text, '[]'::jsonb)`
		})
		.where(and(eq(receipts.id, bon.id), eq(receipts.status, bon.status)))
		.returning({ id: receipts.id });
	return getroffen.length === 1 ? { ok: true } : SCHON_ENTSCHIEDEN;
}
