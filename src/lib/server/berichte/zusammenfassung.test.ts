import { describe, it, expect } from 'vitest';
import { matrixZusammenfassung, TEXT_HOECHSTENS, OHNE_LINK } from './zusammenfassung';
import { filterAlsAdresse, leererFilter } from '$lib/berichte/filter';
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
		expect(text).toContain('Kein Vergleich zu September 2025 — dort liegt kein passender bestätigter Bon');
	});
});

// Sammelfassung 3.10: ab etwa 60–70 Laeden verwarf der Bot den Bericht still (laenger als
// TEXT_HOECHSTENS), die Seite sagte trotzdem „unterwegs".
describe('matrixZusammenfassung: viele Laeden', () => {
	const id = (n: number) => `3f2a0b7c-1111-2222-3333-${String(n).padStart(12, '0')}`;
	const mitLaeden = (anzahl: number) => {
		const laden = Array.from({ length: anzahl }, (_, i) => id(i + 1));
		const namen = { ...LEERE_NAMEN, laden: Object.fromEntries(laden.map((l, i) => [l, `Testmarkt Musterstadt Filiale ${i + 1}`])) };
		const filter = { ...bericht.filter, laden };
		return { b: { ...bericht, filter, namen }, link: `https://bon.example.org/reports?${filterAlsAdresse(filter)}` };
	};

	it('laesst einen Bericht, der passt, ungekuerzt', () => {
		const { b, link } = mitLaeden(5);
		const text = matrixZusammenfassung(b, 'Familie Beispiel', link);
		expect(text).toContain('Testmarkt Musterstadt Filiale 5');
		expect(text.split('\n').at(-1)).toBe(link);
	});

	it('kuerzt die Namen, wenn der Text sonst zu lang waere, und behaelt den Link', () => {
		const { b, link } = mitLaeden(70);
		const text = matrixZusammenfassung(b, 'Familie Beispiel', link);
		expect(text.length).toBeLessThanOrEqual(TEXT_HOECHSTENS);
		expect(text).toContain('Laden: Testmarkt Musterstadt Filiale 1, Testmarkt Musterstadt Filiale 2, Testmarkt Musterstadt Filiale 3 und 67 weitere');
		expect(text.split('\n').at(-1)).toBe(link);
	});

	it('laesst den Link mit Hinweis weg, wenn er auch gekuerzt nicht passt', () => {
		const { b, link } = mitLaeden(120);
		expect(link.length).toBeGreaterThan(TEXT_HOECHSTENS);
		const text = matrixZusammenfassung(b, 'Familie Beispiel', link);
		expect(text.length).toBeLessThanOrEqual(TEXT_HOECHSTENS);
		expect(text).toContain('und 117 weitere');
		expect(text).not.toContain('http');
		expect(text.split('\n').at(-1)).toBe(OHNE_LINK);
	});
});
