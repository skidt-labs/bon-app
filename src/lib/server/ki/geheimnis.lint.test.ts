import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Entschluesseln darf genau an zwei Stellen passieren: im Worker-Aufloeser und in der
 * Betriebsseite (Testen, „Schluessel lesbar?"). Jeder weitere Importeur ist ein neuer Weg,
 * auf dem ein Klartext-Schluessel irgendwo landen kann, wo niemand ihn erwartet.
 */
const ERLAUBT = new Set([
	'src/lib/server/ki/aktiv.ts',
	'src/lib/server/betrieb/ki.ts',
	'src/lib/server/betrieb/ki-probe.ts'
]);

describe('Wer ki/geheimnis importieren darf', () => {
	it('nur der Aufloeser und die Betriebsseite', () => {
		const dateien = readdirSync('src', { recursive: true, encoding: 'utf8' })
			.filter((d) => /\.(ts|svelte)$/.test(d) && !d.includes('.test.'))
			.map((d) => join('src', d));
		const importeure = dateien.filter((d) =>
			/from\s+['"](\$lib\/server\/ki\/geheimnis|\.\/geheimnis|\.\.\/ki\/geheimnis)['"]/.test(
				readFileSync(d, 'utf8')
			)
		);
		expect(importeure.filter((d) => !ERLAUBT.has(d))).toEqual([]);
	});
});
