import { abweichungInZeile } from '$lib/bons/betraege';
import { MONETAER, type EditorZeile } from './editor';
import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

/**
 * Je Zeilennummer der Betrag, der im BILD steht, wenn er vom gelesenen abweicht.
 * Grundlage fuer „Im Bild steht 1,79 — gelesen wurde 1,29" und den Knopf, der es
 * uebernimmt. Das ist die haeufigste Korrektur ueberhaupt, und sie wird damit ein Klick.
 *
 * Die Rechnung steht in `$lib/bons/betraege` — hier wird nur ausgewaehlt, fuer welche
 * Zeilen sie ueberhaupt gilt: nur Geldzeilen mit zugeordneter Bildzeile. Bei einer
 * Infozeile ist der Betrag ohne Bedeutung, und ein Hinweis darauf waere Laerm.
 */
export function abweichungen(
	zeilen: EditorZeile[],
	ocrZeilen: OcrZeileKurz[] | null
): Map<number, number> {
	const treffer = new Map<number, number>();
	if (!ocrZeilen) return treffer;
	for (const z of zeilen) {
		if (z.ocrZeile === null || !MONETAER.includes(z.lineType)) continue;
		if (z.ocrZeile < 0 || z.ocrZeile >= ocrZeilen.length) continue;
		const imBild = abweichungInZeile(ocrZeilen, z.ocrZeile, z.totalPriceCents, z.unitPriceCents);
		if (imBild !== null) treffer.set(z.lineNo, imBild);
	}
	return treffer;
}
