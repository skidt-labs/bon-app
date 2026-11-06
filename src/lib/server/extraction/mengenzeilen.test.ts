import { describe, it, expect } from 'vitest';
import { mengenzeilenAnwenden } from './mengenzeilen';
import type { Kasten } from '$lib/bons/reihen';
import type { LineType } from '$lib/bons/zeilenarten';

const k = (text: string, x: number, y: number, w = 60, h = 20): Kasten => ({ text, box: [x, y, w, h] });

type P = {
	rawText: string;
	lineType: LineType;
	quantity: string | null;
	unit: string | null;
	unitPriceCents: number | null;
	totalPriceCents: number;
};
const p = (rawText: string, total: number, menge: string | null = '1', unit: string | null = 'stk', einzel: number | null = total): P => ({
	rawText,
	lineType: 'article',
	quantity: menge,
	unit,
	unitPriceCents: einzel,
	totalPriceCents: total
});

// Ein erfundener Bon: die Mengenzeile steht UEBER den Broetchen.
const bon = [
	k('BUTTER', 10, 100, 200),
	k('1,99', 400, 100),
	k('2 x 1,29', 30, 130, 120),
	k('BROETCHEN', 10, 160, 200),
	k('2,58', 400, 160)
];

describe('mengenzeilenAnwenden', () => {
	it('gibt der Ware ohne Menge die Angabe aus der Mengenzeile, mit Warnung', () => {
		const r = mengenzeilenAnwenden([p('BUTTER', 199), p('BROETCHEN', 258, null, null, null)], bon);
		expect(r.items[1]).toMatchObject({ quantity: '2', unit: 'stk', unitPriceCents: 129, totalPriceCents: 258 });
		expect(r.warnungen).toHaveLength(1);
		expect(r.warnungen[0]).toContain('BROETCHEN');
	});

	it('nimmt dem Nachbarn die geerbte Angabe, wenn seine Rechnung nicht aufgeht', () => {
		// Das Modell hat die Mengenzeile der Butter darueber zugeschlagen.
		const r = mengenzeilenAnwenden([p('BUTTER', 199, '2', 'stk', 129), p('BROETCHEN', 258)], bon);
		expect(r.items[0]).toMatchObject({ quantity: '1', unit: 'stk', unitPriceCents: 199 });
		expect(r.items[1]).toMatchObject({ quantity: '2', unit: 'stk', unitPriceCents: 129 });
		expect(r.warnungen).toHaveLength(2);
	});

	it('laesst eine schon richtige Angabe stehen, ohne Warnung', () => {
		const items = [p('BUTTER', 199), p('BROETCHEN', 258, '2', 'stk', 129)];
		const r = mengenzeilenAnwenden(items, bon);
		expect(r.items).toEqual(items);
		expect(r.warnungen).toEqual([]);
	});

	it('legt keine Position an und nimmt keine weg', () => {
		const r = mengenzeilenAnwenden([p('BROETCHEN', 258, null, null, null)], bon);
		expect(r.items).toHaveLength(1);
	});

	it('Gewicht: Einheit kg, Kilopreis, Rabatt-Vorzeichen bleibt beim Gesamtbetrag', () => {
		const waage = [k('BANANEN', 10, 100, 200), k('1,59', 400, 100), k('0,532 kg x 2,99 EUR/kg', 30, 130, 300)];
		const r = mengenzeilenAnwenden([p('BANANEN', 159)], waage);
		expect(r.items[0]).toMatchObject({ quantity: '0.532', unit: 'kg', unitPriceCents: 299 });
	});

	it('zwei Positionen mit demselben Betrag: entscheidet der Text der Partnerzeile', () => {
		const zwei = [k('BROETCHEN', 10, 100, 200), k('2,58', 400, 100), k('2 x 1,29', 30, 130, 120), k('KAFFEE', 10, 160, 200), k('2,58', 400, 160)];
		// Mengenzeile zwischen zwei gleichen Betraegen: kein Partner, also nichts.
		const r = mengenzeilenAnwenden([p('BROETCHEN', 258), p('KAFFEE', 258)], zwei);
		expect(r.warnungen).toEqual([]);
	});

	it('ohne Rahmen passiert nichts', () => {
		const items = [p('BROETCHEN', 258, null, null, null)];
		expect(mengenzeilenAnwenden(items, [{ text: '2 x 1,29' }, { text: 'BROETCHEN 2,58' }]).items).toEqual(items);
	});

	// Abschlusspruefung 0.13.0, I2: Mengenzeile mit eigenem Betrag zwischen dem Namen darueber
	// und der naechsten Ware darunter, die zufaellig gleich viel kostet.
	it('Mengenzeile mit Betrag: Name kommt aus der Nachbarreihe OHNE eigenen Betrag', () => {
		const bon = [
			k('H-MILCH 3,5%', 10, 100, 200),
			k('2 x 1,09', 30, 130, 120),
			k('2,18', 400, 130),
			k('BUTTER', 10, 160, 200),
			k('2,18', 400, 160)
		];
		const r = mengenzeilenAnwenden([p('MILCH', 218, null, null, null), p('BUTTER', 218)], bon);
		expect(r.items[1]).toMatchObject({ quantity: '1', unitPriceCents: 218 });
		expect(r.items[0]).toMatchObject({ quantity: '2', unitPriceCents: 109 });
	});
});

