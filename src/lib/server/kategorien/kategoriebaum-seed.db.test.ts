/**
 * Beweist die Idempotenz des Kategoriebaum-Seeds (drizzle/0011_kategoriebaum.sql)
 * GEGEN DIE ECHTE DATENBANK — deshalb hinter RUN_DB_TESTS=1, wie
 * fk-integrity.db.test.ts und household.db.test.ts.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/kategorien/kategoriebaum-seed.db.test.ts
 *
 * WICHTIG: Diese Migration ist bewusst noch NICHT per `npm run db:migrate` angewendet.
 * In bon-db liegen echte Bons des Betreibers, und ob der Kategorie-Startbestand
 * dauerhaft eingespielt wird, entscheidet er, nicht dieser Test (siehe Bericht). Die
 * gesamte Probe läuft deshalb in EINER Transaktion mit ROLLBACK: das Migrations-SQL
 * wird darin zweimal hintereinander ausgeführt — das IST der Beweis, dass ein
 * zweiter Lauf nichts verdoppelt —, und ROLLBACK macht danach jede Spur rückgängig.
 * Ein Seed, der beim zweiten Einspielen verdoppelt, ist eine Zeitbombe.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KATEGORIEBAUM } from './baum';

const RUN = process.env.RUN_DB_TESTS === '1';

const MIGRATION_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../drizzle/0011_kategoriebaum.sql'
);

function psql(sql: string): string {
	return execFileSync('docker', ['exec', 'bon-db', 'psql', '-q', '-U', 'bon', '-d', 'bon', '-tAc', sql], {
		encoding: 'utf8'
	}).trim();
}

// Gegen KATEGORIEBAUM gerechnet, nicht fest eingetippt — dieselbe Zaehlprobe wie im
// Auftrag beschrieben ("13/35 faengt ein Vertippen"), hier aus der EINEN Quelle
// abgeleitet, damit sie mit dem Baum mitwaechst statt zu veralten.
const ERWARTET_OBER = KATEGORIEBAUM.length;
const ERWARTET_UNTER = KATEGORIEBAUM.reduce((n, o) => n + o.kinder.length, 0);
const ERWARTET_GESAMT = ERWARTET_OBER + ERWARTET_UNTER;

describe.skipIf(!RUN)('Kategoriebaum-Seed (live, ROLLBACK)', () => {
	it('legt den Baum an und bleibt beim zweiten Lauf zahlengleich', () => {
		const migration = readFileSync(MIGRATION_PATH, 'utf8');
		const out = psql(`
			begin;
			${migration}
			${migration}
			select 'ober='||count(*) filter (where parent_id is null)
				||' unter='||count(*) filter (where parent_id is not null)
				||' slugs='||count(distinct slug)||'/'||count(*)
				from categories;
			rollback;
		`);
		expect(out).toBe(
			`ober=${ERWARTET_OBER} unter=${ERWARTET_UNTER} slugs=${ERWARTET_GESAMT}/${ERWARTET_GESAMT}`
		);
	});

	// ROLLBACK sollte das ohnehin garantieren — trotzdem nachgemessen, aus demselben
	// Grund wie in fk-integrity.db.test.ts: ein Waechter, der sein eigenes Aufraeumen
	// nur vermutet statt es zu pruefen, kann irgendwann leise falsch werden.
	it('hinterlässt keine Spur — kein dauerhaftes Einspielen ohne Freigabe', () => {
		expect(psql('select count(*) from categories')).toBe('0');
	});
});
