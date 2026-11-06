import { describe, it, expect } from 'vitest';
import { unterschiede, rueckfrageSatz } from './vergleich';

const bon = {
	merchantNameRaw: 'Testmarkt Musterstadt',
	purchasedAt: '2026-09-21T19:00:00Z',
	totalGrossCents: 3146,
	anzahlPositionen: 12
};

describe('unterschiede', () => {
	it('gleiche Werte → keine', () => {
		expect([...unterschiede(bon, { ...bon })]).toEqual([]);
	});

	it('eine andere Summe', () => {
		expect([...unterschiede(bon, { ...bon, totalGrossCents: 3145 })]).toEqual(['summe']);
	});

	it('fehlt die Kaufzeit bei einem, ist das ein Unterschied', () => {
		expect([...unterschiede(bon, { ...bon, purchasedAt: null })]).toEqual(['kaufzeit']);
	});

	it('Laden gleich bis auf Gross/Klein → kein Unterschied', () => {
		expect([...unterschiede(bon, { ...bon, merchantNameRaw: 'TESTMARKT musterstadt' })]).toEqual([]);
	});

	it('Date und Text derselben Zeit sind gleich; fehlt bei beiden, zaehlt es auch', () => {
		expect([...unterschiede(bon, { ...bon, purchasedAt: new Date('2026-09-21T19:00:00Z') })]).toEqual([]);
		const leer = { merchantNameRaw: null, purchasedAt: null, totalGrossCents: null, anzahlPositionen: 0 };
		expect([...unterschiede(leer, { ...leer })].sort()).toEqual(['kaufzeit', 'laden', 'summe']);
	});

	it('andere Zahl der Positionen', () => {
		expect([...unterschiede(bon, { ...bon, anzahlPositionen: 11 })]).toEqual(['positionen']);
	});
});

describe('rueckfrageSatz', () => {
	it('mit Datum und Summe', () => {
		expect(rueckfrageSatz({ purchasedAt: '2026-09-21T19:00:00Z', totalGrossCents: 3146 })).toBe(
			'Der Bon vom 21.09. (31,46 €) kommt in den Papierkorb. 30 Tage lang kannst du ihn wiederherstellen.'
		);
	});

	it('ohne beides', () => {
		expect(rueckfrageSatz({ purchasedAt: null, totalGrossCents: null })).toBe(
			'Der Bon ohne Datum (ohne Summe) kommt in den Papierkorb. 30 Tage lang kannst du ihn wiederherstellen.'
		);
	});

	// Abschlusspruefung (Klein 6, hochgestuft): bei echten Doppeln sind Datum und Summe gleich —
	// die Nummer sagt, welcher gemeint ist; ein bestaetigter faellt aus Berichten und Budgets.
	it('mit Nummer der Spalte', () => {
		expect(rueckfrageSatz({ purchasedAt: '2026-09-21T19:00:00Z', totalGrossCents: 3146, status: 'review' }, 2)).toBe(
			'Bon 2 vom 21.09. (31,46 €) kommt in den Papierkorb. 30 Tage lang kannst du ihn wiederherstellen.'
		);
	});

	it('bestaetigter Bon: sagt, dass er aus Berichten und Budgets faellt', () => {
		expect(rueckfrageSatz({ purchasedAt: '2026-09-21T19:00:00Z', totalGrossCents: 3146, status: 'confirmed' }, 1)).toBe(
			'Bon 1 vom 21.09. (31,46 €) kommt in den Papierkorb. Er ist bestätigt und zählt dann nicht mehr in Berichten und Budgets. 30 Tage lang kannst du ihn wiederherstellen.'
		);
	});

	it('Datum nach Berliner Zeit', () => {
		expect(rueckfrageSatz({ purchasedAt: new Date('2026-09-21T22:30:00Z'), totalGrossCents: 100 })).toBe(
			'Der Bon vom 22.09. (1,00 €) kommt in den Papierkorb. 30 Tage lang kannst du ihn wiederherstellen.'
		);
	});
});
