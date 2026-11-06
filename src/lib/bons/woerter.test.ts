import { describe, it, expect } from 'vitest';
import { abstand, wortschatzAus, wortVorschlag, textVorschlag } from './woerter';

describe('abstand', () => {
	it('typische OCR-Verwechslung kostet einen halben Schritt', () => {
		expect(abstand('etsbergsalat', 'eisbergsalat')).toBe(0.5);
		expect(abstand('mitch', 'milch')).toBe(0.5);
		expect(abstand('k0rn', 'korn')).toBe(0.5);
	});
	it('rn und m, ii und ü kosten je einen halben Schritt', () => {
		expect(abstand('sahnequark', 'sahnequark')).toBe(0);
		expect(abstand('rnilch', 'milch')).toBe(0.5);
		expect(abstand('gemiise', 'gemüse')).toBe(0.5);
	});
	it('sonstige Ersetzung, Einfuegung, Vertauschung kosten je 1', () => {
		expect(abstand('milch', 'milck')).toBe(1);
		expect(abstand('milch', 'milchh')).toBe(1);
		expect(abstand('mlich', 'milch')).toBe(1);
	});
});

describe('wortschatzAus', () => {
	it('zaehlt Woerter ab 4 Buchstaben, klein geschrieben, mit Umlauten', () => {
		const ws = wortschatzAus(['EISBERGSALAT 1 St', 'Eisbergsalat', 'Gemüse-Mix 500g', 'Ei']);
		expect(ws.get('eisbergsalat')).toBe(2);
		expect(ws.get('gemüse')).toBe(1);
		expect(ws.has('ei')).toBe(false);
		expect(ws.has('500g')).toBe(false);
	});
});

describe('wortVorschlag', () => {
	const ws = new Map([
		['eisbergsalat', 2],
		['milch', 3],
		['butter', 1],
		['bitter', 1]
	]);

	it('raet das bekannte Wort und behaelt die Schreibweise', () => {
		expect(wortVorschlag('Etsbergsalat', ws)).toEqual({ von: 'Etsbergsalat', nach: 'Eisbergsalat', sicher: true });
		expect(wortVorschlag('ETSBERGSALAT', ws)?.nach).toBe('EISBERGSALAT');
		expect(wortVorschlag('etsbergsalat', ws)?.nach).toBe('eisbergsalat');
	});

	it('kein Vorschlag fuer ein bekanntes Wort', () => {
		expect(wortVorschlag('MILCH', ws)).toBeNull();
	});

	it('kein Vorschlag bei Gleichstand in Abstand und Haeufigkeit', () => {
		expect(wortVorschlag('bxtter', ws)).toBeNull();
	});

	it('kurze Woerter: hoechstens Abstand 1', () => {
		expect(wortVorschlag('mxlxh', ws)).toBeNull();
	});

	it('lange Woerter: Abstand 2 erlaubt, aber nicht sicher', () => {
		expect(wortVorschlag('Eisbergxalax', ws)).toEqual({ von: 'Eisbergxalax', nach: 'Eisbergsalat', sicher: false });
	});

	it('ein Wort, das nur einmal vorkam, ist nur ein Vorschlag', () => {
		const einmal = new Map([['eisbergsalat', 1]]);
		expect(wortVorschlag('Etsbergsalat', einmal)?.sicher).toBe(false);
	});

	it('ein echter Schritt (kein Lesefehler) ist nur ein Vorschlag', () => {
		expect(wortVorschlag('Milck', ws)).toEqual({ von: 'Milck', nach: 'Milch', sicher: false });
	});

	it('Wortform oder Abkuerzung ist kein Lesefehler', () => {
		expect(wortVorschlag('TOMATEN', new Map([['tomate', 4]]))).toBeNull();
		expect(wortVorschlag('TOMATE', new Map([['tomaten', 4]]))).toBeNull();
	});

	it('Woerter unter 4 Buchstaben bleiben unberuehrt', () => {
		expect(wortVorschlag('Mic', new Map([['mich', 5]]))).toBeNull();
	});
});

describe('textVorschlag', () => {
	const ws = new Map([
		['eisbergsalat', 2],
		['milch', 2]
	]);
	it('ersetzt jedes Wort mit Vorschlag und laesst den Rest stehen', () => {
		expect(textVorschlag('ETSBERGSALAT MITCH 1,5%', ws)).toEqual({
			text: 'EISBERGSALAT MILCH 1,5%',
			woerter: [
				{ von: 'ETSBERGSALAT', nach: 'EISBERGSALAT', sicher: true },
				{ von: 'MITCH', nach: 'MILCH', sicher: true }
			]
		});
	});
	it('null ohne Vorschlag', () => {
		expect(textVorschlag('MILCH 1,5%', ws)).toBeNull();
	});
});

// Abschlusspruefung 0.13.0, I4: die Ansicht rechnet bei jedem Tastendruck alle Zeilen neu.
// Gemessen vorher: 3000 Woerter × 40 unbekannte Woerter ≈ 1,4 s je Tastendruck.
describe('Tempo', () => {
	const silben = ['ber', 'gur', 'kas', 'mil', 'sal', 'tom', 'wur', 'zit', 'bro', 'kef', 'lau', 'nus'];
	const ws = new Map<string, number>();
	for (let i = 0; ws.size < 3000; i++) {
		const w = silben[i % 12] + silben[(i * 7) % 12] + silben[(i * 5 + 3) % 12] + (i % 3 === 0 ? silben[(i * 11) % 12] : '');
		ws.set(w + 'x'.repeat(Math.floor(i / 1728)), 2);
	}
	const zeilen = Array.from({ length: 40 }, (_, i) => `QWERTZ${String.fromCharCode(65 + (i % 26))}UIOP`);

	it('40 unbekannte Woerter gegen 3000 bekannte: erster Lauf unter 100 ms (vorher rund 200)', () => {
		const start = performance.now();
		for (const z of zeilen) textVorschlag(z, ws);
		expect(performance.now() - start).toBeLessThan(100);
	});

	it('derselbe Wortschatz, dieselben Woerter: der zweite Lauf ist fast umsonst (gemerkt)', () => {
		for (const z of zeilen) textVorschlag(z, ws);
		const start = performance.now();
		for (const z of zeilen) textVorschlag(z, ws);
		expect(performance.now() - start).toBeLessThan(15);
	});
});

// Abschlusspruefung 0.13.0, I5: ein unkorrigiert bestaetigter Lesefehler steht auch im Wortschatz.
// Gleich eingesetzt wird nur, was ein Mensch nachweislich getippt hat (`getippt`).
describe('nur Getipptes wird gleich eingesetzt', () => {
	const ws = new Map([['etsbergsalat', 3], ['eisbergsalat', 2]]);
	it('Ziel nicht getippt: nur Vorschlag', () => {
		const zielNurGelesen = new Map([['etsbergsalat', 3]]);
		expect(wortVorschlag('EISBERGSALAT', zielNurGelesen, new Set())).toEqual({ von: 'EISBERGSALAT', nach: 'ETSBERGSALAT', sicher: false });
	});
	it('Ziel getippt: sicher', () => {
		expect(wortVorschlag('Etsbergsalat', new Map([['eisbergsalat', 2]]), new Set(['eisbergsalat']))?.sicher).toBe(true);
	});
	it('ohne Angabe wie bisher', () => {
		expect(wortVorschlag('Etsbergsalat', new Map([['eisbergsalat', 2]]))?.sicher).toBe(true);
		expect(ws.size).toBe(2);
	});
	it('textVorschlag reicht getippt durch', () => {
		expect(textVorschlag('ETSBERGSALAT', new Map([['eisbergsalat', 2]]), new Set())?.woerter[0].sicher).toBe(false);
	});
});
