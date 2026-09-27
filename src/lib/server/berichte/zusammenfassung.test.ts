import { describe, it, expect } from 'vitest';
import { matrixZusammenfassung } from './zusammenfassung';
import { leererFilter } from '$lib/berichte/filter';
import { LEERE_NAMEN } from '$lib/berichte/merkmale';

const bericht = {
	filter: leererFilter({ art: 'monat', monat: '2026-09' }),
	namen: LEERE_NAMEN,
	kennzahlen: { summe: 26840, bons: 11 },
	vergleiche: [{ bezeichnung: 'August 2026', cents: 24110, prozent: 11 }, { bezeichnung: 'September 2025', cents: null, prozent: null }],
	kategorien: [
		{ id: 'lm', name: 'Lebensmittel', cents: 20000 },
		{ id: null, name: 'Unsortiert', cents: 30000 }
	]
};

describe('matrixZusammenfassung', () => {
	it('fasst zusammen, ohne Positionen und ohne einzelne Bons', () => {
		expect(matrixZusammenfassung(bericht, 'Familie Beispiel', 'https://bon.example.org/reports?zeitraum=monat&monat=2026-09')).toBe(
			[
				'Bericht Familie Beispiel — September 2026',
				'Ganzer Haushalt · ohne Filter',
				'Ausgaben: 268,40 € in 11 Bons (Summe der Bons)',
				'+11 % zu August 2026',
				'Kein Vergleich zu September 2025 — dort liegt kein bestätigter Bon',
				// Der groesste EINGEORDNETE Posten — nicht der Sammelposten fuer Unsortiertes.
				'Größter Posten: Lebensmittel (200,00 €)',
				'Nur bestätigte Bons.',
				'https://bon.example.org/reports?zeitraum=monat&monat=2026-09'
			].join('\n')
		);
	});

	it('nennt Umfang, Filter und Zaehlweise', () => {
		const text = matrixZusammenfassung(
			{ ...bericht, filter: { ...bericht.filter, umfang: 'meine', suche: 'Kaffee' }, kategorien: [], kennzahlen: { summe: 500, bons: 1 } },
			'Familie Beispiel',
			null
		);
		expect(text.split('\n').slice(1, 3)).toEqual(['Nur meine Bons · Suche: „Kaffee"', 'Ausgaben: 5,00 € in 1 Bon (Summe der passenden Positionen)']);
		expect(text).not.toContain('Größter Posten');
		expect(text).not.toContain('http');
	});
});
