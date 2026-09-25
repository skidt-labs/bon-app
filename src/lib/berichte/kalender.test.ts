import { describe, it, expect } from 'vitest';
import {
	istMonat, istTag, tagPlus, tageZwischen, monatPlus, letzterTag, ersterTag,
	monatVon, jahrVon, jahrePlus, monatsName, monatsKurz, tagName
} from './kalender';

describe('istMonat / istTag', () => {
	it('erkennt gueltige Monate und Tage', () => {
		expect(istMonat('2026-09')).toBe(true);
		expect(istMonat('2026-13')).toBe(false);
		expect(istMonat('2026-9')).toBe(false);
		expect(istTag('2028-02-29')).toBe(true);
		expect(istTag('2026-02-29')).toBe(false);
		expect(istTag('2026-04-31')).toBe(false);
		expect(istTag('2026-9-01')).toBe(false);
	});
});

describe('Tagesrechnung', () => {
	it('geht ueber Monats- und Jahreswechsel', () => {
		expect(tagPlus('2026-12-31', 1)).toBe('2027-01-01');
		expect(tagPlus('2026-03-01', -1)).toBe('2026-02-28');
		expect(tagPlus('2026-03-28', 1)).toBe('2026-03-29');
	});

	it('zaehlt Tage unabhaengig von der Sommerzeit', () => {
		expect(tageZwischen('2026-03-01', '2026-03-31')).toBe(30);
		expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2);
		expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
	});

	it('verschiebt um Jahre und macht aus dem 29. Februar im Gemeinjahr den 28.', () => {
		expect(jahrePlus('2026-09-25', -3)).toBe('2023-09-25');
		expect(jahrePlus('2028-02-29', -1)).toBe('2027-02-28');
	});
});

describe('Monatsrechnung', () => {
	it('verschiebt Monate ueber Jahresgrenzen', () => {
		expect(monatPlus('2026-01', -1)).toBe('2025-12');
		expect(monatPlus('2025-12', 1)).toBe('2026-01');
		expect(monatPlus('2026-09', -12)).toBe('2025-09');
		expect(monatPlus('2026-09', -21)).toBe('2024-12');
	});

	it('kennt ersten und letzten Tag', () => {
		expect(ersterTag('2026-09')).toBe('2026-09-01');
		expect(letzterTag('2028-02')).toBe('2028-02-29');
		expect(letzterTag('2026-02')).toBe('2026-02-28');
		expect(monatVon('2026-09-25')).toBe('2026-09');
		expect(jahrVon('2026-09-25')).toBe(2026);
	});
});

describe('Namen', () => {
	it('schreibt Monate und Tage auf Deutsch', () => {
		expect(monatsName('2026-09')).toBe('September 2026');
		expect(monatsName('2026-03')).toBe('März 2026');
		expect(monatsKurz('2026-03')).toBe('Mär');
		expect(tagName('2026-09-25', false)).toBe('25. Sept.');
		expect(tagName('2026-05-01')).toBe('1. Mai 2026');
		expect(tagName('2025-12-01')).toBe('1. Dez. 2025');
	});
});
