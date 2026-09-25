import { describe, it, expect } from 'vitest';
import { haushaltsname } from './household';

describe('haushaltsname', () => {
	it('benennt den eigenen Haushalt nach dem Anzeigenamen', () => {
		expect(haushaltsname('Erika Mustermann')).toBe('Haushalt Erika Mustermann');
	});

	it('faellt auf einen neutralen Namen zurueck, wenn der Anbieter keinen Namen liefert', () => {
		// 'Unbekannt' kommt aus exchangeCode, wenn weder name noch preferred_username da sind.
		expect(haushaltsname('Unbekannt')).toBe('Mein Haushalt');
		expect(haushaltsname('')).toBe('Mein Haushalt');
	});
});
