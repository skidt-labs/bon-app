/**
 * Bild bearbeiten in der Pruefansicht (Entwurf docs/superpowers/specs/2026-09-27-zuschneiden-drehen-design.md).
 *
 * Das bearbeitete Bild ersetzt das angezeigte, und der Bon wird neu gelesen. Das unbearbeitete
 * Foto bleibt beim ERSTEN Bearbeiten in `original_*` stehen; jede weitere Bearbeitung ersetzt
 * nur die Zwischenfassung (die dann geloescht wird). „Original wiederherstellen" holt es zurueck.
 *
 * Nur fehlgeschlagene und zu pruefende Bons, nur wer hochgeladen hat oder der Verwalter
 * (Entscheidung 27.09.2026). Das UPDATE prueft gelesenen Status UND Bildpfad selbst; trifft es
 * nichts oder scheitert die Datenbank, werden die gerade gespeicherten Dateien wieder geloescht —
 * sonst blieben sie verwaist liegen (Sammelfassung 4.1).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts, receiptItems, extractionRuns } from '$lib/server/db/schema';
import { bonLaden, bonAlsFehlgeschlagenMarkieren } from '$lib/server/bons/liste';
import { inPapierkorbLegen } from '$lib/server/bons/papierkorb';
import { NICHT_BERECHTIGT, passtErwartung, pruefePaar, vergleichLaden, type Erwartet, type VergleichFehler } from '$lib/server/bons/vergleich';
import { darfBonVerwerfen, type Zugriffskontext } from '$lib/server/zugriff/kontext';
import { enqueueExtraction } from '$lib/server/queue/boss';
import { ordneZeilenZu } from '$lib/server/ocr/zuordnung';
import { storeReceiptImage, loescheBilder, istSystemfehler, leseBild } from '$lib/server/storage/images';

type Verbindung = typeof Db;
export type BildErgebnis = { ok: true } | { ok: false; status: 403 | 404 | 409; meldung: string };
export type BildDeps = {
	speichern: (buf: Buffer, at: Date) => Promise<{ imagePath: string; thumbPath: string; width: number }>;
	loeschen: (pfade: string[]) => Promise<void>;
	einreihen: (id: string) => Promise<void>;
};

const STANDARD: BildDeps = { speichern: storeReceiptImage, loeschen: loescheBilder, einreihen: enqueueExtraction };
const GEAENDERT: { ok: false; status: 409; meldung: string } = { ok: false, status: 409, meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.' };

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

/** Was vom alten Lauf nicht mehr gilt: der Bon wird mit dem neuen Bild neu gelesen. */
const NEU_LESEN = { status: 'pending' as const, failureReason: null, needsReviewReason: null, vermutetesOriginalId: null };

type Pfade = { imagePath: string; thumbPath: string; originalImagePath: string | null; originalThumbPath: string | null };

/**
 * Bild umstellen und die Zuordnung der Positionen zum ALTEN Bild loesen — in EINER Transaktion
 * (Sammelfassung 4.1): scheiterte das Loesen der Rahmen vorher, stand der Bon auf „wartet" ohne
 * Auftrag. Die Rahmen muessen weg (Pruefung 30.09.2026), sonst zeigten sie bis zum neuen Lesen
 * — oder fuer immer, wenn es scheitert — an falsche Stellen des bearbeiteten Bilds.
 *
 * Das UPDATE prueft neben dem gelesenen Status auch den gelesenen Bildpfad (Sammelfassung 4.1):
 * ein anderer Tab kann den Bon zwischen Laden und Schreiben bearbeitet haben, und ist der schon
 * wieder gelesen, stimmt der Status wieder. false = der Bon hat sich geaendert, nichts geschrieben.
 */
async function umstellen(d: Verbindung, bon: Bon, pfade: Pfade): Promise<boolean> {
	return d.transaction(async (tx) => {
		const getroffen = await tx
			.update(receipts)
			.set({ ...pfade, ...NEU_LESEN })
			.where(and(eq(receipts.id, bon.id), eq(receipts.status, bon.status), eq(receipts.imagePath, bon.imagePath)))
			.returning({ id: receipts.id });
		if (getroffen.length !== 1) return false;
		await tx.update(receiptItems).set({ ocrZeile: null }).where(eq(receiptItems.receiptId, bon.id));
		return true;
	});
}

/** Neu lesen wie „Erneut lesen": scheitert das Einreihen, steht der Bon auf fehlgeschlagen. */
async function einreihen(d: Verbindung, bonId: string, deps: BildDeps) {
	try {
		await deps.einreihen(bonId);
	} catch (err) {
		await bonAlsFehlgeschlagenMarkieren(d, bonId, err instanceof Error ? err.message : String(err));
	}
}

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
	let getroffen: boolean;
	try {
		getroffen = await umstellen(d, bon, {
			imagePath: neu.imagePath,
			thumbPath: neu.thumbPath,
			originalImagePath: erstesMal ? bon.imagePath : bon.originalImagePath,
			originalThumbPath: erstesMal ? bon.thumbPath : bon.originalThumbPath
		});
	} catch (err) {
		// Die Transaktion ist zurueckgerollt: auf die neuen Dateien zeigt nichts (Sammelfassung 4.1).
		await deps.loeschen([neu.imagePath, neu.thumbPath]);
		throw err;
	}
	if (!getroffen) {
		await deps.loeschen([neu.imagePath, neu.thumbPath]);
		return GEAENDERT;
	}
	// Die Zwischenfassung einer frueheren Bearbeitung braucht niemand mehr — das Original bleibt.
	if (!erstesMal) await deps.loeschen([bon.imagePath, bon.thumbPath]);
	await einreihen(d, bon.id, deps);
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
	const getroffen = await umstellen(d, bon, { imagePath: bon.originalImagePath, thumbPath: bon.originalThumbPath, originalImagePath: null, originalThumbPath: null });
	if (!getroffen) return GEAENDERT;
	await deps.loeschen([bon.imagePath, bon.thumbPath]);
	await einreihen(d, bon.id, deps);
	return { ok: true };
}

export type BildUebernehmenDeps = Pick<BildDeps, 'speichern' | 'loeschen'> & { lesen: (pfad: string) => Promise<Buffer> };

const UEBERNEHMEN_STANDARD: BildUebernehmenDeps = { speichern: storeReceiptImage, loeschen: loescheBilder, lesen: leseBild };
const NUR_BESTAETIGT: VergleichFehler = { ok: false, status: 409, meldung: 'Das Bild lässt sich nur auf einen bestätigten Bon übernehmen.' };

/** Bricht die Transaktion ab und traegt das Ergebnis heraus. */
class Abbruch extends Error {
	constructor(readonly ergebnis: VergleichFehler) {
		super(ergebnis.meldung);
	}
}

/**
 * „Nur das Bild uebernehmen" (Entwurf 2026-11-06-doppel-vergleich): das neue Foto der Quelle
 * ersetzt das Bild eines BESTAETIGTEN Ziels; dessen Daten, Positionen, Kategorien und Budgets
 * bleiben, gelesen wird nicht neu. Die Quelle geht in den Papierkorb.
 *
 * Das Ziel bekommt EIGENE Dateien (neu gespeichert, nicht die Pfade der Quelle) — sonst loeschte
 * das Leeren des Papierkorbs spaeter sein Bild mit. Das bisherige Bild bleibt wie bei „Bild
 * bearbeiten" als Original stehen; nur die Zwischenfassung einer frueheren Bearbeitung geht.
 *
 * Die OCR-Zeilen des juengsten Leselaufs der Quelle werden ein neuer Lauf des Ziels (der
 * juengste Lauf liefert der Pruefansicht die Rahmen), und die Positionen werden diesen Zeilen
 * neu zugeordnet — nur `ocr_zeile`, sonst nichts. Ohne Lauf der Quelle: ein Lauf ohne Zeilen,
 * damit keine Rahmen des alten Bilds auf dem neuen stehen.
 *
 * Dateien werden vor der Transaktion geschrieben; trifft das UPDATE nichts (ein anderer Tab war
 * schneller) oder scheitert etwas darin, gehen sie wieder weg.
 */
export async function bildUebernehmen(
	d: Verbindung,
	k: Zugriffskontext,
	zielId: string,
	quelleId: string,
	deps: BildUebernehmenDeps = UEBERNEHMEN_STANDARD,
	erwartet?: Erwartet
): Promise<{ ok: true } | VergleichFehler> {
	const geladen = await vergleichLaden(d, k, zielId, quelleId);
	if (!geladen.ok) return geladen;
	const { a: ziel, b: quelle } = geladen;
	const fehler = passtErwartung(erwartet, ziel, quelle) ?? pruefePaar(ziel, quelle);
	if (fehler) return fehler;
	if (!darfBonVerwerfen(k, ziel.uploadedBy) || !darfBonVerwerfen(k, quelle.uploadedBy)) return NICHT_BERECHTIGT;
	if (ziel.status !== 'confirmed') return NUR_BESTAETIGT;

	let neu: Awaited<ReturnType<BildDeps['speichern']>>;
	try {
		neu = await deps.speichern(await deps.lesen(quelle.imagePath), new Date());
	} catch (err) {
		throw new BildSpeicherFehler(istSystemfehler(err));
	}
	const erstesMal = ziel.originalImagePath === null;
	try {
		await d.transaction(async (tx) => {
			const getroffen = await tx
				.update(receipts)
				.set({
					imagePath: neu.imagePath,
					thumbPath: neu.thumbPath,
					originalImagePath: erstesMal ? ziel.imagePath : ziel.originalImagePath,
					originalThumbPath: erstesMal ? ziel.thumbPath : ziel.originalThumbPath
				})
				.where(and(eq(receipts.id, ziel.id), eq(receipts.status, 'confirmed'), eq(receipts.imagePath, ziel.imagePath)))
				.returning({ id: receipts.id });
			if (getroffen.length !== 1) throw new Abbruch(GEAENDERT);

			const [lauf] = await tx
				.select({
					ocrZeilen: extractionRuns.ocrZeilen,
					ocrText: extractionRuns.ocrText,
					ocrEngine: extractionRuns.ocrEngine,
					ocrEngineVersion: extractionRuns.ocrEngineVersion
				})
				.from(extractionRuns)
				.where(eq(extractionRuns.receiptId, quelle.id))
				.orderBy(desc(extractionRuns.createdAt))
				.limit(1);
			const zeilen = lauf?.ocrZeilen ?? null;
			await tx.insert(extractionRuns).values({
				receiptId: ziel.id,
				provider: 'bild-uebernommen',
				model: 'bild-uebernommen',
				kiRolle: null,
				ocrZeilen: zeilen,
				ocrText: lauf?.ocrText ?? null,
				ocrEngine: lauf?.ocrEngine ?? null,
				ocrEngineVersion: lauf?.ocrEngineVersion ?? null
			});

			const positionen = await tx
				.select({ id: receiptItems.id, lineNo: receiptItems.lineNo, rawText: receiptItems.rawText, totalPriceCents: receiptItems.totalPriceCents })
				.from(receiptItems)
				.where(eq(receiptItems.receiptId, ziel.id));
			const zuordnung = zeilen ? ordneZeilenZu(positionen, zeilen) : null;
			for (const p of positionen) {
				await tx
					.update(receiptItems)
					.set({ ocrZeile: zuordnung?.get(p.lineNo) ?? null })
					.where(eq(receiptItems.id, p.id));
			}

			const r = await inPapierkorbLegen(tx as never, k, quelle.id, true);
			if (!r.ok) throw new Abbruch({ ok: false, status: r.status, meldung: r.meldung });
		});
	} catch (err) {
		// Zurueckgerollt: auf die neuen Dateien zeigt nichts (Sammelfassung 4.1).
		await deps.loeschen([neu.imagePath, neu.thumbPath]);
		if (err instanceof Abbruch) return err.ergebnis;
		throw err;
	}
	if (!erstesMal) await deps.loeschen([ziel.imagePath, ziel.thumbPath]);
	return { ok: true };
}
