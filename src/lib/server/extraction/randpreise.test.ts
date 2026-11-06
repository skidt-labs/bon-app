import { describe, it, expect } from 'vitest';
import { randPreiseAnwenden } from './randpreise';
import type { LineType } from '$lib/bons/zeilenarten';

const k = (text: string, x: number, y: number, w = 60, h = 20) => ({ text, box: [x, y, w, h] as [number, number, number, number] });
const pos = (rawText: string, totalPriceCents: number, lineType: LineType = 'article') => ({ rawText, lineType, totalPriceCents });

// Ein erfundener Bon: jede Bon-Zeile aus Namenskasten, Preiskasten, Steuerkennzeichen.
const kaesten = [
	k('APFELSAFT NATURTRUEB', 10, 100, 200),
	k('1,99', 400, 100),
	k('A', 460, 100, 15),
	k('2 x 1,29', 10, 130, 120),
	k('ORANGEN NETZ', 140, 130, 150),
	k('2,58', 400, 131),
	k('A', 460, 130, 15),
	k('VOLLKORNBROT', 10, 160, 150),
	k('3,49', 400, 160),
	k('A', 460, 160, 15),
	k('RABATT VOLLKORNBROT', 10, 190, 200),
	k('0,50-', 400, 190)
];

describe('randPreiseAnwenden', () => {
	it('(a) ersetzt einen Preis, der nirgends steht, durch den Randbetrag der passenden Reihe', () => {
		const { items, warnungen } = randPreiseAnwenden([pos('APFELSAFT NATURTRUEB', 379)], kaesten);
		expect(items[0].totalPriceCents).toBe(199);
		expect(warnungen).toHaveLength(1);
		expect(warnungen[0]).toContain('Preis von 3,79 auf 1,99 korrigiert (Betrag am rechten Rand der Zeile)');
	});

	it('(b) ersetzt eine Zahl aus der Zeilenmitte (Einzelpreis) durch den Randbetrag', () => {
		const { items, warnungen } = randPreiseAnwenden([pos('ORANGEN NETZ', 129)], kaesten);
		expect(items[0].totalPriceCents).toBe(258);
		expect(warnungen).toHaveLength(1);
	});

	// Der Preis steht am Rand — auch wenn er einer anderen Reihe gehoert, faesst die
	// Nachbesserung ihn nicht an (das macht der Hinweis in der Pruefansicht).
	it('(c) laesst einen Preis, der am Rand einer Reihe steht, unveraendert', () => {
		const eingabe = [pos('APFELSAFT NATURTRUEB', 199), pos('VOLLKORNBROT', 258)];
		const { items, warnungen } = randPreiseAnwenden(eingabe, kaesten);
		expect(items.map((i) => i.totalPriceCents)).toEqual([199, 258]);
		expect(warnungen).toEqual([]);
	});

	it('(d) laesst ohne passende Reihe (Aehnlichkeit unter 0,6) alles, wie es ist', () => {
		const { items, warnungen } = randPreiseAnwenden([pos('KAFFEE BOHNEN', 379)], kaesten);
		expect(items[0].totalPriceCents).toBe(379);
		expect(warnungen).toEqual([]);
	});

	it('(e) setzt bei einem Rabatt den Randbetrag negativ', () => {
		const { items } = randPreiseAnwenden([pos('RABATT VOLLKORNBROT', 150, 'discount')], kaesten);
		expect(items[0].totalPriceCents).toBe(-50);
	});

	it('laesst Zeilen ohne Geldwert (Info) unberuehrt', () => {
		const { items, warnungen } = randPreiseAnwenden([pos('APFELSAFT NATURTRUEB', 379, 'info')], kaesten);
		expect(items[0].totalPriceCents).toBe(379);
		expect(warnungen).toEqual([]);
	});

	it('veraendert die Eingabe nicht und behaelt weitere Felder', () => {
		const eingabe = [{ ...pos('APFELSAFT NATURTRUEB', 379), lineNo: 4 }];
		const { items } = randPreiseAnwenden(eingabe, kaesten);
		expect(eingabe[0].totalPriceCents).toBe(379);
		expect(items[0].lineNo).toBe(4);
	});
});
