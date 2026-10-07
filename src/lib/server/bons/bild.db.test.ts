import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import { bildErsetzen, originalWiederherstellen, type BildDeps } from './bild';

/**
 * Gegen die Test-Datenbank, hinter RUN_DB_TESTS=1, zurueckgerollt. Speichern und Loeschen
 * sind Attrappen: der Test fasst keine echte Bilddatei an.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/bild.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('Bild bearbeiten gegen die Test-Datenbank', () => {
	it('merkt sich das erste Original ueber zwei Bearbeitungen und holt es zurueck', async () => {
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
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
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
		});
	});
});

/** Wie `tx`, nur scheitert in jeder inneren Transaktion das Loesen der Zeilenrahmen (4.1). */
function mitKaputtenZeilenrahmen(tx: Tx): never {
	const gebunden = (ziel: object, p: string | symbol) => {
		const v = Reflect.get(ziel, p, ziel);
		return typeof v === 'function' ? v.bind(ziel) : v;
	};
	const innen = (t: Tx) =>
		new Proxy(t, {
			get: (ziel, p) =>
				p === 'update'
					? (tabelle: typeof receipts | typeof receiptItems) =>
							tabelle === receiptItems
								? { set: () => ({ where: () => Promise.reject(new Error('Zeilenrahmen kaputt')) }) }
								: ziel.update(tabelle)
					: gebunden(ziel, p)
		});
	return new Proxy(tx, {
		get: (ziel, p) =>
			p === 'transaction'
				? (f: (t: Tx) => Promise<unknown>) => ziel.transaction((t) => f(innen(t)))
				: gebunden(ziel, p)
	}) as never;
}

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('Bild bearbeiten: veralteter Stand und eine Transaktion (Sammelfassung 4.1)', () => {
	const testBon = async (tx: Tx, k: { haushaltId: string; nutzerId: string }) => {
		const [b] = await tx
			.insert(receipts)
			.values({ householdId: k.haushaltId, uploadedBy: k.nutzerId, imagePath: 'test/foto.webp', thumbPath: 'test/foto.thumb.webp', status: 'review' })
			.returning({ id: receipts.id });
		await tx.insert(receiptItems).values({ receiptId: b.id, lineNo: 1, rawText: 'Testware', totalPriceCents: 199, ocrZeile: 3 });
		return b.id;
	};

	it('verwirft eine Bearbeitung, wenn ein anderer Tab das Bild inzwischen ersetzt hat', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const id = await testBon(tx, k);
			const geloescht: string[] = [];
			const deps: BildDeps = {
				// Waehrend dieses Speicherns bearbeitet ein anderer Tab, und der Bon ist schon
				// wieder gelesen: derselbe Status 'review', aber ein anderes Bild.
				speichern: async () => {
					await tx
						.update(receipts)
						.set({ imagePath: 'test/anderer-tab.webp', thumbPath: 'test/anderer-tab.thumb.webp', originalImagePath: 'test/foto.webp', originalThumbPath: 'test/foto.thumb.webp' })
						.where(eq(receipts.id, id));
					return { imagePath: 'test/veraltet.webp', thumbPath: 'test/veraltet.thumb.webp', width: 1 };
				},
				loeschen: async (p) => void geloescht.push(...p),
				einreihen: async () => {}
			};
			expect(await bildErsetzen(tx as never, k, id, Buffer.from('x'), deps)).toMatchObject({ ok: false, status: 409 });
			const [r] = await tx.select().from(receipts).where(eq(receipts.id, id));
			expect([r.imagePath, r.originalImagePath, r.status]).toEqual(['test/anderer-tab.webp', 'test/foto.webp', 'review']);
			expect(geloescht).toEqual(['test/veraltet.webp', 'test/veraltet.thumb.webp']);
		});
	});

	it('laesst den Bon unveraendert, wenn das Loesen der Zeilenrahmen scheitert', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const id = await testBon(tx, k);
			const geloescht: string[] = [];
			const eingereiht: string[] = [];
			const deps: BildDeps = {
				speichern: async () => ({ imagePath: 'test/neu.webp', thumbPath: 'test/neu.thumb.webp', width: 1 }),
				loeschen: async (p) => void geloescht.push(...p),
				einreihen: async (b) => void eingereiht.push(b)
			};
			await expect(bildErsetzen(mitKaputtenZeilenrahmen(tx), k, id, Buffer.from('x'), deps)).rejects.toThrow('Zeilenrahmen kaputt');
			const [r] = await tx.select().from(receipts).where(eq(receipts.id, id));
			expect([r.imagePath, r.originalImagePath, r.status]).toEqual(['test/foto.webp', null, 'review']);
			const [pos] = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, id));
			expect(pos.ocrZeile).toBe(3);
			expect(geloescht).toEqual(['test/neu.webp', 'test/neu.thumb.webp']);
			expect(eingereiht).toEqual([]);
		});
	});
});
