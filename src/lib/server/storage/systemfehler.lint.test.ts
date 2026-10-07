import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sammelfassung N2: „Systemfehler oder unbrauchbares Bild?" entscheidet EINE Funktion
 * (istSystemfehler in storage/images.ts). Bis 0.10.0 gab es zwei mit entgegengesetzter
 * Haltung zu unbekannten Codes — Hochladen und Matrix antworteten auf denselben Fehler
 * verschieden.
 */
const dateienIn = (ordner: string) =>
	readdirSync(ordner, { recursive: true, encoding: 'utf8' })
		.filter((d) => d.endsWith('.ts') && !d.includes('.test.'))
		.map((d) => join(ordner, d));

describe('Systemfehler-Pruefung', () => {
	it('gibt es genau einmal', () => {
		const definitionen = dateienIn('src')
			.filter((d) => /function\s+istSystem[Ff]ehler\b/.test(readFileSync(d, 'utf8')))
			.sort();
		expect(definitionen).toEqual(['src/lib/server/storage/images.ts']);
	});
});
