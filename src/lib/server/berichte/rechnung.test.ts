import { describe, it, expect } from 'vitest';
import {
	nachKategorie, nachHaendler, budgetstand, direkteCentsJeKategorie, passendePositionen,
	kategorienAufloesen, summeJeBon, vergleichMit, verlaufRechnen, budgetImJahr
} from './rechnung';

const KATEGORIEN = [
	{ id: 'lm', name: 'Lebensmittel', parentId: null },
	{ id: 'brot', name: 'Brot', parentId: 'lm' },
	{ id: 'obst', name: 'Obst', parentId: 'lm' },
	{ id: 'haus', name: 'Haushalt', parentId: null },
	{ id: 'reinig', name: 'Reinigung', parentId: 'haus' }
];

const z = (categoryId: string | null, cents: number, lineType = 'article') =>
	({ categoryId, totalPriceCents: cents, lineType }) as const;

describe('nachKategorie', () => {
	it('fasst die Unterkategorien unter ihrer Oberkategorie zusammen', () => {
		const p = nachKategorie([z('brot', 300), z('obst', 200), z('reinig', 500)], KATEGORIEN);
		expect(p.map((x) => [x.name, x.cents])).toEqual([
			['Haushalt', 500],
			['Lebensmittel', 500]
		]);
		expect(p.find((x) => x.name === 'Lebensmittel')?.kinder.map((k) => [k.name, k.cents])).toEqual([
			['Brot', 300],
			['Obst', 200]
		]);
	});

	// Info-Zeilen tragen kein Geld: sie stehen auf dem Bon, aber nicht im Einkauf.
	// Zaehlte man sie mit, waere jeder Bericht um die Gewichtszeilen zu hoch.
	it('laesst Infozeilen aussen vor', () => {
		const p = nachKategorie([z('brot', 300), z('brot', 9999, 'info')], KATEGORIEN);
		expect(p[0].cents).toBe(300);
	});

	// Pfandrueckgabe und Rabatt sind negativ und muessen abgezogen werden — sonst
	// erscheint zurueckgebrachtes Leergut als Ausgabe.
	it('zieht Pfandrueckgabe und Rabatt ab', () => {
		const p = nachKategorie(
			[z('brot', 300), z('brot', -100, 'deposit_return'), z('brot', -50, 'discount')],
			KATEGORIEN
		);
		expect(p[0].cents).toBe(150);
	});

	// Was keine Kategorie hat, verschwindet NICHT: es steht als eigener Posten da, und
	// zwar am Ende. Ein Bericht, der Unsortiertes unterschlaegt, stimmt nicht.
	it('zeigt Unsortiertes als eigenen Posten am Ende', () => {
		const p = nachKategorie([z('brot', 300), z(null, 700)], KATEGORIEN);
		expect(p.map((x) => x.name)).toEqual(['Lebensmittel', 'Unsortiert']);
		expect(p.find((x) => x.id === null)?.cents).toBe(700);
	});

	it('nennt den Anteil an der Gesamtsumme', () => {
		const p = nachKategorie([z('brot', 750), z('reinig', 250)], KATEGORIEN);
		expect(p.find((x) => x.name === 'Lebensmittel')?.anteil).toBeCloseTo(0.75, 3);
	});

	it('kommt mit einem leeren Monat zurecht', () => {
		expect(nachKategorie([], KATEGORIEN)).toEqual([]);
	});

	// Eine Kategorie, die es nicht (mehr) gibt, faellt nach Unsortiert statt zu
	// verschwinden — ihr Geld wurde ja ausgegeben.
	it('legt eine unbekannte Kategorie zu Unsortiert', () => {
		const p = nachKategorie([z('gibtesnicht', 400)], KATEGORIEN);
		expect(p).toEqual([expect.objectContaining({ id: null, name: 'Unsortiert', cents: 400 })]);
	});
});

describe('nachHaendler', () => {
	it('summiert je Haendler, groesster zuerst', () => {
		const h = nachHaendler([
			{ haendler: 'Lidl', cents: 1000 },
			{ haendler: 'ALDI', cents: 3000 },
			{ haendler: 'Lidl', cents: 500 }
		]);
		expect(h.map((x) => [x.name, x.cents])).toEqual([
			['ALDI', 3000],
			['Lidl', 1500]
		]);
	});

	it('fasst Bons ohne Haendler unter einem eigenen Posten', () => {
		const h = nachHaendler([{ haendler: null, cents: 700 }]);
		expect(h[0].name).toBe('Unbekannter Händler');
	});

	it('haelt Haendler mit Id auseinander und traegt die Id mit', () => {
		const h = nachHaendler([
			{ haendlerId: 'm1', haendler: 'Lidl', cents: 1000 },
			{ haendlerId: 'm1', haendler: 'Lidl', cents: 500 },
			{ haendlerId: null, haendler: 'Lidl', cents: 200 }
		]);
		expect(h).toEqual([
			{ id: 'm1', name: 'Lidl', cents: 1500, anteil: 1500 / 1700 },
			{ id: null, name: 'Lidl', cents: 200, anteil: 200 / 1700 }
		]);
	});
});

describe('budgetstand', () => {
	it('haelt die Ausgaben je Topf gegen den Betrag', () => {
		const s = budgetstand(
			[
				{
					budgetId: 'b1',
					name: 'Essen',
					sichtbarkeit: 'geteilt',
					betragCents: 20000,
					kategorieIds: ['brot', 'obst']
				}
			],
			{
				geteilt: new Map([
					['brot', 5000],
					['obst', 3000]
				]),
				privat: new Map()
			}
		);
		expect(s[0]).toMatchObject({ name: 'Essen', betragCents: 20000, ausgabeCents: 8000 });
		expect(s[0].anteil).toBeCloseTo(0.4, 3);
	});

	// Ohne festgelegten Betrag gibt es keinen Anteil — ein Balken bei 0 Prozent waere
	// eine Behauptung ueber ein Budget, das niemand gesetzt hat.
	it('gibt ohne Betrag keinen Anteil vor', () => {
		const s = budgetstand(
			[{ budgetId: 'b1', name: 'Essen', sichtbarkeit: 'geteilt', betragCents: null, kategorieIds: ['brot'] }],
			{ geteilt: new Map([['brot', 5000]]), privat: new Map() }
		);
		expect(s[0].ausgabeCents).toBe(5000);
		expect(s[0].anteil).toBeNull();
	});

	it('bedient einen privaten Topf NICHT aus den geteilten Ausgaben', () => {
		// Scope zu Scope. Zaehlte ein privater Topf ueber alles, was der Anfragende sehen
		// darf, stuenden in "Geschenke" auch die geteilten Einkaeufe des Haushalts.
		const quellen = {
			geteilt: new Map([['geschenke', 9900]]),
			privat: new Map([['geschenke', 2500]])
		};
		const [privat] = budgetstand(
			[{ budgetId: 'p', name: 'Geschenke', sichtbarkeit: 'privat', betragCents: null, kategorieIds: ['geschenke'] }],
			quellen
		);
		const [geteilt] = budgetstand(
			[{ budgetId: 'g', name: 'Haushalt', sichtbarkeit: 'geteilt', betragCents: null, kategorieIds: ['geschenke'] }],
			quellen
		);
		expect(privat.ausgabeCents).toBe(2500);
		expect(geteilt.ausgabeCents).toBe(9900);
	});

	it('meldet auch einen Topf ohne Ausgaben', () => {
		const s = budgetstand(
			[{ budgetId: 'b1', name: 'Essen', sichtbarkeit: 'geteilt', betragCents: 10000, kategorieIds: ['brot'] }],
			{ geteilt: new Map(), privat: new Map() }
		);
		expect(s[0].ausgabeCents).toBe(0);
		expect(s[0].anteil).toBe(0);
	});
});

describe('direkteCentsJeKategorie', () => {
	// `posten` kommt aus nachKategorie: `cents` der Oberkategorie enthaelt die Kinder
	// bereits. Genau das macht die Umkehrung hier noetig.
	const posten = (
		id: string | null,
		cents: number,
		kinder: { id: string; cents: number }[] = []
	) => ({
		id,
		name: id ?? 'Unsortiert',
		cents,
		anteil: 0,
		kinder: kinder.map((k) => ({ ...k, name: k.id }))
	});

	it('zieht die Kinder von der Oberkategorie ab', () => {
		// 10 EUR unter "Brot", sonst nichts. Der Topf "Lebensmittel" deckt die
		// Oberkategorie ab und loest zu Eltern UND Kind auf — vorher ergab das 20 EUR.
		const je = direkteCentsJeKategorie([posten('lebensmittel', 1000, [{ id: 'brot', cents: 1000 }])]);
		expect(je.get('lebensmittel')).toBe(0);
		expect(je.get('brot')).toBe(1000);
		expect([...je.values()].reduce((a, b) => a + b, 0)).toBe(1000);
	});

	it('laesst eine direkt gebuchte Oberkategorie unveraendert', () => {
		const je = direkteCentsJeKategorie([posten('drogerie', 750)]);
		expect(je.get('drogerie')).toBe(750);
	});

	it('trennt direkt Gebuchtes von dem der Kinder', () => {
		// 5 EUR direkt auf "Lebensmittel", 10 EUR auf "Brot".
		const je = direkteCentsJeKategorie([posten('lebensmittel', 1500, [{ id: 'brot', cents: 1000 }])]);
		expect(je.get('lebensmittel')).toBe(500);
		expect(je.get('brot')).toBe(1000);
		expect([...je.values()].reduce((a, b) => a + b, 0)).toBe(1500);
	});

	it('kommt mit mehreren Kindern zurecht', () => {
		const je = direkteCentsJeKategorie([
			posten('lebensmittel', 3000, [
				{ id: 'brot', cents: 1000 },
				{ id: 'obst', cents: 1800 }
			])
		]);
		expect(je.get('lebensmittel')).toBe(200);
		expect([...je.values()].reduce((a, b) => a + b, 0)).toBe(3000);
	});

	it('laesst Unsortiert (id null) weg, ohne dessen Kinder zu verlieren', () => {
		const je = direkteCentsJeKategorie([posten(null, 400)]);
		expect(je.size).toBe(0);
	});
});

const P = (receiptId: string, categoryId: string | null, cents: number, lineType = 'article') =>
	({ receiptId, categoryId, totalPriceCents: cents, lineType }) as const;

describe('passendePositionen', () => {
	it('nimmt Geldzeilen der gewaehlten Kategorien, keine Infozeilen', () => {
		const zeilen = [P('b1', 'brot', 300), P('b1', 'brot', 0, 'info'), P('b1', 'obst', 200), P('b2', null, 100)];
		expect(passendePositionen(zeilen, new Set(['brot']))).toEqual([P('b1', 'brot', 300)]);
	});

	// Rabatt und Pfand tragen ihr Vorzeichen und zaehlen in IHRER Kategorie. Ein Obst-Rabatt,
	// der per applies_to_line am Brot haengt, macht das Brot nicht billiger.
	it('zaehlt eine Rabattzeile nur, wenn sie selbst die Kategorie traegt', () => {
		const zeilen = [P('b1', 'brot', 300), P('b1', 'brot', -50, 'discount'), P('b1', 'obst', -30, 'discount')];
		expect(passendePositionen(zeilen, new Set(['brot'])).map((z) => z.totalPriceCents)).toEqual([300, -50]);
	});
});

describe('kategorienAufloesen', () => {
	const MIT_SLUG = [
		{ id: 'lm', slug: 'lebensmittel', parentId: null },
		{ id: 'brot', slug: 'brot', parentId: 'lm' },
		{ id: 'obst', slug: 'obst', parentId: 'lm' },
		{ id: 'haus', slug: 'haushalt', parentId: null }
	];

	it('schliesst bei einer Oberkategorie die Kinder ein', () => {
		expect(kategorienAufloesen(['lebensmittel'], MIT_SLUG)).toEqual({ ids: new Set(['lm', 'brot', 'obst']), unbekannt: [] });
		expect(kategorienAufloesen(['obst'], MIT_SLUG)).toEqual({ ids: new Set(['obst']), unbekannt: [] });
	});

	it('meldet Unbekanntes getrennt', () => {
		expect(kategorienAufloesen(['gibtsnicht', 'haushalt'], MIT_SLUG)).toEqual({ ids: new Set(['haus']), unbekannt: ['gibtsnicht'] });
		expect(kategorienAufloesen([], MIT_SLUG)).toEqual({ ids: new Set(), unbekannt: [] });
	});
});

describe('summeJeBon', () => {
	it('summiert je Bon nur Geldzeilen', () => {
		const m = summeJeBon([P('b1', 'brot', 300), P('b1', 'brot', -50, 'discount'), P('b1', 'brot', 999, 'info'), P('b2', 'obst', 200)]);
		expect([...m.entries()]).toEqual([['b1', 250], ['b2', 200]]);
	});
});

describe('vergleichMit', () => {
	it('rechnet die Veraenderung in ganzen Prozent', () => {
		expect(vergleichMit(1200, 'August 2026', [600, 400])).toEqual({ bezeichnung: 'August 2026', cents: 1000, prozent: 20 });
		expect(vergleichMit(900, 'August 2026', [1000])).toEqual({ bezeichnung: 'August 2026', cents: 1000, prozent: -10 });
	});

	it('gibt null statt 0 %, wenn im Vergleichszeitraum nichts liegt', () => {
		expect(vergleichMit(1200, 'August 2026', [])).toEqual({ bezeichnung: 'August 2026', cents: null, prozent: null });
	});

	it('gibt keinen Prozentwert gegen eine Summe von 0', () => {
		expect(vergleichMit(1200, 'August 2026', [0])).toEqual({ bezeichnung: 'August 2026', cents: 0, prozent: null });
	});
});

describe('verlaufRechnen', () => {
	const achse = [
		{ monat: '2026-08', offen: false },
		{ monat: '2026-09', offen: false },
		{ monat: '2026-10', offen: true }
	];

	it('liefert jeden Achsenmonat, auch leere, und offene ohne Betrag', () => {
		expect(verlaufRechnen([{ monat: '2026-09', cents: 500 }, { monat: '2026-09', cents: 300 }], achse, false)).toEqual([
			{ monat: '2026-08', cents: 0, offen: false, vorjahrCents: null },
			{ monat: '2026-09', cents: 800, offen: false, vorjahrCents: null },
			{ monat: '2026-10', cents: 0, offen: true, vorjahrCents: null }
		]);
	});

	it('traegt den Vorjahreswert nur, wo im Vorjahresmonat Bons lagen', () => {
		const v = verlaufRechnen([{ monat: '2025-09', cents: 700 }, { monat: '2026-09', cents: 800 }], achse, true);
		expect(v.map((x) => x.vorjahrCents)).toEqual([null, 700, null]);
	});
});

describe('budgetImJahr', () => {
	const stand = (budgetId: string, anteil: number | null) => ({
		budgetId, name: budgetId === 't1' ? 'Lebensmittel' : 'Freizeit', betragCents: anteil === null ? null : 1000,
		ausgabeCents: anteil === null ? 0 : anteil * 1000, anteil
	});

	it('zaehlt je Topf die Monate im Rahmen und die Monate mit Betrag', () => {
		expect(budgetImJahr([[stand('t1', 0.8), stand('t2', null)], [stand('t1', 1.2), stand('t2', 0.5)], [stand('t1', 1)]])).toEqual([
			{ budgetId: 't1', name: 'Lebensmittel', monateImRahmen: 2, monateMitBetrag: 3 },
			{ budgetId: 't2', name: 'Freizeit', monateImRahmen: 1, monateMitBetrag: 1 }
		]);
	});
});
