/**
 * Beweist die Idempotenz des Kategoriebaum-Seeds (drizzle/0011_kategoriebaum.sql) gegen die
 * Test-Datenbank — hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/kategorien/kategoriebaum-seed.db.test.ts
 *
 * In bon_test ist der Baum mit den Migrationen schon eingespielt. Die Probe spielt das
 * Migrations-SQL in EINER Transaktion zweimal ein — das IST der Beweis, dass ein weiterer Lauf
 * nichts verdoppelt — und rollt zurueck. Dass das ROLLBACK greift, zeigt eine Merkzeile aus
 * derselben Transaktion, die danach fehlen muss.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psql } from '$lib/server/db/testdaten';
import { KATEGORIEBAUM } from './baum';

const RUN = process.env.RUN_DB_TESTS === '1';
const MIGRATION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle/0011_kategoriebaum.sql');
const ERWARTET_OBER = KATEGORIEBAUM.length;
const ERWARTET_UNTER = KATEGORIEBAUM.reduce((n, o) => n + o.kinder.length, 0);
const ERWARTET_GESAMT = ERWARTET_OBER + ERWARTET_UNTER;

describe.skipIf(!RUN)('Kategoriebaum-Seed (bon_test, ROLLBACK)', () => {
	it('bleibt bei zwei weiteren Laeufen zahlengleich', () => {
		const migration = readFileSync(MIGRATION_PATH, 'utf8');
		const out = psql(`
			begin;
			${migration}
			${migration}
			select 'ober='||count(*) filter (where parent_id is null)
				||' unter='||count(*) filter (where parent_id is not null)
				||' slugs='||count(distinct slug)||'/'||count(*)
				from categories;
			insert into categories (name, slug) values ('Probe', 'kategoriebaum-probe');
			rollback;
		`);
		expect(out).toBe(`ober=${ERWARTET_OBER} unter=${ERWARTET_UNTER} slugs=${ERWARTET_GESAMT}/${ERWARTET_GESAMT}`);
	});

	it('hinterlässt keine Spur — die Merkzeile ist weg, der Baum steht wie aus den Migrationen', () => {
		expect(psql("select count(*) from categories where slug = 'kategoriebaum-probe'")).toBe('0');
		expect(psql('select count(*) from categories')).toBe(String(ERWARTET_GESAMT));
	});
});
