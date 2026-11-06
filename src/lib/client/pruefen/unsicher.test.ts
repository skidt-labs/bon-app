import { describe, it, expect } from 'vitest';
import { unsicherGruende, wortsRaten, OCR_UNSICHER } from './unsicher';
import type { EditorZeile } from './editor';
import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

const z = (teil: Partial<EditorZeile> = {}): EditorZeile => ({
	id: 'a',
	lineNo: 1,
	rawText: 'MILCH',
	lineType: 'article',
	quantity: '1',
	unit: 'stk',
	unitPriceCents: 109,
	totalPriceCents: 109,
	vatClass: null,
	appliesToLine: null,
	categoryId: null,
	ocrZeile: 0,
	geratenAus: null,
	...teil
});
const kasten = (text: string, x: number, confidence: number | null = 99): OcrZeileKurz => ({ text, box: [x, 100, 60, 20], confidence });
const sauber: OcrZeileKurz[] = [kasten('MILCH', 10), kasten('1,09', 400)];

describe('unsicherGruende', () => {
	it('eine saubere Zeile hat keinen Grund', () => {
		expect(unsicherGruende(z(), sauber, null)).toEqual([]);
	});
	it('geraten', () => {
		expect(unsicherGruende(z({ geratenAus: 'MITCH' }), sauber, null)).toEqual(['geraten']);
	});
	it('Wortvorschlag', () => {
		expect(unsicherGruende(z(), sauber, [{ von: 'MILCH', nach: 'MILCK', sicher: false }])).toEqual(['vorschlag']);
	});
	it('schwer lesbar: ein Kasten der Reihe unter der Schwelle', () => {
		const schwach = [kasten('MILCH', 10, OCR_UNSICHER - 1), kasten('1,09', 400)];
		expect(unsicherGruende(z(), schwach, null)).toEqual(['schwer_lesbar']);
	});
	it('Preis nicht am Rand', () => {
		expect(unsicherGruende(z({ totalPriceCents: 179, unitPriceCents: 179 }), sauber, null)).toEqual(['preis_nicht_am_rand']);
	});
	it('Betrag 0: kein „Preis nicht am Rand“', () => {
		expect(unsicherGruende(z({ totalPriceCents: 0, unitPriceCents: 0 }), sauber, null)).toEqual([]);
	});
	it('Rechnung geht nicht auf', () => {
		expect(unsicherGruende(z({ quantity: '2' }), sauber, null)).toEqual(['rechnung']);
	});
	it('ohne Bildzeile — aber nicht bei einer von Hand angelegten Zeile', () => {
		expect(unsicherGruende(z({ ocrZeile: null }), sauber, null)).toEqual(['ohne_bildzeile']);
		expect(unsicherGruende(z({ ocrZeile: null, id: null }), sauber, null)).toEqual([]);
	});
	it('ohne OCR nur Gruende, die keine Bildzeilen brauchen', () => {
		expect(unsicherGruende(z({ ocrZeile: null, quantity: '2' }), null, null)).toEqual(['rechnung']);
	});
	it('Infozeile: kein Preis- oder Bildzeilengrund', () => {
		expect(unsicherGruende(z({ lineType: 'info', ocrZeile: null, totalPriceCents: 0 }), sauber, null)).toEqual([]);
	});
});

describe('wortsRaten', () => {
	const ws = new Map([['eisbergsalat', 3], ['milch', 1]]);
	it('setzt eine sichere Vermutung ein und merkt sich das Original', () => {
		const [r] = wortsRaten([z({ rawText: 'ETSBERGSALAT' })], ws);
		expect(r.rawText).toBe('EISBERGSALAT');
		expect(r.geratenAus).toBe('ETSBERGSALAT');
	});
	it('laesst unsichere Vorschlaege stehen', () => {
		const [r] = wortsRaten([z({ rawText: 'MITCH' })], ws);
		expect(r.rawText).toBe('MITCH');
		expect(r.geratenAus).toBeNull();
	});
	it('sichere und unsichere in einer Zeile: nur die sicheren', () => {
		const [r] = wortsRaten([z({ rawText: 'ETSBERGSALAT MITCH' })], ws);
		expect(r.rawText).toBe('EISBERGSALAT MITCH');
		expect(r.geratenAus).toBe('ETSBERGSALAT MITCH');
	});
});
