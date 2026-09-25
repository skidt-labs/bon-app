import { describe, it, expect } from 'vitest';
import { monatsgrenzen, aktuellerMonat, naechsterMonat } from './zeit';

describe('naechsterMonat', () => {
	it('zaehlt einen Monat weiter', () => {
		expect(naechsterMonat('2026-09')).toBe('2026-10');
	});
	it('geht ueber den Jahreswechsel', () => {
		expect(naechsterMonat('2026-12')).toBe('2027-01');
	});
	it('liefert null statt zu raten', () => {
		expect(naechsterMonat('quatsch')).toBeNull();
		expect(naechsterMonat('2026-13')).toBeNull();
	});
});

describe('monatsgrenzen (Europe/Berlin)', () => {
	// Der Maerz beginnt in Berlin um 00:00 MEZ = 23:00 UTC am Vortag und endet nach dem
	// Wechsel auf Sommerzeit um 00:00 MESZ = 22:00 UTC. Wer hier UTC-Mitternacht nimmt,
	// verschiebt jeden Bon zwischen 23 und 24 Uhr in den falschen Monat.
	it('liegt an Berliner Mitternacht, auch ueber den Sommerzeitwechsel', () => {
		const g = monatsgrenzen('2026-03');
		expect(g?.von.toISOString()).toBe('2026-02-28T23:00:00.000Z');
		expect(g?.bis.toISOString()).toBe('2026-03-31T22:00:00.000Z');
	});

	it('kann den Jahreswechsel', () => {
		const g = monatsgrenzen('2026-12');
		expect(g?.von.toISOString()).toBe('2026-11-30T23:00:00.000Z');
		expect(g?.bis.toISOString()).toBe('2026-12-31T23:00:00.000Z');
	});

	// Kein stiller Rueckfall: ein unbrauchbarer Monat ergibt null, und der Aufrufer
	// muss entscheiden, was er dem Menschen sagt.
	it('lehnt Unbrauchbares ab', () => {
		for (const murks of ['2026-13', '2026-3', '13.2026', '', 'heute', '2026-00']) {
			expect(monatsgrenzen(murks), murks).toBeNull();
		}
	});
});

describe('aktuellerMonat', () => {
	// 2026-08-31 23:30 UTC ist in Berlin schon der 1. September 01:30.
	it('rechnet in Berliner Zeit, nicht in UTC', () => {
		expect(aktuellerMonat(new Date('2026-08-31T23:30:00Z'))).toBe('2026-09');
		expect(aktuellerMonat(new Date('2026-08-31T21:30:00Z'))).toBe('2026-08');
	});
});
