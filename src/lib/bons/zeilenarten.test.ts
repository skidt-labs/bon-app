import { describe, it, expect } from 'vitest';
import { ZEILENARTEN, MONETAER, ART_TEXT, IMMER_NEGATIV, mitVorzeichen, vorzeichenAngleichen } from './zeilenarten';
import { lineType } from '$lib/server/db/schema';

describe('Zeilenarten', () => {
	// Das Drizzle-Enum schreibt die Werte aus, weil es die Wahrheit der Datenbank ist.
	// Dieser Test ist die Klammer: laufen die beiden auseinander, faellt es hier auf und
	// nicht erst an einer Zeile, die in der Summe fehlt.
	it('deckt sich mit dem Enum der Datenbank', () => {
		expect([...ZEILENARTEN]).toEqual([...lineType.enumValues]);
	});

	it('kennt zu jeder Art einen deutschen Namen', () => {
		expect(Object.keys(ART_TEXT).sort()).toEqual([...ZEILENARTEN].sort());
	});

	it('zaehlt nur Arten zur Summe, die es gibt — ohne loyalty und info', () => {
		for (const a of MONETAER) expect(ZEILENARTEN).toContain(a);
		expect(MONETAER).not.toContain('loyalty');
		expect(MONETAER).not.toContain('info');
	});
});

describe('mitVorzeichen', () => {
	it('macht Rabatt und Pfandrueckgabe immer negativ', () => {
		expect(mitVorzeichen('discount', 150)).toBe(-150);
		expect(mitVorzeichen('discount', -150)).toBe(-150);
		expect(mitVorzeichen('deposit_return', 25)).toBe(-25);
	});

	it('laesst andere Arten unveraendert', () => {
		expect(mitVorzeichen('article', -99)).toBe(-99);
		expect(mitVorzeichen('deposit', 25)).toBe(25);
	});

	it('laesst 0 bei 0', () => {
		expect(Object.is(mitVorzeichen('discount', 0), 0)).toBe(true);
	});

	it('kennt genau Rabatt und Pfandrueckgabe als immer negativ', () => {
		expect([...IMMER_NEGATIV].sort()).toEqual(['deposit_return', 'discount']);
	});
});

// Abschlusspruefung 0.12.0, Wichtig 2: was die Ansicht zeigt, ist, was gespeichert wird.
describe('vorzeichenAngleichen', () => {
	it('dreht Rabatt und Pfandrueckgabe ins Minus, Einzelpreis mit', () => {
		expect(
			vorzeichenAngleichen([
				{ lineType: 'deposit_return', totalPriceCents: 25, unitPriceCents: 25 },
				{ lineType: 'discount', totalPriceCents: 150, unitPriceCents: null },
				{ lineType: 'article', totalPriceCents: -99, unitPriceCents: null }
			])
		).toEqual([
			{ lineType: 'deposit_return', totalPriceCents: -25, unitPriceCents: -25 },
			{ lineType: 'discount', totalPriceCents: -150, unitPriceCents: null },
			{ lineType: 'article', totalPriceCents: -99, unitPriceCents: null }
		]);
	});

	it('laesst weitere Felder stehen', () => {
		const [z] = vorzeichenAngleichen([{ lineType: 'discount', totalPriceCents: 50, unitPriceCents: null, rawText: 'Rabatt' }]);
		expect(z).toEqual({ lineType: 'discount', totalPriceCents: -50, unitPriceCents: null, rawText: 'Rabatt' });
	});
});
