import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Sammelfassung 3.2: Die Druckansicht sagt dasselbe wie die Berichtsseite. Ihr Leertext stand
 * fest auf „… keinen passenden bestätigten Bon" — auch OHNE Filter, wo die Seite „ist noch kein
 * Bon bestätigt" sagt. Ohne jsdom laesst sich die Seite nicht darstellen; deshalb prueft dieser
 * Test den Quelltext (wie tor.lint.test.ts). Die Saetze selbst prueft zeitleiste.test.ts an
 * leerText und vergleichText.
 */
const quelle = readFileSync('src/routes/reports/druck/+page.svelte', 'utf8');

describe('Druckansicht: dieselben Saetze wie der Bericht', () => {
	it('nimmt den Leertext aus leerText', () => {
		expect(quelle).not.toContain('gibt es keinen passenden bestätigten Bon');
		expect(quelle).toContain('{leerText(data.filter).text}');
	});

	it('gibt vergleichText den Filter mit', () => {
		expect(quelle).toContain('{vergleichText(v, data.filter)}');
	});
});
