import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, householdMembers } from '$lib/server/db/schema';
import { bildErsetzen, originalWiederherstellen, type BildDeps } from './bild';

/**
 * Gegen die LAUFENDE Datenbank, hinter RUN_DB_TESTS=1, zurueckgerollt. Speichern und Loeschen
 * sind Attrappen: der Test fasst keine echte Bilddatei an.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('Bild bearbeiten gegen die echte Datenbank', () => {
	it('merkt sich das erste Original ueber zwei Bearbeitungen und holt es zurueck', async () => {
		const [m] = await db
			.select({ userId: householdMembers.userId, householdId: householdMembers.householdId })
			.from(householdMembers)
			.limit(1);
		if (!m) return;
		const k = { haushaltId: m.householdId, nutzerId: m.userId, rolle: 'mitglied' as const };
		let n = 0;
		const geloescht: string[] = [];
		const eingereiht: string[] = [];
		const deps: BildDeps = {
			speichern: async () => {
				n++;
				return { imagePath: `test/bearb-${n}.webp`, thumbPath: `test/bearb-${n}.thumb.webp`, width: 1 };
			},
			loeschen: async (p) => void geloescht.push(...p),
			einreihen: async (id) => void eingereiht.push(id)
		};
		await expect(
			db.transaction(async (tx) => {
				const [b] = await tx
					.insert(receipts)
					.values({ householdId: k.haushaltId, uploadedBy: k.nutzerId, imagePath: 'test/foto.webp', thumbPath: 'test/foto.thumb.webp', status: 'review' })
					.returning({ id: receipts.id });
				const lies = async () => (await tx.select().from(receipts).where(eq(receipts.id, b.id)))[0];

				expect(await bildErsetzen(tx as never, k, b.id, Buffer.from('x'), deps)).toEqual({ ok: true });
				let r = await lies();
				expect([r.imagePath, r.originalImagePath, r.status]).toEqual(['test/bearb-1.webp', 'test/foto.webp', 'pending']);

				// Wartet der Bon aufs Lesen, laesst er sich nicht bearbeiten.
				expect(await bildErsetzen(tx as never, k, b.id, Buffer.from('x'), deps)).toMatchObject({ ok: false, status: 409 });

				await tx.update(receipts).set({ status: 'review' }).where(eq(receipts.id, b.id));
				expect(await bildErsetzen(tx as never, k, b.id, Buffer.from('x'), deps)).toEqual({ ok: true });
				r = await lies();
				expect([r.imagePath, r.originalImagePath]).toEqual(['test/bearb-2.webp', 'test/foto.webp']);
				expect(geloescht).toEqual(['test/bearb-1.webp', 'test/bearb-1.thumb.webp']);

				await tx.update(receipts).set({ status: 'failed' }).where(eq(receipts.id, b.id));
				expect(await originalWiederherstellen(tx as never, k, b.id, deps)).toEqual({ ok: true });
				r = await lies();
				expect([r.imagePath, r.thumbPath, r.originalImagePath, r.status]).toEqual(['test/foto.webp', 'test/foto.thumb.webp', null, 'pending']);
				expect(eingereiht).toEqual([b.id, b.id, b.id]);
				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	});
});
