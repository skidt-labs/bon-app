import { describe, it, expect } from 'vitest';
import { abweichungen } from './abweichung';
import type { EditorZeile } from './editor';

const z = (over: Partial<EditorZeile>): EditorZeile => ({
	id: 'x',
	lineNo: 1,
	rawText: 'X',
	lineType: 'article',
	quantity: null,
	unit: null,
	unitPriceCents: null,
	totalPriceCents: 0,
	vatClass: null,
	appliesToLine: null,
	categoryId: null,
	ocrZeile: null,
	...over
});
const zeile = (text: string) => ({
	text,
	box: [0, 0, 1, 1] as [number, number, number, number],
	confidence: null
});

describe('abweichungen', () => {
	// Der Fall aus dem Mockup: das Modell las 1,29, im Bild steht 1,79.
	it('meldet den Betrag aus dem Bild, wenn er abweicht', () => {
		const m = abweichungen(
			[z({ lineNo: 4, rawText: 'Bananen', totalPriceCents: 129, unitPriceCents: 149, ocrZeile: 0 })],
			[zeile(' 1,204 kg x 1,49/kg 1,79 A')]
		);
		expect(m.get(4)).toBe(179);
	});

	it('schweigt, wenn der Betrag im Bild steht', () => {
		const m = abweichungen([z({ lineNo: 1, totalPriceCents: 249, ocrZeile: 0 })], [zeile('BUTTER 2,49 A')]);
		expect(m.size).toBe(0);
	});

	// Ohne zugeordnete Zeile gibt es nichts zu vergleichen — und ohne Koordinaten
	// (Bons vor Etappe 2) gibt es ueberhaupt keine Zeilen.
	it('schweigt ohne Zuordnung und ohne Zeilen', () => {
		expect(abweichungen([z({ lineNo: 1, totalPriceCents: 100, ocrZeile: null })], [zeile('X 1,00')]).size).toBe(0);
		expect(abweichungen([z({ lineNo: 1, totalPriceCents: 100, ocrZeile: 0 })], null).size).toBe(0);
	});

	it('schweigt bei Infozeilen — dort ist der Betrag ohne Bedeutung', () => {
		const m = abweichungen(
			[z({ lineNo: 1, lineType: 'info', totalPriceCents: 0, ocrZeile: 0 })],
			[zeile('KASSE 3 BEDIENER 7')]
		);
		expect(m.size).toBe(0);
	});

	it('zeigt auf einen Index ausserhalb der Zeilen nicht', () => {
		expect(abweichungen([z({ lineNo: 1, totalPriceCents: 100, ocrZeile: 99 })], [zeile('X 1,00')]).size).toBe(0);
	});

	// Sobald der Mensch den Betrag aus dem Bild uebernimmt, muss der Hinweis weg sein —
	// sonst steht er da und behauptet eine Abweichung, die er selbst gerade beseitigt hat.
	it('verstummt, sobald der Betrag korrigiert ist', () => {
		const bild = [zeile(' 1,204 kg x 1,49/kg 1,79 A')];
		const vorher = z({ lineNo: 4, totalPriceCents: 129, unitPriceCents: 149, ocrZeile: 0 });
		expect(abweichungen([vorher], bild).size).toBe(1);
		expect(abweichungen([{ ...vorher, totalPriceCents: 179 }], bild).size).toBe(0);
	});
});
