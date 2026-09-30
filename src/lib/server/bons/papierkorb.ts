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

type Verbindung = typeof Db;
export type PapierkorbErgebnis = { ok: true } | { ok: false; status: 403 | 404 | 409; meldung: string };

const NICHT_GEFUNDEN: PapierkorbErgebnis = { ok: false, status: 404, meldung: 'Bon nicht gefunden' };
const NICHT_BERECHTIGT: PapierkorbErgebnis = {
	ok: false,
	status: 403,
	meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.'
};
const GEAENDERT: PapierkorbErgebnis = {
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
): Promise<{ bon: Bon; fehler: null } | { bon: null; fehler: PapierkorbErgebnis }> {
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
			meldung: 'Dieser Bon ist bestätigt. Im Papierkorb zählt er nicht mehr in Berichten und Budgets — bitte bestätigen.'
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
): Promise<PapierkorbErgebnis> {
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
	if (ziel === 'pending') {
		try {
			await einreihen(bon.id);
		} catch (err) {
			// Wie beim Hochladen: ohne Job bliebe er fuer immer „wartet".
			await bonAlsFehlgeschlagenMarkieren(d, bon.id, err instanceof Error ? err.message : String(err));
		}
	}
	return { ok: true };
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
 * Loescht die Bons — aber nur, solange sie im Papierkorb liegen; die Bedingung steht im
 * DELETE selbst. Positionen und Leselaeufe haengen per Kaskade daran, `vermutetes_original_id`
 * anderer Bons wird null. Die Bilder erst NACH dem Loeschen der Zeilen: ein Rollback holt
 * eine geloeschte Datei nicht zurueck (dieselbe Reihenfolge wie haushalt/einladungen.ts).
 */
export async function bonsEndgueltigLoeschen(d: Verbindung, ids: string[]): Promise<number> {
	if (ids.length === 0) return 0;
	const weg = await d
		.delete(receipts)
		.where(and(inArray(receipts.id, ids), eq(receipts.status, 'verworfen')))
		.returning({
			imagePath: receipts.imagePath,
			thumbPath: receipts.thumbPath,
			originalImagePath: receipts.originalImagePath,
			originalThumbPath: receipts.originalThumbPath
		});
	// Ein bearbeiteter Bon hat zwei Fassungen (bons/bild.ts) — beide gehen.
	await loescheBilder(
		weg.flatMap((b) => [b.imagePath, b.thumbPath, b.originalImagePath, b.originalThumbPath].filter((p): p is string => p !== null))
	);
	return weg.length;
}

/** Ids der Bons, die laenger als die Frist im Papierkorb liegen. */
export async function abgelaufeneBons(d: Verbindung, jetzt: Date): Promise<string[]> {
	const grenze = new Date(jetzt.getTime() - PAPIERKORB_TAGE * 24 * 60 * 60 * 1000);
	const zeilen = await d
		.select({ id: receipts.id })
		.from(receipts)
		.where(and(eq(receipts.status, 'verworfen'), lt(receipts.verworfenAm, grenze)));
	return zeilen.map((z) => z.id);
}

/** Der taegliche Lauf im Worker. */
export async function papierkorbLeeren(d: Verbindung, jetzt: Date): Promise<number> {
	return bonsEndgueltigLoeschen(d, await abgelaufeneBons(d, jetzt));
}
