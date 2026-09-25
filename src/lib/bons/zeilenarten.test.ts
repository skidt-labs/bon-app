import { describe, it, expect } from 'vitest';
import { ZEILENARTEN, MONETAER, ART_TEXT } from './zeilenarten';
import { lineType } from '$lib/server/db/schema';

describe('Zeilenarten', () => {
	// Das Drizzle-Enum schreibt die Werte aus, weil es die Wahrheit der Datenbank ist.
	// Dieser Test ist die Klammer: laufen die beiden auseinander, faellt es hier auf und
	// nicht erst an einer Zeile, die in der Summe fehlt.
	it('deckt sich mit dem Enum der Datenbank', () => {
		expect([...ZEILENARTEN]).toEqual([...lineType.enumValues]);
	});

	it('kennt zu jeder Art einen deutschen Namen', () => {
		expect(Object.keys(ART_TEXT).sort()).toEqual([...ZEILENARTEN].sort());
	});

	it('zaehlt nur Arten zur Summe, die es gibt — ohne loyalty und info', () => {
		for (const a of MONETAER) expect(ZEILENARTEN).toContain(a);
		expect(MONETAER).not.toContain('loyalty');
		expect(MONETAER).not.toContain('info');
	});
});
