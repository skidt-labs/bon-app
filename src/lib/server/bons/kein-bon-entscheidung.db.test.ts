import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { receipts } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt } from '$lib/server/db/testdaten';
import { dochEinBon } from './kein-bon-entscheidung';

/**
 * Gegen die Test-Datenbank, hinter RUN_DB_TESTS=1, zurueckgerollt:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/kein-bon-entscheidung.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('Doch ein Bon gegen die echte Datenbank', () => {
	it('nimmt nur die Kein-Bon-Codes heraus und laesst ohne Rest null stehen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
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
			expect(await dochEinBon(tx as never, k, mitRest)).toEqual({ ok: true, eingereiht: false });
			expect(await dochEinBon(tx as never, k, nurHinweis)).toEqual({ ok: true, eingereiht: false });
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
			expect(await dochEinBon(tx as never, k, f.id, async (id) => void eingereiht.push(id))).toEqual({ ok: true, eingereiht: true });
			const [wartend] = await tx.select().from(receipts).where(eq(receipts.id, f.id));
			expect(wartend.status).toBe('pending');
			expect(wartend.needsReviewReason).toBeNull();
			expect(eingereiht).toEqual([f.id]);
			// Und ein zweiter Klick, solange er wartet: 409, kein zweiter Auftrag.
			expect(await dochEinBon(tx as never, k, f.id, async (id) => void eingereiht.push(id))).toMatchObject({ ok: false, status: 409 });
			expect(eingereiht).toHaveLength(1);
		});
	});
});

describe.skipIf(AUS)('Doch ein Bon: Rueckfall (zurueckgerollt)', () => {
	// 2.11: bonReaktivieren leert die Beanstandungen; beim Rueckfall muessen sie zurueck, sonst
	// fehlt am fehlgeschlagenen Bon der Kein-Bon-Hinweis und mit ihm „Doch ein Bon".
	it('setzt beim Rueckfall auf fehlgeschlagen den Kein-Bon-Hinweis wieder', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
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
			const r = await dochEinBon(tx as never, k, f.id, async () => {
				throw new Error('Warteschlange weg');
			});
			const [z] = await tx.select().from(receipts).where(eq(receipts.id, f.id));
			expect(z.status).toBe('failed');
			expect(z.needsReviewReason).toEqual(['kein_bon_ohne_preise']);
			expect(z.failureReason).toBe('Warteschlange weg');
			expect(r).toEqual({ ok: true, eingereiht: false });
		});
	});
});
