/**
 * Beweist die Idempotenz des Kategoriebaum-Seeds (drizzle/0011_kategoriebaum.sql) samt Umbau
 * 0.12.0 (drizzle/0035_kategorien_umbau.sql) gegen die Test-Datenbank — hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/kategorien/kategoriebaum-seed.db.test.ts
 *
 * Die Probe spielt beide Migrationen in EINER Transaktion zweimal ein — das IST der Beweis,
 * dass ein weiterer Lauf nichts verdoppelt — und rollt zurueck. Dass das ROLLBACK greift,
 * zeigt eine Merkzeile aus derselben Transaktion, die danach fehlen muss, und der Baum
 * steht danach wie vorher (bon_test hat 0035 erst, wenn es eingespielt ist).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psql } from '$lib/server/db/testdaten';
import { KATEGORIEBAUM } from './baum';

const RUN = process.env.RUN_DB_TESTS === '1';
const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle');
const SEED_PATH = path.join(DRIZZLE, '0011_kategoriebaum.sql');
const UMBAU_PATH = path.join(DRIZZLE, '0035_kategorien_umbau.sql');
const STAND = "select count(*)||':'||string_agg(slug, ',' order by slug) from categories";
const ERWARTET_OBER = KATEGORIEBAUM.length;
const ERWARTET_UNTER = KATEGORIEBAUM.reduce((n, o) => n + o.kinder.length, 0);
const ERWARTET_GESAMT = ERWARTET_OBER + ERWARTET_UNTER;

describe.skipIf(!RUN)('Kategoriebaum-Seed (bon_test, ROLLBACK)', () => {
	let vorher = '';

	it('bleibt bei zwei weiteren Laeufen zahlengleich', () => {
		vorher = psql(STAND);
		const migration = readFileSync(SEED_PATH, 'utf8') + '\n' + readFileSync(UMBAU_PATH, 'utf8');
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

	it('hinterlässt keine Spur — die Merkzeile ist weg, der Baum steht wie vorher', () => {
		expect(psql("select count(*) from categories where slug = 'kategoriebaum-probe'")).toBe('0');
		expect(vorher).not.toBe('');
		expect(psql(STAND)).toBe(vorher);
	});
});
