import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { betriebsprotokoll } from '$lib/server/db/schema';
import { protokolliere } from './protokoll';

/**
 * Gegen die LAUFENDE Datenbank, in einer Transaktion, die am Ende zurueckgerollt wird:
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/betrieb/protokoll.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('Betriebsprotokoll gegen die echte Datenbank', () => {
	it('schreibt einen Eintrag mit Zeit, Aktion, Ziel und Details', async () => {
		await expect(
			db.transaction(async (tx) => {
				await protokolliere(tx, {
					userId: null,
					aktion: 'selbstbedienung',
					ziel: 'protokoll-db-test',
					details: { an: false }
				});
				const [zeile] = await tx
					.select()
					.from(betriebsprotokoll)
					.where(eq(betriebsprotokoll.ziel, 'protokoll-db-test'));
				expect(zeile).toMatchObject({ aktion: 'selbstbedienung', details: { an: false } });
				expect(zeile.zeit).toBeInstanceOf(Date);
				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	});
});
