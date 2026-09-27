/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1, in einer
 * zurueckgerollten Transaktion.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { households, users, householdMembers, matrixLinks } from '../db/schema';
import { direktchatFuer, direktchatMerken, direktchatVergessen } from './links';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('Direktchat merken (live)', () => {
	it('merkt den Raum nur fuer gekoppelte Konten und liefert ihn je Nutzer', async () => {
		await expect(
			db.transaction(async (tx) => {
				const t = tx as unknown as typeof db;
				const [h] = await tx.insert(households).values({ name: 'Direktchattest', slug: randomUUID() }).returning({ id: households.id });
				const [u] = await tx
					.insert(users)
					.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
					.returning({ id: users.id });
				await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle: 'verwalter' });
				const matrixId = `@test-${randomUUID()}:example.org`;

				expect(await direktchatFuer(u.id, t)).toBeNull();
				await tx.insert(matrixLinks).values({ userId: u.id, matrixUserId: matrixId });
				expect(await direktchatFuer(u.id, t)).toEqual({ matrixUserId: matrixId, raum: null });

				await direktchatMerken(matrixId, '!raum:example.org', t);
				expect(await direktchatFuer(u.id, t)).toEqual({ matrixUserId: matrixId, raum: '!raum:example.org' });
				// Ein nicht gekoppelter Absender aendert nichts und wirft nicht.
				await direktchatMerken('@fremd:example.org', '!anderer:example.org', t);
				expect((await direktchatFuer(u.id, t))?.raum).toBe('!raum:example.org');

				// Vergessen nur fuer GENAU diesen Raum — ein inzwischen neuerer bleibt stehen.
				await direktchatVergessen(matrixId, '!alt:example.org', t);
				expect((await direktchatFuer(u.id, t))?.raum).toBe('!raum:example.org');
				await direktchatVergessen(matrixId, '!raum:example.org', t);
				expect((await direktchatFuer(u.id, t))?.raum).toBeNull();

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
