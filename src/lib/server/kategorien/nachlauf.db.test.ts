import { describe, it, expect } from 'vitest';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { zurueckgerollt, testHaushalt, type Tx } from '$lib/server/db/testdaten';
import type { ReceiptStatus } from '$lib/server/bons/liste';
import { offeneBons, ohneKategorie } from './nachlauf';

/**
 * Nur gegen die Test-Datenbank, in einer zurueckgerollten Transaktion:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/kategorien/nachlauf.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

async function bonOhneKategorie(tx: Tx, householdId: string, uploadedBy: string, status: ReceiptStatus): Promise<string> {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId,
			uploadedBy,
			imagePath: 'test/nachlauf-nicht-da.webp',
			thumbPath: 'test/nachlauf-nicht-da.thumb.webp',
			status,
			verworfenAm: status === 'verworfen' ? new Date() : null
		})
		.returning({ id: receipts.id });
	await tx.insert(receiptItems).values({ receiptId: b.id, lineNo: 1, rawText: 'POSTEN', totalPriceCents: 100, categoryId: null });
	return b.id;
}

describe.skipIf(AUS)('Kategorie-Nachlauf: Auswahl (zurueckgerollt)', () => {
	// 2.4: der Nachlauf fragte das Modell auch fuer Bons im Papierkorb.
	it('waehlt keine Bons aus dem Papierkorb und zaehlt ihre Positionen nicht', async () => {
		await zurueckgerollt(async (tx) => {
			const d = tx as never;
			const { k } = await testHaushalt(tx);
			const vorher = await ohneKategorie(d);
			const offen = await bonOhneKategorie(tx, k.haushaltId, k.nutzerId, 'review');
			const imKorb = await bonOhneKategorie(tx, k.haushaltId, k.nutzerId, 'verworfen');
			const ids = await offeneBons(k.haushaltId, d);
			expect(ids).toContain(offen);
			expect(ids).not.toContain(imKorb);
			expect(await ohneKategorie(d)).toBe(vorher + 1);
		});
	});
});
