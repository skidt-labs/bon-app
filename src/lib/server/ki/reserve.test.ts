import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import { monatVon, euro, uhrzeit, textUmschalten, textZurueck, textGrenze, STANDARD_GRENZE_MICRO } from './reserve';

describe('monatVon — Kalendermonat in Berliner Zeit', () => {
	it('der 30.09. 23:30 Berliner Zeit gehoert noch zum September', () => {
		expect(monatVon(new Date('2026-09-30T21:30:00Z'))).toBe('2026-09');
	});
	it('der 01.10. 00:10 Berliner Zeit gehoert schon zum Oktober', () => {
		expect(monatVon(new Date('2026-09-30T22:10:00Z'))).toBe('2026-10');
	});
	it('rechnet auch an der Umstellung auf Sommerzeit richtig', () => {
		expect(monatVon(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03');
		expect(monatVon(new Date('2026-02-28T23:30:00Z'))).toBe('2026-03');
	});
});

describe('euro', () => {
	it('schreibt Millionstel Euro mit zwei Nachkommastellen und Komma', () => {
		expect(euro(30_000)).toBe('0,03 €');
		expect(euro(5_000_000)).toBe('5,00 €');
		expect(euro(0)).toBe('0,00 €');
		expect(euro(1_234_567)).toBe('1,23 €');
	});
	it('die Vorgabe der Monatsgrenze sind 5 €', () => {
		expect(euro(STANDARD_GRENZE_MICRO)).toBe('5,00 €');
	});
});

describe('uhrzeit', () => {
	it('zeigt Stunde und Minute in Berliner Zeit', () => {
		expect(uhrzeit(new Date('2026-10-01T21:14:00Z'))).toBe('23:14');
		expect(uhrzeit(new Date('2026-10-02T04:40:00Z'))).toBe('06:40');
	});
});

describe('Meldetexte', () => {
	it('Umschalten nennt Grund und Reserve', () => {
		expect(textUmschalten('Abacus Reserve', 'Zeitüberschreitung')).toBe(
			'KI: Mac nicht erreichbar (Zeitüberschreitung) – Reserve „Abacus Reserve“ liest ab jetzt.'
		);
	});
	it('Zurueck nennt Zeitraum, Laeufe und Kosten', () => {
		expect(
			textZurueck(new Date('2026-10-01T21:14:00Z'), new Date('2026-10-02T04:40:00Z'), { kostenMicro: 30_000, laeufe: 7 })
		).toBe('KI: Mac wieder da – Reserve lief 23:14–06:40, 7 Läufe, 0,03 €.');
	});
	it('Zurueck nach genau einem Lauf sagt „1 Lauf“', () => {
		expect(
			textZurueck(new Date('2026-10-01T21:14:00Z'), new Date('2026-10-01T21:20:00Z'), { kostenMicro: 4_000, laeufe: 1 })
		).toBe('KI: Mac wieder da – Reserve lief 23:14–23:20, 1 Lauf, 0,00 €.');
	});
	it('Grenze nennt den Betrag', () => {
		expect(textGrenze(5_000_000)).toBe('KI: Monatsgrenze der Reserve erreicht (5,00 €) – Bons warten auf den Mac.');
	});
});
