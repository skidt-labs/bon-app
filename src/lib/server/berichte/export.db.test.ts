/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/berichte/export.db.test.ts
 *
 * Bewertung 25.09.2026: exportZeilenLaden verglich mit `<=` gegen das Monatsende, das
 * monatsgrenzen() AUSSCHLIESSLICH meint. Ein Bon um genau 00:00 Uhr Berliner Zeit am
 * Ersten stand damit in zwei Monatsexporten.
 *
 * Alles laeuft in EINER Transaktion, die am Ende zurueckgerollt wird.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { households, users, householdMembers, receipts, receiptItems } from '$lib/server/db/schema';
import { monatsgrenzen } from '$lib/server/zeit';
import { exportZeilenLaden } from './abfragen';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('CSV-Export an der Monatsgrenze (live)', () => {
	it('fuehrt einen Bon um Mitternacht am Ersten nur im neuen Monat', async () => {
		await expect(
			db.transaction(async (tx) => {
				const [h] = await tx
					.insert(households)
					.values({ name: 'Grenztest', slug: randomUUID() })
					.returning({ id: households.id });
				const [u] = await tx
					.insert(users)
					.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
					.returning({ id: users.id });
				await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle: 'verwalter' });

				const september = monatsgrenzen('2026-09')!;
				const oktober = monatsgrenzen('2026-10')!;
				// Genau der Zeitpunkt, an dem September endet und Oktober beginnt.
				expect(september.bis.getTime()).toBe(oktober.von.getTime());

				const [bon] = await tx
					.insert(receipts)
					.values({
						householdId: h.id,
						uploadedBy: u.id,
						imagePath: 'test/erfunden.webp',
						thumbPath: 'test/erfunden-klein.webp',
						sichtbarkeit: 'geteilt',
						status: 'confirmed',
						purchasedAt: september.bis,
						totalGrossCents: 100
					})
					.returning({ id: receipts.id });
				await tx.insert(receiptItems).values({ receiptId: bon.id, lineNo: 1, rawText: 'Grenzfall', totalPriceCents: 100 });

				const k = { haushaltId: h.id, nutzerId: u.id, rolle: 'verwalter' as const };
				const tdb = tx as unknown as typeof db;
				expect((await exportZeilenLaden(tdb, k, september)).map((z) => z.bonId)).not.toContain(bon.id);
				expect((await exportZeilenLaden(tdb, k, oktober)).map((z) => z.bonId)).toContain(bon.id);

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
