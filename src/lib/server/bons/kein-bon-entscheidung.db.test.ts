import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, householdMembers } from '$lib/server/db/schema';
import { dochEinBon } from './kein-bon-entscheidung';

/** Gegen die LAUFENDE Datenbank, hinter RUN_DB_TESTS=1, in einer zurueckgerollten Transaktion. */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('Doch ein Bon gegen die echte Datenbank', () => {
	it('nimmt nur die Kein-Bon-Codes heraus und laesst ohne Rest null stehen', async () => {
		const [m] = await db
			.select({ userId: householdMembers.userId, householdId: householdMembers.householdId })
			.from(householdMembers)
			.limit(1);
		if (!m) return;
		const k = { haushaltId: m.householdId, nutzerId: m.userId, rolle: 'mitglied' as const };
		await expect(
			db.transaction(async (tx) => {
				const neu = async (gruende: string[]) => {
					const [b] = await tx
						.insert(receipts)
						.values({
							householdId: k.haushaltId,
							uploadedBy: k.nutzerId,
							imagePath: 'test/kein-bon-nicht-da.webp',
							thumbPath: 'test/kein-bon-nicht-da.thumb.webp',
							status: 'review',
							needsReviewReason: gruende
						})
						.returning({ id: receipts.id });
					return b.id;
				};
				const mitRest = await neu(['sum_mismatch', 'kein_bon_kartenbeleg']);
				const nurHinweis = await neu(['kein_bon_kartenbeleg']);
				expect(await dochEinBon(tx as never, k, mitRest)).toEqual({ ok: true });
				expect(await dochEinBon(tx as never, k, nurHinweis)).toEqual({ ok: true });
				const [a] = await tx.select().from(receipts).where(eq(receipts.id, mitRest));
				const [b] = await tx.select().from(receipts).where(eq(receipts.id, nurHinweis));
				expect(a.needsReviewReason).toEqual(['sum_mismatch']);
				expect(b.needsReviewReason).toBeNull();
				// Zweiter Klick: kein Hinweis mehr → 409.
				expect(await dochEinBon(tx as never, k, nurHinweis)).toMatchObject({ ok: false, status: 409 });

				// Fehlgeschlagen: neu eingereiht, und der Hinweis steht nicht mehr am wartenden Bon.
				const [f] = await tx
					.insert(receipts)
					.values({
						householdId: k.haushaltId,
						uploadedBy: k.nutzerId,
						imagePath: 'test/kein-bon-nicht-da.webp',
						thumbPath: 'test/kein-bon-nicht-da.thumb.webp',
						status: 'failed',
						needsReviewReason: ['kein_bon_ohne_preise']
					})
					.returning({ id: receipts.id });
				const eingereiht: string[] = [];
				expect(await dochEinBon(tx as never, k, f.id, async (id) => void eingereiht.push(id))).toEqual({ ok: true });
				const [wartend] = await tx.select().from(receipts).where(eq(receipts.id, f.id));
				expect(wartend.status).toBe('pending');
				expect(wartend.needsReviewReason).toBeNull();
				expect(eingereiht).toEqual([f.id]);
				// Und ein zweiter Klick, solange er wartet: 409, kein zweiter Auftrag.
				expect(await dochEinBon(tx as never, k, f.id, async (id) => void eingereiht.push(id))).toMatchObject({ ok: false, status: 409 });
				expect(eingereiht).toHaveLength(1);
				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	});
});
