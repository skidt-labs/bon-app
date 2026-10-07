import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from './index';
import { households, householdMembers, users } from './schema';
import { datenbankName, istTestDatenbank } from './testwaechter';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Hilfen fuer DB-Tests gegen bon_test (Sammelfassung 0.11.0, Bereich 0). Nur von *.db.test.ts
 * importiert, nie von Anwendungscode.
 *
 * - zurueckgerollt: der Test laeuft in EINER Transaktion, die am Ende immer zurueckrollt.
 * - testHaushalt: Haushalt, Nutzer und Mitgliedschaft frisch in der Transaktion — statt „das
 *   erste Haushaltsmitglied aus der Datenbank" und stillem Zurueckkehren, wenn es keins gibt.
 * - psql: fuer Proben mit rohem SQL. `docker exec` ginge am Waechter in vitest.setup.ts vorbei,
 *   deshalb prueft psql die Datenbank noch einmal selbst.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLLBACK = new Error('zurueckgerollt');

export async function zurueckgerollt(f: (tx: Tx) => Promise<void>): Promise<void> {
	try {
		await db.transaction(async (tx) => {
			await f(tx);
			throw ROLLBACK;
		});
	} catch (err) {
		if (err !== ROLLBACK) throw err;
	}
}

export async function testHaushalt(
	tx: Tx,
	opts: { rolle?: 'verwalter' | 'mitglied' } = {}
): Promise<{ haushaltId: string; nutzerId: string; k: Zugriffskontext }> {
	const rolle = opts.rolle ?? 'verwalter';
	const [h] = await tx
		.insert(households)
		.values({ name: 'Testhaushalt', slug: `test-${randomUUID()}` })
		.returning({ id: households.id });
	const [u] = await tx
		.insert(users)
		.values({ oidcSub: `test-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
		.returning({ id: users.id });
	await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle });
	return { haushaltId: h.id, nutzerId: u.id, k: { haushaltId: h.id, nutzerId: u.id, rolle } };
}

export function psql(sqlText: string): string {
	const url = process.env.DATABASE_URL ?? '';
	const name = datenbankName(url);
	if (name === null || !istTestDatenbank(url)) {
		throw new Error('psql nur gegen eine Test-Datenbank (Name endet auf _test) — DATABASE_URL pruefen.');
	}
	return execFileSync('docker', ['exec', 'bon-db', 'psql', '-q', '-U', 'bon', '-d', name, '-tAc', sqlText], {
		encoding: 'utf8'
	}).trim();
}
