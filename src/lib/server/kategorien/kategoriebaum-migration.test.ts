import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KATEGORIEBAUM } from './baum';

/**
 * Schneller Wächter OHNE Datenbank — läuft deshalb immer mit, nicht nur hinter
 * RUN_DB_TESTS=1. Prüft die FORM des erzeugten SQL (drizzle/0011_kategoriebaum.sql),
 * nicht sein Ergebnis gegen eine echte Datenbank — das übernimmt
 * kategoriebaum-seed.db.test.ts.
 *
 * Der Grund für DO UPDATE statt DO NOTHING: dasselbe Upsert-Muster wie
 * ensureDefaultHousehold() (household.ts) und haendlerAufloesen() (merchants.ts) —
 * kein "nachsehen, dann einfügen". Siehe household-upsert.test.ts, dessen Muster
 * dieser Test übernimmt.
 */
const MIGRATION_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../drizzle/0011_kategoriebaum.sql'
);
// Kommentarzeilen raus, BEVOR auf Textschnipsel geprueft wird — der Kopfkommentar
// erklaert in Prosa, warum NICHT "do nothing" verwendet wird, und enthaelt das Wort
// deshalb selbst. Ohne diesen Schritt prueft der Test sein eigenes Gegenargument.
const sql = readFileSync(MIGRATION_PATH, 'utf8')
	.split('\n')
	.filter((zeile) => !zeile.trim().startsWith('--'))
	.join('\n')
	.toLowerCase();

describe('Kategoriebaum-Migration (SQL-Form)', () => {
	it('nutzt ON CONFLICT ... DO UPDATE, nicht DO NOTHING', () => {
		expect(sql).toContain('on conflict');
		expect(sql).toContain('do update');
		expect(sql).not.toContain('do nothing');
	});

	it('kollidiert auf dem slug, nicht auf der id', () => {
		expect(sql).toMatch(/on conflict \("?slug"?\)/);
	});

	// Ein INSERT pro Baum-Eintrag (Ober- und Unterkategorien) — dieselbe Zaehlprobe
	// wie im Auftrag beschrieben, hier gegen KATEGORIEBAUM statt gegen eine fest
	// eingetippte Zahl, damit sie mit dem Baum mitwaechst statt zu veralten.
	it('legt fuer jeden Eintrag aus KATEGORIEBAUM genau einen INSERT an', () => {
		const inserts = sql.match(/insert into "categories"/g) ?? [];
		const erwartet = KATEGORIEBAUM.length + KATEGORIEBAUM.reduce((n, o) => n + o.kinder.length, 0);
		expect(inserts).toHaveLength(erwartet);
	});
});
