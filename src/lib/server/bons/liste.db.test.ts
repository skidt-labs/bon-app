import { describe, it, expect } from 'vitest';
import { categories, receipts, receiptItems } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import { listeLaden, kategorienStandLaden, type ReceiptStatus } from './liste';

/**
 * listeLaden gegen die Test-Datenbank — hinter RUN_DB_TESTS=1, zurueckgerollt:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/liste.db.test.ts
 *
 * Prueft, dass die Abfrage mit dem echten Schema laeuft (Unterabfrage fuer die Positionen,
 * coalesce fuer die Zeit) und dass Liste und Zaehler dieselben Bons meinen. Bis 0.10.0 las der
 * Test den ersten Bon der Produktion und kehrte ohne ihn still zurueck.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('listeLaden gegen die Test-Datenbank', () => {
	it('liefert die Bons des Haushalts ohne Papierkorb, mit Positionen und passenden Zaehlern', async () => {
		await zurueckgerollt(async (tx) => {
			const ich = await testHaushalt(tx, { rolle: 'mitglied' });
			const bon = async (status: ReceiptStatus, positionen: number) => {
				const [b] = await tx
					.insert(receipts)
					.values({
						householdId: ich.haushaltId,
						uploadedBy: ich.nutzerId,
						imagePath: 'test/liste.webp',
						thumbPath: 'test/liste.thumb.webp',
						status,
						verworfenAm: status === 'verworfen' ? new Date() : null
					})
					.returning({ id: receipts.id });
				for (let i = 1; i <= positionen; i++) {
					await tx.insert(receiptItems).values({ receiptId: b.id, lineNo: i, rawText: `Ware ${i}`, totalPriceCents: 100 });
				}
				return b.id;
			};
			const offen = await bon('review', 2);
			const fertig = await bon('confirmed', 1);
			const wartet = await bon('pending', 0);
			const gescheitert = await bon('failed', 0);
			await bon('verworfen', 3);

			const { bons, zaehler } = await listeLaden(tx as never, ich.k, { status: 'alle', monat: null, haendler: null, suche: null });
			expect(Object.fromEntries(bons.map((b) => [b.id, b.positionen]))).toEqual({ [offen]: 2, [fertig]: 1, [wartet]: 0, [gescheitert]: 0 });
			expect(zaehler).toEqual({ brauchtDich: 2, wirdGelesen: 1, fehlgeschlagen: 1, bestaetigt: 1, papierkorb: 1 });
		});
	});
});

async function bonMitPosten(tx: Tx, householdId: string, uploadedBy: string, status: ReceiptStatus, kategorien: (string | null)[]) {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId,
			uploadedBy,
			imagePath: 'test/zaehlen-nicht-da.webp',
			thumbPath: 'test/zaehlen-nicht-da.thumb.webp',
			status,
			verworfenAm: status === 'verworfen' ? new Date() : null
		})
		.returning({ id: receipts.id });
	if (kategorien.length > 0) {
		await tx
			.insert(receiptItems)
			.values(kategorien.map((categoryId, i) => ({ receiptId: b.id, lineNo: i + 1, rawText: `POSTEN ${i + 1}`, totalPriceCents: 100, categoryId })));
	}
	return b.id;
}

describe.skipIf(AUS)('kategorienStandLaden (zurueckgerollt)', () => {
	// 2.4: Startseite und Budgets zaehlten Positionen verworfener Bons mit.
	it('zaehlt Positionen im Papierkorb nicht mit, die eines Doppels schon', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const [kat] = await tx.select({ id: categories.id }).from(categories).limit(1);
			expect(kat, 'bon_test braucht die Kategorien aus den Migrationen').toBeDefined();
			await bonMitPosten(tx, k.haushaltId, k.nutzerId, 'review', [kat.id, null]);
			await bonMitPosten(tx, k.haushaltId, k.nutzerId, 'doppelt', [kat.id]);
			await bonMitPosten(tx, k.haushaltId, k.nutzerId, 'verworfen', [kat.id, kat.id, null]);
			expect(await kategorienStandLaden(tx as never, k)).toEqual({ mitKategorie: 2, gesamt: 3 });
		});
	});
});
