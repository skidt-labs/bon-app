/**
 * Welche Positionen einen zweiten Blick lohnen — und warum (Entwurf 2026-11-06-pruefhilfen, §2c).
 *
 * Die Markierung SPERRT NICHTS. Sie soll selten sein: ein bunter Teppich waere dasselbe wie
 * keine Markierung. Deshalb nur Gruende, die etwas Pruefbares sagen, und je Grund ein Satz.
 */
import { MONETAER, type EditorZeile } from './editor';
import { rechenprobe } from './rechenprobe';
import { ortImBild, reiheVon } from '$lib/bons/reihen';
import { textVorschlag, type Wortschatz, type WortVorschlag } from '$lib/bons/woerter';
import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

/**
 * Unter dieser OCR-Sicherheit (PaddleOCR, 0–100) gilt eine Bildzeile als schwer lesbar.
 *
 * Gemessen mit `unsicher.run.test.ts` (06.11.2026, 216 Geldpositionen, 122 korrigiert = 56 %;
 * „korrigiert“ zaehlt auch Kategorie und Umnummerieren, ist also grob): unter 80 markiert 16
 * (7 %), davon 10 korrigiert (63 %); unter 85 markiert 35, davon nur 51 %; unter 90 schon 33 %
 * aller Positionen. Die Sicherheit sagt wenig — deshalb die enge Schwelle. Viel staerker:
 * Positionen ohne Bildzeile, 18 von 19 korrigiert.
 */
export const OCR_UNSICHER = 80;

export type UnsicherGrund = 'geraten' | 'vorschlag' | 'schwer_lesbar' | 'preis_nicht_am_rand' | 'rechnung' | 'ohne_bildzeile';

export const GRUND_TEXT: Record<UnsicherGrund, string> = {
	geraten: 'Wort geraten',
	vorschlag: 'Wort unklar',
	schwer_lesbar: 'schwer lesbar',
	preis_nicht_am_rand: 'Preis nicht am Rand',
	rechnung: 'Rechnung geht nicht auf',
	ohne_bildzeile: 'nicht im Bild gefunden'
};

/** Die kleinste OCR-Sicherheit der Bon-Zeile, in der `index` steht; null ohne Angabe. */
export function reihenSicherheit(ocr: OcrZeileKurz[], index: number): number | null {
	const werte = reiheVon(ocr, index)
		.map((i) => ocr[i]?.confidence)
		.filter((c): c is number => typeof c === 'number');
	return werte.length > 0 ? Math.min(...werte) : null;
}

export function unsicherGruende(z: EditorZeile, ocr: OcrZeileKurz[] | null, vorschlag: WortVorschlag[] | null): UnsicherGrund[] {
	const gruende: UnsicherGrund[] = [];
	const geld = MONETAER.includes(z.lineType);
	if (z.geratenAus) gruende.push('geraten');
	if (vorschlag && vorschlag.length > 0) gruende.push('vorschlag');
	if (ocr && z.ocrZeile !== null && z.ocrZeile >= 0 && z.ocrZeile < ocr.length) {
		const sicherheit = reihenSicherheit(ocr, z.ocrZeile);
		if (sicherheit !== null && sicherheit < OCR_UNSICHER) gruende.push('schwer_lesbar');
	}
	// 0,00 gilt im Bild nie als Betrag (betraege.ts) — eine Gratiszeile waere sonst immer „nicht am Rand“.
	if (geld && ocr && ocr.length > 0 && z.totalPriceCents !== 0 && ortImBild(ocr, z.totalPriceCents) !== 'rand') gruende.push('preis_nicht_am_rand');
	if (rechenprobe(z) !== null) gruende.push('rechnung');
	// Eine von Hand angelegte Zeile (id null) hat nie eine Bildzeile — das ist kein Zweifel.
	if (geld && ocr && ocr.length > 0 && z.ocrZeile === null && z.id !== null) gruende.push('ohne_bildzeile');
	return gruende;
}

/**
 * Setzt sichere Vermutungen gleich ein (Entwurf §2b) und merkt sich den gelesenen Text in
 * `geratenAus`. Unsichere bleiben stehen — die bietet die Ansicht nur an.
 */
export function wortsRaten(zeilen: EditorZeile[], ws: Wortschatz, getippt?: Set<string>): EditorZeile[] {
	return zeilen.map((z) => {
		const v = textVorschlag(z.rawText, ws, getippt);
		const sicher = v?.woerter.filter((w) => w.sicher) ?? [];
		if (sicher.length === 0) return z;
		let text = z.rawText;
		for (const w of sicher) text = text.replace(w.von, w.nach);
		return { ...z, rawText: text, geratenAus: z.rawText };
	});
}
