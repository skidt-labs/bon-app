import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './index';
import { households, householdMembers, users } from './schema';
import { psql, testHaushalt, zurueckgerollt } from './testdaten';

/**
 * Die Testdaten-Hilfen selbst, gegen die Test-Datenbank — hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/db/testdaten.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('Testdaten-Hilfen gegen bon_test', () => {
	it('legt Haushalt, Nutzer und Mitgliedschaft an und nimmt alles zurueck', async () => {
		const angelegt: { haushaltId: string; nutzerId: string }[] = [];
		await zurueckgerollt(async (tx) => {
			const verwalter = await testHaushalt(tx);
			const mitglied = await testHaushalt(tx, { rolle: 'mitglied' });
			angelegt.push(verwalter, mitglied);
			expect(verwalter.haushaltId).not.toBe(mitglied.haushaltId);
			expect(verwalter.k).toEqual({ haushaltId: verwalter.haushaltId, nutzerId: verwalter.nutzerId, rolle: 'verwalter' });
			const [m] = await tx.select().from(householdMembers).where(eq(householdMembers.userId, mitglied.nutzerId));
			expect(m).toMatchObject({ householdId: mitglied.haushaltId, rolle: 'mitglied' });
		});
		expect(angelegt).toHaveLength(2);
		for (const a of angelegt) {
			expect(await db.select().from(households).where(eq(households.id, a.haushaltId))).toHaveLength(0);
			expect(await db.select().from(users).where(eq(users.id, a.nutzerId))).toHaveLength(0);
		}
	});

	it('reicht einen echten Fehler unveraendert durch', async () => {
		const echt = new Error('echter Fehler');
		await expect(
			zurueckgerollt(async () => {
				throw echt;
			})
		).rejects.toBe(echt);
	});

	it('psql fragt die Datenbank aus DATABASE_URL', () => {
		expect(psql('select current_database()')).toMatch(/_test$/);
	});
});
