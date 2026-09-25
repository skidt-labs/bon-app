import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verbotenImporte } from './tor';

/**
 * "Alle Abfragen gehen durchs Tor" ist eine Zusicherung, die man vergisst — spaetestens
 * bei der naechsten Route, die jemand in Eile anlegt. Ein Test ist es nicht.
 *
 * Geprueft wird der Quelltext, nicht das Verhalten: keine Datei unter src/routes darf
 * die Tabellen selbst importieren. Wer den Filter nicht sieht, kann ihn nicht vergessen.
 *
 * Die eigentliche Erkennung steckt in tor.ts und hat dort einen eigenen Test
 * (tor.test.ts) — dieser Test hier orchestriert nur: Dateien einsammeln, pruefen,
 * Ergebnis sammeln.
 */
describe('Das Tor', () => {
	it('laesst keine Route direkt an die Tabellen', () => {
		const dateien = readdirSync('src/routes', { recursive: true, encoding: 'utf8' })
			.filter((d) => d.endsWith('.ts') && !d.includes('.test.'))
			.map((d) => join('src/routes', d));
		const suender: string[] = [];
		for (const d of dateien) {
			const treffer = verbotenImporte(readFileSync(d, 'utf8'));
			if (treffer.length) suender.push(`${d}: ${treffer.join(', ')}`);
		}
		expect(suender).toEqual([]);
	});
});
