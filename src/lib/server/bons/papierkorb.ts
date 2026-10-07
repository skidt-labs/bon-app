/**
 * Der Papierkorb (Entwurf docs/superpowers/specs/2026-09-27-papierkorb-design.md).
 *
 * Ein verworfener Bon hat den Status 'verworfen' und merkt sich, was er vorher war. 30 Tage
 * laesst er sich zurueckholen, danach loescht ihn der Worker endgueltig (papierkorbLeeren).
 * Jede Schreibung prueft den Status, den sie gelesen hat, im WHERE selbst: zwei gleichzeitige
 * Klicks duerfen weder zweimal verwerfen noch den Vorstatus mit 'verworfen' ueberschreiben.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts } from '$lib/server/db/schema';
import { bonLaden, bonAlsFehlgeschlagenMarkieren, type ReceiptStatus } from '$lib/server/bons/liste';
import { darfBonVerwerfen, type Zugriffskontext } from '$lib/server/zugriff/kontext';
import { enqueueExtraction } from '$lib/server/queue/boss';
import { loescheBilder } from '$lib/server/storage/images';
import { PAPIERKORB_TAGE } from '$lib/bons/papierkorb';
import { DOPPEL_GRUND } from '$lib/bons/beanstandungen';

type Verbindung = typeof Db;
type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];
/** `brauchtRueckfrage`: die Seite soll nachfragen und dann mit `bestaetigtWegnehmen` wiederkommen. */
export type PapierkorbFehler = { ok: false; status: 403 | 404 | 409; meldung: string; brauchtRueckfrage?: true };
export type PapierkorbErgebnis = { ok: true } | PapierkorbFehler;
/** `status` ist der Zielstatus; `eingereiht` sagt, ob ein Leseauftrag in der Warteschlange steht. */
export type ZurueckholErgebnis = { ok: true; eingereiht: boolean; status: ReceiptStatus } | PapierkorbFehler;

const NICHT_GEFUNDEN: PapierkorbFehler = { ok: false, status: 404, meldung: 'Bon nicht gefunden' };
const NICHT_BERECHTIGT: PapierkorbFehler = {
	ok: false,
	status: 403,
	meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.'
};
const GEAENDERT: PapierkorbFehler = {
	ok: false,
	status: 409,
	meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.'
};

/** Ein beim Lesen verworfener Bon (oder einer ohne gemerkten Vorstatus) wird neu gelesen. */
export function zielstatusBeimWiederherstellen(vorher: ReceiptStatus | null): ReceiptStatus {
	if (vorher === null || vorher === 'pending' || vorher === 'extracting' || vorher === 'verworfen') return 'pending';
	return vorher;
}

type Bon = NonNullable<Awaited<ReturnType<typeof bonLaden>>>;

async function berechtigterBon(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string
): Promise<{ bon: Bon; fehler: null } | { bon: null; fehler: PapierkorbFehler }> {
	const bon = await bonLaden(d, k, bonId);
	if (!bon) return { bon: null, fehler: NICHT_GEFUNDEN };
	if (!darfBonVerwerfen(k, bon.uploadedBy)) return { bon: null, fehler: NICHT_BERECHTIGT };
	return { bon, fehler: null };
}

export async function inPapierkorbLegen(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	bestaetigtWegnehmen: boolean
): Promise<PapierkorbErgebnis> {
	const r = await berechtigterBon(d, k, bonId);
	if (r.bon === null) return r.fehler;
	const { bon } = r;
	if (bon.status === 'verworfen') return { ok: false, status: 409, meldung: 'Dieser Bon liegt schon im Papierkorb.' };
	if (bon.status === 'confirmed' && !bestaetigtWegnehmen) {
		return {
			ok: false,
			status: 409,
			meldung: 'Dieser Bon ist bestätigt und zählt in Berichten und Budgets. Im Papierkorb zählt er nicht mehr — wirklich verwerfen?',
			brauchtRueckfrage: true
		};
	}
	const getroffen = await d
		.update(receipts)
		.set({ status: 'verworfen', statusVorVerwerfen: bon.status, verworfenAm: sql`now()`, verworfenVon: k.nutzerId })
		.where(and(eq(receipts.id, bon.id), eq(receipts.status, bon.status)))
		.returning({ id: receipts.id });
	return getroffen.length === 1 ? { ok: true } : GEAENDERT;
}

export async function ausPapierkorbHolen(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	einreihen: (id: string) => Promise<void> = enqueueExtraction
): Promise<ZurueckholErgebnis> {
	const r = await berechtigterBon(d, k, bonId);
	if (r.bon === null) return r.fehler;
	const { bon } = r;
	if (bon.status !== 'verworfen') return { ok: false, status: 409, meldung: 'Dieser Bon liegt nicht im Papierkorb.' };
	const ziel = zielstatusBeimWiederherstellen(bon.statusVorVerwerfen);
	const getroffen = await d
		.update(receipts)
		.set({ status: ziel, statusVorVerwerfen: null, verworfenAm: null, verworfenVon: null })
		.where(and(eq(receipts.id, bon.id), eq(receipts.status, 'verworfen')))
		.returning({ id: receipts.id });
	if (getroffen.length !== 1) return GEAENDERT;
	if (ziel !== 'pending') return { ok: true, eingereiht: false, status: ziel };
	try {
		await einreihen(bon.id);
	} catch (err) {
		// Wie beim Hochladen: ohne Job bliebe er fuer immer „wartet". Die Antwort sagt es,
		// statt Erfolg zu melden (wie queued:false bei „Erneut lesen").
		await bonAlsFehlgeschlagenMarkieren(d, bon.id, err instanceof Error ? err.message : String(err));
		return { ok: true, eingereiht: false, status: ziel };
	}
	return { ok: true, eingereiht: true, status: ziel };
}

export async function endgueltigLoeschen(d: Verbindung, k: Zugriffskontext, bonId: string): Promise<PapierkorbErgebnis> {
	const r = await berechtigterBon(d, k, bonId);
	if (r.bon === null) return r.fehler;
	if (r.bon.status !== 'verworfen') {
		return { ok: false, status: 409, meldung: 'Endgültig löschen lässt sich nur ein Bon aus dem Papierkorb.' };
	}
	return (await bonsEndgueltigLoeschen(d, [r.bon.id])) === 1 ? { ok: true } : GEAENDERT;
}

/**
 * Wer zeigt auf ein Original, das gerade geloescht wurde? Rein, damit die Auswahl ohne
 * Datenbank testbar ist. Bons, die selbst mit weg sind, brauchen nichts mehr.
 */
export function verwaisteAbhaengige(abhaengige: { id: string; original: string | null }[], geloescht: Set<string>): string[] {
	return abhaengige.filter((a) => a.original !== null && geloescht.has(a.original) && !geloescht.has(a.id)).map((a) => a.id);
}

/**
 * Das Original ist weg (Entscheidung 07.10.2026): der Doppel-Hinweis faellt, und ein Bon,
 * den ein Mensch als Doppel markiert hatte, geht zurueck in die Pruefung — ein Doppel ohne
 * Original zaehlte sonst nirgends. Liegt der Doppel selbst im Papierkorb, gilt dasselbe fuer
 * seinen Vorstatus, sonst kaeme er beim Zurueckholen als Doppel ohne Original wieder.
 * `vermutetes_original_id` hat ON DELETE SET NULL schon geleert. Dasselbe nullif wie bei
 * „eigener Einkauf" (bons/doppelt.ts): ohne Beanstandung steht dort null, nie [].
 */
async function doppelVerweiseLoesen(tx: Tx, ids: string[]): Promise<void> {
	const betroffen = inArray(receipts.id, ids);
	await tx
		.update(receipts)
		.set({ needsReviewReason: sql`nullif(${receipts.needsReviewReason} - ${DOPPEL_GRUND}::text, '[]'::jsonb)` })
		.where(betroffen);
	await tx.update(receipts).set({ status: 'review' }).where(and(betroffen, eq(receipts.status, 'doppelt')));
	await tx
		.update(receipts)
		.set({ statusVorVerwerfen: 'review' })
		.where(and(betroffen, eq(receipts.statusVorVerwerfen, 'doppelt')));
}

/**
 * Loescht die Bons — aber nur, solange sie im Papierkorb liegen; die Bedingung steht im
 * DELETE selbst. Positionen und Leselaeufe haengen per Kaskade daran, `vermutetes_original_id`
 * anderer Bons wird null. Die Bilder erst NACH dem Loeschen der Zeilen: ein Rollback holt
 * eine geloeschte Datei nicht zurueck (dieselbe Reihenfolge wie haushalt/einladungen.ts).
 *
 * Mit `verworfenVor` (der naechtliche Lauf) steht auch die Frist darin (Sammelfassung 4.3):
 * zwischen Auswahl und DELETE kann ein Bon zurueckgeholt und gleich wieder verworfen worden
 * sein — sein Status stimmt dann wieder, seine Frist nicht.
 *
 * In DERSELBEN Transaktion verlieren Bons, die auf ein geloeschtes Original zeigten, den
 * Doppel-Hinweis (doppelVerweiseLoesen, Sammelfassung 2.8). Wer auf welches Original zeigt, wird
 * VOR dem DELETE gelesen; entschieden wird erst danach, nur fuer wirklich geloeschte Originale.
 * Die Bilder erst NACH dem Commit.
 */
export async function bonsEndgueltigLoeschen(d: Verbindung, ids: string[], opts: { verworfenVor?: Date } = {}): Promise<number> {
	if (ids.length === 0) return 0;
	const weg = await d.transaction(async (tx) => {
		const abhaengige = await tx
			.select({ id: receipts.id, original: receipts.vermutetesOriginalId })
			.from(receipts)
			.where(inArray(receipts.vermutetesOriginalId, ids));
		const geloescht = await tx
			.delete(receipts)
			.where(
				and(
					inArray(receipts.id, ids),
					eq(receipts.status, 'verworfen'),
					opts.verworfenVor ? lt(receipts.verworfenAm, opts.verworfenVor) : undefined
				)
			)
			.returning({
				id: receipts.id,
				imagePath: receipts.imagePath,
				thumbPath: receipts.thumbPath,
				originalImagePath: receipts.originalImagePath,
				originalThumbPath: receipts.originalThumbPath
			});
		const verwaist = verwaisteAbhaengige(abhaengige, new Set(geloescht.map((b) => b.id)));
		if (verwaist.length > 0) await doppelVerweiseLoesen(tx, verwaist);
		return geloescht;
	});
	// Ein bearbeiteter Bon hat zwei Fassungen (bons/bild.ts) — beide gehen.
	await loescheBilder(
		weg.flatMap((b) => [b.imagePath, b.thumbPath, b.originalImagePath, b.originalThumbPath].filter((p): p is string => p !== null))
	);
	return weg.length;
}

/** Faellig ist, was VOR diesem Zeitpunkt verworfen wurde. */
export function papierkorbGrenze(jetzt: Date): Date {
	return new Date(jetzt.getTime() - PAPIERKORB_TAGE * 24 * 60 * 60 * 1000);
}

/** Ids der Bons, die laenger als die Frist im Papierkorb liegen. */
export async function abgelaufeneBons(d: Verbindung, jetzt: Date): Promise<string[]> {
	const zeilen = await d
		.select({ id: receipts.id })
		.from(receipts)
		.where(and(eq(receipts.status, 'verworfen'), lt(receipts.verworfenAm, papierkorbGrenze(jetzt))));
	return zeilen.map((z) => z.id);
}

/** Der taegliche Lauf im Worker. Auswahl und DELETE pruefen dieselbe Grenze. */
export async function papierkorbLeeren(d: Verbindung, jetzt: Date): Promise<number> {
	return bonsEndgueltigLoeschen(d, await abgelaufeneBons(d, jetzt), { verworfenVor: papierkorbGrenze(jetzt) });
}
