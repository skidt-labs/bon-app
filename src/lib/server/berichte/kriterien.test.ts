import { describe, it, expect } from 'vitest';
import { leererFilter, type BerichtFilter } from '$lib/berichte/filter';
import {
	bonPasst, positionsTreffer, topfKategorienJeMonat, suchNormal, kriterienAktiv, KEINE_KRITERIEN,
	type BonFuerFilter, type PositionsKriterien
} from './kriterien';

const F = leererFilter({ art: 'monat', monat: '2026-09' });
const bon = (x: Partial<BonFuerFilter> = {}): BonFuerFilter => ({
	merchantId: 'l1', uploadedBy: 'p1', cents: 3000, sichtbarkeit: 'geteilt', ...x
});

/*
 * UND zwischen Merkmalen, ODER innerhalb. Jede Zeile: Filter, Bon, erwartet.
 */
describe('bonPasst: UND/ODER als Tabelle', () => {
	const faelle: [string, Partial<BerichtFilter>, Partial<BonFuerFilter>, boolean][] = [
		['ohne Filter passt alles', {}, {}, true],
		['Laden: einer der Liste (ODER)', { laden: ['l2', 'l1'] }, {}, true],
		['Laden: nicht in der Liste', { laden: ['l2'] }, {}, false],
		['Laden unbekannt trifft Bon ohne Laden', { laden: ['ohne'] }, { merchantId: null }, true],
		['Laden unbekannt trifft keinen Bon mit Laden', { laden: ['ohne'] }, {}, false],
		['Person: passt', { person: ['p1'] }, {}, true],
		['Person: andere', { person: ['p2'] }, {}, false],
		['Betrag ab: genau an der Grenze', { betrag: { ab: 3000, bis: null } }, {}, true],
		['Betrag ab: darunter', { betrag: { ab: 3001, bis: null } }, {}, false],
		['Betrag bis: genau an der Grenze', { betrag: { ab: null, bis: 3000 } }, {}, true],
		['Betrag bis: darueber', { betrag: { ab: null, bis: 2999 } }, {}, false],
		['Betrag: Bon ohne Endsumme faellt heraus', { betrag: { ab: 0, bis: null } }, { cents: null }, false],
		['Sicht geteilt', { sicht: 'geteilt' }, {}, true],
		['Sicht privat bei geteiltem Bon', { sicht: 'privat' }, {}, false],
		['UND: Laden passt, Person nicht', { laden: ['l1'], person: ['p2'] }, {}, false],
		['UND: Laden, Person und Betrag passen', { laden: ['l1'], person: ['p1'], betrag: { ab: 1000, bis: 5000 } }, {}, true]
	];
	for (const [name, filter, b, erwartet] of faelle) {
		it(name, () => expect(bonPasst(bon(b), { ...F, ...filter })).toBe(erwartet));
	}
});

const P = (receiptId: string, lineNo: number, rawText: string, cents: number, categoryId: string | null, lineType = 'article', appliesToLine: number | null = null) =>
	({ receiptId, lineNo, rawText, totalPriceCents: cents, categoryId, lineType, appliesToLine });
const MONAT = new Map([['b1', '2026-09'], ['b2', '2026-03']]);
const K = (x: Partial<PositionsKriterien>): PositionsKriterien => ({ ...KEINE_KRITERIEN, ...x });

describe('positionsTreffer', () => {
	const zeilen = [
		P('b1', 1, 'KAFFEE Crema', 500, 'kaffee'),
		P('b1', 2, 'Kaffeebohnen 1kg', 900, 'kaffee'),
		P('b1', 3, 'Rabatt', -100, null, 'discount', 2),
		P('b1', 4, 'Milch', 120, 'milch'),
		P('b1', 5, 'Café au lait', 250, 'kaffee'),
		P('b1', 6, 'Gewicht 0,5 kg', 0, 'kaffee', 'info'),
		P('b1', 7, 'Obst-Rabatt', -30, 'obst', 'discount', 4)
	];

	it('findet Kaffee ohne Gross/Klein und nimmt den Rabatt auf eine gefundene Position mit', () => {
		expect(positionsTreffer(zeilen, K({ suche: 'kaffee' }), MONAT).map((z) => z.lineNo)).toEqual([1, 2, 3]);
	});

	it('sucht ohne Akzentunterschiede', () => {
		expect(positionsTreffer(zeilen, K({ suche: 'cafe' }), MONAT).map((z) => z.lineNo)).toEqual([5]);
		expect(suchNormal('Café ÜBER')).toBe('cafe uber');
	});

	it('sucht woertlich, Sonderzeichen sind keine Muster', () => {
		const sonder = [P('b1', 1, 'Bio (Demeter) 50% c++', 100, null), P('b1', 2, 'Anderes', 100, null)];
		for (const s of ['50%', 'c++', '(demeter)', '%', '.*']) {
			expect(positionsTreffer(sonder, K({ suche: s }), MONAT).map((z) => z.lineNo)).toEqual(s === '.*' ? [] : [1]);
		}
		expect(positionsTreffer(sonder, K({ suche: "'; drop table receipts; --" }), MONAT)).toEqual([]);
	});

	it('zaehlt beim Kategoriefilter jede Zeile in IHRER Kategorie, keine Infozeilen', () => {
		expect(positionsTreffer(zeilen, K({ kategorieIds: new Set(['kaffee']) }), MONAT).map((z) => z.lineNo)).toEqual([1, 2, 5]);
		// Der Obst-Rabatt haengt an der Milch, zaehlt aber zu Obst.
		expect(positionsTreffer(zeilen, K({ kategorieIds: new Set(['obst']) }), MONAT).map((z) => z.lineNo)).toEqual([7]);
	});

	it('trifft mit „Unsortiert" die Zeilen ohne Kategorie', () => {
		expect(positionsTreffer(zeilen, K({ unsortiert: true }), MONAT).map((z) => z.lineNo)).toEqual([3]);
		expect(positionsTreffer(zeilen, K({ unsortiert: true, kategorieIds: new Set(['milch']) }), MONAT).map((z) => z.lineNo)).toEqual([3, 4]);
	});

	it('verknuepft Suche und Kategorie mit UND — auch fuer den mitgenommenen Rabatt', () => {
		// Der Rabatt (ohne Kategorie) haengt an Kaffeebohnen, erfuellt aber „Kategorie kaffee" nicht.
		expect(positionsTreffer(zeilen, K({ suche: 'kaffee', kategorieIds: new Set(['kaffee']) }), MONAT).map((z) => z.lineNo)).toEqual([1, 2]);
	});

	it('nimmt beim Topf die Kategorien des KAUFMONATS', () => {
		const topf = new Map([['2026-09', new Set(['milch'])], ['2026-03', new Set(['kaffee'])]]);
		const beide = [...zeilen, P('b2', 1, 'Kaffee alt', 400, 'kaffee'), P('b2', 2, 'Milch alt', 90, 'milch')];
		expect(positionsTreffer(beide, K({ topfJeMonat: topf }), MONAT).map((z) => `${z.receiptId}#${z.lineNo}`)).toEqual(['b1#4', 'b2#1']);
	});
});

describe('kriterienAktiv', () => {
	it('ist nur mit Positionsmerkmal aktiv', () => {
		expect(kriterienAktiv(KEINE_KRITERIEN)).toBe(false);
		expect(kriterienAktiv(K({ suche: 'x' }))).toBe(true);
		expect(kriterienAktiv(K({ unsortiert: true }))).toBe(true);
		expect(kriterienAktiv(K({ kategorieIds: new Set() }))).toBe(true);
		expect(kriterienAktiv(K({ topfJeMonat: new Map() }))).toBe(true);
	});
});

describe('topfKategorienJeMonat', () => {
	const kategorien = [
		{ id: 'lm', parentId: null },
		{ id: 'brot', parentId: 'lm' },
		{ id: 'haus', parentId: null }
	];
	const toepfe = [{ id: 't1', name: 'Essen', sichtbarkeit: 'geteilt' as const }, { id: 't2', name: 'Haus', sichtbarkeit: 'geteilt' as const }];
	const zuordnungen = [
		{ budgetId: 't1', categoryId: 'lm', giltAb: '2026-01-01', giltBis: '2026-06-30', eigentuemerId: null },
		{ budgetId: 't1', categoryId: 'haus', giltAb: '2026-07-01', giltBis: null, eigentuemerId: null },
		{ budgetId: 't2', categoryId: 'brot', giltAb: '2026-01-01', giltBis: null, eigentuemerId: null }
	];

	it('loest je Monat auf, mit geerbten Unterkategorien und ohne fremde Toepfe', () => {
		const je = topfKategorienJeMonat(['t1'], toepfe, [], zuordnungen, kategorien, ['2026-03', '2026-09']);
		// Im Maerz: Lebensmittel (Brot hat eine eigene Zuordnung zu t2 und gehoert deshalb dorthin).
		expect([...je.get('2026-03')!].sort()).toEqual(['lm']);
		expect([...je.get('2026-09')!].sort()).toEqual(['haus']);
	});
});
