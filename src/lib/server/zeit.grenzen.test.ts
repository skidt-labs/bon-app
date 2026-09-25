import { describe, it, expect } from 'vitest';
import { tagesgrenzen, jahresgrenzen, heutigerTag } from './zeit';

describe('tagesgrenzen', () => {
	it('legt das Ende auf die NAECHSTE Berliner Mitternacht (bis einschliesslich)', () => {
		const g = tagesgrenzen('2026-09-01', '2026-09-30')!;
		expect(g.von.toISOString()).toBe('2026-08-31T22:00:00.000Z');
		expect(g.bis.toISOString()).toBe('2026-09-30T22:00:00.000Z');
	});

	// Beginn der Sommerzeit (29.03.): Der Tag hat nur 23 Stunden. Ein Einkauf um 23:30
	// Ortszeit gehoert noch zum 29. — das Ende liegt bei 22:00 UTC, nicht bei 23:00.
	it('stimmt am Tag der Fruehjahrsumstellung', () => {
		const g = tagesgrenzen('2026-03-29', '2026-03-29')!;
		expect(g.von.toISOString()).toBe('2026-03-28T23:00:00.000Z');
		expect(g.bis.toISOString()).toBe('2026-03-29T22:00:00.000Z');
		expect(new Date('2026-03-29T21:30:00Z') < g.bis).toBe(true);
	});

	it('stimmt am Tag der Herbstumstellung (25 Stunden)', () => {
		const g = tagesgrenzen('2026-10-25', '2026-10-25')!;
		expect(g.von.toISOString()).toBe('2026-10-24T22:00:00.000Z');
		expect(g.bis.toISOString()).toBe('2026-10-25T23:00:00.000Z');
	});

	it('geht ueber den Jahreswechsel', () => {
		const g = tagesgrenzen('2026-12-31', '2026-12-31')!;
		expect(g.bis.toISOString()).toBe('2026-12-31T23:00:00.000Z');
	});

	it('lehnt Unbrauchbares ab, statt zu raten', () => {
		expect(tagesgrenzen('2026-02-30', '2026-03-01')).toBeNull();
		expect(tagesgrenzen('2026-03-02', '2026-03-01')).toBeNull();
		expect(tagesgrenzen('x', '2026-03-01')).toBeNull();
	});
});

describe('jahresgrenzen', () => {
	it('beginnt und endet an Berliner Neujahrsmitternacht', () => {
		const g = jahresgrenzen(2026)!;
		expect(g.von.toISOString()).toBe('2025-12-31T23:00:00.000Z');
		expect(g.bis.toISOString()).toBe('2026-12-31T23:00:00.000Z');
		expect(jahresgrenzen(2026.5)).toBeNull();
	});
});

describe('heutigerTag', () => {
	it('liest den Berliner Kalendertag, nicht den UTC-Tag', () => {
		expect(heutigerTag(new Date('2026-09-24T22:30:00Z'))).toBe('2026-09-25');
		expect(heutigerTag(new Date('2026-09-24T21:30:00Z'))).toBe('2026-09-24');
	});
});
