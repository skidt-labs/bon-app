import { describe, it, expect } from 'vitest';
import { alsFilter, istGeaendert } from './gespeichert';
import { filterAusAdresse } from '$lib/berichte/filter';

const HEUTE = '2026-09-25';
const UUID = '3f2a0b7c-1111-2222-3333-444444444444';

describe('alsFilter', () => {
	it('oeffnet ohne gespeicherten Zeitraum den laufenden Monat', () => {
		const { filter, hinweise } = alsFilter({ parameter: { laden: UUID, suche: 'Kaffee' }, zeitraum: null }, HEUTE);
		expect(filter.zeitraum).toEqual({ art: 'monat', monat: '2026-09' });
		expect(filter.laden).toEqual([UUID]);
		expect(filter.suche).toBe('Kaffee');
		expect(hinweise).toEqual([]);
	});

	it('nimmt einen gespeicherten Zeitraum', () => {
		expect(alsFilter({ parameter: {}, zeitraum: { zeitraum: 'jahr', jahr: '2025' } }, HEUTE).filter.zeitraum).toEqual({ art: 'jahr', jahr: 2025 });
	});

	// Gespeichertes wird wie eine Adresse neu gelesen: Kaputtes gibt einen Hinweis, keinen Fehler.
	it('meldet ungueltige gespeicherte Werte, statt zu scheitern', () => {
		const { filter, hinweise } = alsFilter({ parameter: { laden: 'kaputt', betrag: 'viel', sicht: 'x' }, zeitraum: { zeitraum: 'monat', monat: '1999-13' } }, HEUTE);
		expect(filter.laden).toEqual([]);
		expect(filter.betrag).toBeNull();
		expect(filter.zeitraum).toEqual({ art: 'monat', monat: '2026-09' });
		expect(hinweise).toHaveLength(4);
	});
});

describe('istGeaendert', () => {
	const gespeichert = { parameter: { laden: UUID }, zeitraum: null };
	const lies = (q: string) => filterAusAdresse(new URLSearchParams(q), HEUTE).filter;

	it('vergleicht nur die Merkmale, wenn kein Zeitraum gespeichert ist', () => {
		expect(istGeaendert(gespeichert, lies(`laden=${UUID}&monat=2026-05`))).toBe(false);
		expect(istGeaendert(gespeichert, lies(`laden=${UUID}&suche=x`))).toBe(true);
	});

	it('vergleicht auch den Zeitraum, wenn er gespeichert ist', () => {
		const mit = { parameter: {}, zeitraum: { zeitraum: 'jahr', jahr: '2025' } };
		expect(istGeaendert(mit, lies('zeitraum=jahr&jahr=2025'))).toBe(false);
		expect(istGeaendert(mit, lies('zeitraum=jahr&jahr=2024'))).toBe(true);
	});
});
