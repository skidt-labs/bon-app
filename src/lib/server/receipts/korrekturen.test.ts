import { describe, it, expect } from 'vitest';
import { korrekturenSchema, pruefeKorrekturen, hatSichGeaendert } from './korrekturen';

const zeile = (over: Record<string, unknown> = {}) => ({
	id: '11111111-2222-4333-8444-555555555555',
	lineNo: 1,
	rawText: 'MILCH',
	lineType: 'article',
	quantity: '1',
	unit: 'stk',
	unitPriceCents: 109,
	totalPriceCents: 109,
	vatClass: 'A',
	appliesToLine: null,
	categoryId: null,
	...over
});

const rumpf = (over: Record<string, unknown> = {}) => ({
	receipt: {
		merchantNameRaw: 'Frischmarkt',
		purchasedAt: '2026-09-16T17:42:00+02:00',
		totalGrossCents: 109,
		paymentMethod: 'card'
	},
	items: [zeile()],
	geloescht: [],
	...over
});

describe('korrekturenSchema', () => {
	it('nimmt einen vollstaendigen Rumpf an', () => {
		expect(korrekturenSchema.safeParse(rumpf()).success).toBe(true);
	});

	it('nimmt eine neue Zeile mit id null an', () => {
		expect(korrekturenSchema.safeParse(rumpf({ items: [zeile({ id: null })] })).success).toBe(true);
	});

	// Der Kern: Geld ist ganzzahliger Cent. "1.09" waere 109 Cent oder 1 Cent — nicht
	// entscheidbar, und ein Fehler um Faktor 100 sieht plausibel aus.
	it('lehnt Dezimalzahlen und Zeichenketten bei Geld ab', () => {
		for (const murks of [1.09, '109', '1,09', null]) {
			expect(korrekturenSchema.safeParse(rumpf({ items: [zeile({ totalPriceCents: murks })] })).success, String(murks)).toBe(false);
		}
	});

	it('laesst unitPriceCents und vatClass null sein, totalPriceCents nicht', () => {
		expect(korrekturenSchema.safeParse(rumpf({ items: [zeile({ unitPriceCents: null, vatClass: null })] })).success).toBe(true);
	});

	it('kennt nur die sechs Zeilenarten', () => {
		expect(korrekturenSchema.safeParse(rumpf({ items: [zeile({ lineType: 'gutschein' })] })).success).toBe(false);
		for (const art of ['article', 'deposit', 'deposit_return', 'discount', 'loyalty', 'info']) {
			expect(korrekturenSchema.safeParse(rumpf({ items: [zeile({ lineType: art })] })).success, art).toBe(true);
		}
	});
});

describe('pruefeKorrekturen', () => {
	it('laesst einen sauberen Bon durch', () => {
		expect(pruefeKorrekturen(korrekturenSchema.parse(rumpf()))).toEqual({ ok: true });
	});

	// Der Server nummeriert NICHT still um: hier tippt ein Mensch, und eine stille
	// Korrektur seiner Eingabe waere eine Behauptung ueber das, was er wollte.
	it('lehnt doppelte Zeilennummern ab und nennt die Nummer', () => {
		const k = korrekturenSchema.parse(rumpf({ items: [zeile(), zeile({ id: null, lineNo: 1, rawText: 'BUTTER' })] }));
		const r = pruefeKorrekturen(k);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.grund).toContain('1');
	});

	it('lehnt Luecken in den Zeilennummern ab', () => {
		const k = korrekturenSchema.parse(rumpf({ items: [zeile(), zeile({ id: null, lineNo: 3, rawText: 'BUTTER' })] }));
		const r = pruefeKorrekturen(k);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.grund).toMatch(/lückenlos/i);
	});

	it('lehnt einen Bezug ins Leere ab', () => {
		const k = korrekturenSchema.parse(rumpf({
			items: [zeile(), zeile({ id: null, lineNo: 2, lineType: 'discount', totalPriceCents: -50, appliesToLine: 7 })]
		}));
		const r = pruefeKorrekturen(k);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.grund).toContain('7');
	});

	it('nimmt einen Bezug auf eine vorhandene Zeile an', () => {
		const k = korrekturenSchema.parse(rumpf({
			items: [zeile(), zeile({ id: null, lineNo: 2, lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })]
		}));
		expect(pruefeKorrekturen(k)).toEqual({ ok: true });
	});

	// Eine Zeile darf nicht auf sich selbst zeigen — der Self-FK der Datenbank
	// verboete es ohnehin, aber die Meldung soll vom Server kommen, nicht von Postgres.
	it('lehnt einen Bezug auf sich selbst ab', () => {
		const k = korrekturenSchema.parse(rumpf({ items: [zeile({ lineType: 'discount', totalPriceCents: -50, appliesToLine: 1 })] }));
		expect(pruefeKorrekturen(k).ok).toBe(false);
	});

	it('lehnt einen Bon ohne Positionen ab', () => {
		expect(pruefeKorrekturen(korrekturenSchema.parse(rumpf({ items: [] }))).ok).toBe(false);
	});
});

describe('hatSichGeaendert', () => {
	const alt = {
		lineNo: 1,
		rawText: 'MILCH',
		lineType: 'article' as const,
		quantity: null,
		unit: null,
		unitPriceCents: null,
		totalPriceCents: 109,
		vatClass: 'A',
		categoryId: null
	};

	it('sieht keine Aenderung, wenn alle Felder gleich sind — auch null gegen null', () => {
		const neu = korrekturenSchema.parse(rumpf({ items: [zeile({ quantity: null, unit: null, unitPriceCents: null })] })).items[0];
		expect(hatSichGeaendert(alt, neu)).toBe(false);
	});

	it('sieht eine Aenderung, sobald ein Feld abweicht', () => {
		const neu = korrekturenSchema.parse(rumpf({ items: [zeile({ quantity: null, unit: null, unitPriceCents: null, totalPriceCents: 119 })] })).items[0];
		expect(hatSichGeaendert(alt, neu)).toBe(true);
	});

	it('zaehlt einen Bezug nicht als Aenderung', () => {
		const neu = korrekturenSchema.parse(rumpf({ items: [zeile({ quantity: null, unit: null, unitPriceCents: null, appliesToLine: 2 }), zeile({ id: null, lineNo: 2 })] })).items[0];
		expect(hatSichGeaendert(alt, neu)).toBe(false);
	});
});
