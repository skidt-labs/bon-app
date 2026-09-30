/**
 * Bild bearbeiten in der Pruefansicht (Entwurf docs/superpowers/specs/2026-09-27-zuschneiden-drehen-design.md).
 *
 * Das bearbeitete Bild ersetzt das angezeigte, und der Bon wird neu gelesen. Das unbearbeitete
 * Foto bleibt beim ERSTEN Bearbeiten in `original_*` stehen; jede weitere Bearbeitung ersetzt
 * nur die Zwischenfassung (die dann geloescht wird). „Original wiederherstellen" holt es zurueck.
 *
 * Nur fehlgeschlagene und zu pruefende Bons, nur wer hochgeladen hat oder der Verwalter
 * (Entscheidung 27.09.2026). Das UPDATE prueft den gelesenen Status selbst; trifft es nichts,
 * werden die gerade gespeicherten Dateien wieder geloescht — sonst blieben sie verwaist liegen.
 */
import { and, eq } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { bonLaden, bonAlsFehlgeschlagenMarkieren } from '$lib/server/bons/liste';
import { darfBonVerwerfen, type Zugriffskontext } from '$lib/server/zugriff/kontext';
import { enqueueExtraction } from '$lib/server/queue/boss';
import { storeReceiptImage, loescheBilder, istSystemfehler } from '$lib/server/storage/images';

type Verbindung = typeof Db;
export type BildErgebnis = { ok: true } | { ok: false; status: 403 | 404 | 409; meldung: string };
export type BildDeps = {
	speichern: (buf: Buffer, at: Date) => Promise<{ imagePath: string; thumbPath: string; width: number }>;
	loeschen: (pfade: string[]) => Promise<void>;
	einreihen: (id: string) => Promise<void>;
};

const STANDARD: BildDeps = { speichern: storeReceiptImage, loeschen: loescheBilder, einreihen: enqueueExtraction };
const GEAENDERT: BildErgebnis = { ok: false, status: 409, meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.' };

/** Das Bild liess sich nicht speichern — `systemfehler`: Platte/Rechte (503), sonst unlesbar (422). */
export class BildSpeicherFehler extends Error {
	constructor(readonly systemfehler: boolean) {
		super(systemfehler ? 'Bild konnte gerade nicht gespeichert werden' : 'Bild nicht verarbeitbar');
		this.name = 'BildSpeicherFehler';
	}
}

type Bon = NonNullable<Awaited<ReturnType<typeof bonLaden>>>;

async function bearbeitbarerBon(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string
): Promise<{ bon: Bon; fehler: null } | { bon: null; fehler: BildErgebnis }> {
	const bon = await bonLaden(d, k, bonId);
	if (!bon) return { bon: null, fehler: { ok: false, status: 404, meldung: 'Bon nicht gefunden' } };
	if (!darfBonVerwerfen(k, bon.uploadedBy)) {
		return { bon: null, fehler: { ok: false, status: 403, meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.' } };
	}
	if (bon.status !== 'failed' && bon.status !== 'review') {
		return {
			bon: null,
			fehler: { ok: false, status: 409, meldung: 'Das Bild lässt sich nur bei fehlgeschlagenen und zu prüfenden Bons bearbeiten.' }
		};
	}
	return { bon, fehler: null };
}

/**
 * Neu lesen wie „Erneut lesen": scheitert das Einreihen, steht der Bon auf fehlgeschlagen.
 * Vorher die Zuordnung der Positionen zum ALTEN Bild loesen (Pruefung 30.09.2026): sonst
 * zeigten ihre Rahmen bis zum neuen Lesen — oder fuer immer, wenn es scheitert — an falsche
 * Stellen des bearbeiteten Bilds.
 */
async function neuLesen(d: Verbindung, bonId: string, deps: BildDeps) {
	await d.update(receiptItems).set({ ocrZeile: null }).where(eq(receiptItems.receiptId, bonId));
	try {
		await deps.einreihen(bonId);
	} catch (err) {
		await bonAlsFehlgeschlagenMarkieren(d, bonId, err instanceof Error ? err.message : String(err));
	}
}

/** Was vom alten Lauf nicht mehr gilt: der Bon wird mit dem neuen Bild neu gelesen. */
const NEU_LESEN = { status: 'pending' as const, failureReason: null, needsReviewReason: null, vermutetesOriginalId: null };

export async function bildErsetzen(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	buf: Buffer,
	deps: BildDeps = STANDARD
): Promise<BildErgebnis> {
	const r = await bearbeitbarerBon(d, k, bonId);
	if (r.bon === null) return r.fehler;
	const { bon } = r;
	let neu: Awaited<ReturnType<BildDeps['speichern']>>;
	try {
		neu = await deps.speichern(buf, new Date());
	} catch (err) {
		throw new BildSpeicherFehler(istSystemfehler(err));
	}
	const erstesMal = bon.originalImagePath === null;
	const getroffen = await d
		.update(receipts)
		.set({
			imagePath: neu.imagePath,
			thumbPath: neu.thumbPath,
			originalImagePath: erstesMal ? bon.imagePath : bon.originalImagePath,
			originalThumbPath: erstesMal ? bon.thumbPath : bon.originalThumbPath,
			...NEU_LESEN
		})
		.where(and(eq(receipts.id, bon.id), eq(receipts.status, bon.status)))
		.returning({ id: receipts.id });
	if (getroffen.length !== 1) {
		await deps.loeschen([neu.imagePath, neu.thumbPath]);
		return GEAENDERT;
	}
	// Die Zwischenfassung einer frueheren Bearbeitung braucht niemand mehr — das Original bleibt.
	if (!erstesMal) await deps.loeschen([bon.imagePath, bon.thumbPath]);
	await neuLesen(d, bon.id, deps);
	return { ok: true };
}

export async function originalWiederherstellen(
	d: Verbindung,
	k: Zugriffskontext,
	bonId: string,
	deps: BildDeps = STANDARD
): Promise<BildErgebnis> {
	const r = await bearbeitbarerBon(d, k, bonId);
	if (r.bon === null) return r.fehler;
	const { bon } = r;
	if (bon.originalImagePath === null || bon.originalThumbPath === null) {
		return { ok: false, status: 409, meldung: 'Dieser Bon hat kein gespeichertes Original.' };
	}
	const getroffen = await d
		.update(receipts)
		.set({
			imagePath: bon.originalImagePath,
			thumbPath: bon.originalThumbPath,
			originalImagePath: null,
			originalThumbPath: null,
			...NEU_LESEN
		})
		.where(and(eq(receipts.id, bon.id), eq(receipts.status, bon.status)))
		.returning({ id: receipts.id });
	if (getroffen.length !== 1) return GEAENDERT;
	await deps.loeschen([bon.imagePath, bon.thumbPath]);
	await neuLesen(d, bon.id, deps);
	return { ok: true };
}
