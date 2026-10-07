import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Regeln fuer DB-Tests (Sammelfassung 0.11.0, Bereich 0) als Quelltextpruefung — wie
 * tor.lint.test.ts: eine Zusicherung, die man beim naechsten neuen DB-Test vergisst, ist kein
 * Schutz. Laeuft in der normalen Suite, ohne Datenbank.
 */
const DATEIEN = readdirSync('src', { recursive: true, encoding: 'utf8' })
	.filter((d) => d.endsWith('.db.test.ts'))
	.map((d) => join('src', d))
	.sort();
const text = (d: string) => readFileSync(d, 'utf8');
const mit = (muster: RegExp) => DATEIEN.filter((d) => muster.test(text(d)));

describe('DB-Tests', () => {
	it('werden gefunden (sonst prueft hier nichts)', () => {
		expect(DATEIEN.length).toBeGreaterThanOrEqual(24);
	});

	it('kehren nie still zurueck, wenn Daten fehlen', () => {
		// Erlaubt bleibt nur `if (!RUN) return;` im afterAll der committenden Dateien.
		expect(mit(/if\s*\(\s*!(?!RUN\s*\))[^)]*\)\s*return\b/)).toEqual([]);
	});

	it('nehmen kein „erstes Mitglied" aus dem Bestand', () => {
		expect(mit(/\.from\((householdMembers|households|users|receipts)\)\s*\.limit\(1\)/)).toEqual([]);
	});

	it('nennen in der Aufrufzeile die Test-Datenbank und sich selbst', () => {
		expect(DATEIEN.filter((d) => !text(d).includes('127.0.0.1:55432/bon_test" RUN_DB_TESTS=1'))).toEqual([]);
		expect(DATEIEN.filter((d) => !text(d).includes(`npx vitest run ${d}`))).toEqual([]);
		// Und kein Kopf behauptet mehr, gegen die laufende Datenbank zu gehen.
		expect(mit(/LAUFENDE Datenbank/)).toEqual([]);
	});

	it('gehen nie fest auf die Produktionsdatenbank', () => {
		expect(mit(/55432\/bon"|'-d',\s*'bon'/)).toEqual([]);
	});

	it('rufen psql nur ueber testdaten.psql (der prueft die Datenbank selbst)', () => {
		expect(mit(/execFileSync\(\s*'docker'/)).toEqual([]);
	});
});
