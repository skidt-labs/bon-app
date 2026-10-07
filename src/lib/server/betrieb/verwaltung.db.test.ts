import { describe, it, expect } from 'vitest';
import { receipts } from '$lib/server/db/schema';
import { zurueckgerollt, testHaushalt } from '$lib/server/db/testdaten';
import { haushalteUebersicht } from './verwaltung';

/**
 * Nur gegen die Test-Datenbank, in einer zurueckgerollten Transaktion:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/betrieb/verwaltung.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

describe.skipIf(AUS)('haushalteUebersicht (zurueckgerollt)', () => {
	// 2.4 Vorschlag: die Gesamtzahl bleibt (sie sperrt das Loeschen), der Papierkorb steht daneben.
	it('nennt neben der Gesamtzahl die Bons im Papierkorb', async () => {
		await zurueckgerollt(async (tx) => {
			const { haushaltId, nutzerId } = await testHaushalt(tx);
			for (const status of ['confirmed', 'verworfen', 'verworfen'] as const) {
				await tx.insert(receipts).values({
					householdId: haushaltId,
					uploadedBy: nutzerId,
					imagePath: 'test/betrieb-nicht-da.webp',
					thumbPath: 'test/betrieb-nicht-da.thumb.webp',
					status,
					verworfenAm: status === 'verworfen' ? new Date() : null
				});
			}
			const zeile = (await haushalteUebersicht(tx as never)).find((h) => h.id === haushaltId);
			expect(zeile).toMatchObject({ mitglieder: 1, bons: 3, imPapierkorb: 2 });
		});
	});
});
