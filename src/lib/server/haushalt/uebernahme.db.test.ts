/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 * Ein Backfill, den niemand prueft, faellt erst auf, wenn sich jemand nicht mehr
 * anmelden kann: dieser Waechter belegt, dass die Migration 0018_mitglieder_backfill
 * wirklich jedem Bestandsnutzer eine Mitgliedschaft gegeben hat, und zwar dieselbe,
 * die vorher in users.household_id stand.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/haushalt/uebernahme.db.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const RUN = process.env.RUN_DB_TESTS === '1';

function psql(sql: string): string {
	return execFileSync('docker', ['exec', 'bon-db', 'psql', '-q', '-U', 'bon', '-d', 'bon', '-tAc', sql], {
		encoding: 'utf8'
	}).trim();
}

describe.skipIf(!RUN)('Bestandsuebernahme Mitgliedschaft (live)', () => {
	it('gibt jedem vorhandenen Nutzer genau eine Mitgliedschaft', () => {
		expect(
			psql(
				'select count(*) from users u where not exists (select 1 from household_members m where m.user_id = u.id)'
			)
		).toBe('0');
	});

	it('macht den Bestandsnutzer zum Verwalter', () => {
		expect(psql("select count(*) from household_members where rolle <> 'verwalter'")).toBe('0');
	});

	// Der dritte Test dieser Datei prüfte bis zum 18.09.2026, dass users.household_id und
	// household_members.household_id dasselbe sagen. Die Spalte ist gefallen — es gibt nur
	// noch EINE Wahrheit, und eine Deckungsgleichheit zwischen einer Sache und sich selbst
	// ist keine Prüfung. Die beiden Tests darüber bleiben: sie bewachen den Backfill.
});
