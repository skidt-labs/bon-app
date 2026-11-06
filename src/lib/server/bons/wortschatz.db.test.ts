import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { receipts, receiptItems, users, householdMembers, extractionRuns } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import { wortschatzLaden } from './wortschatz';

/**
 * Wortschatz fuers Raten gegen die Test-Datenbank, zurueckgerollt:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/wortschatz.db.test.ts
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

async function bonMit(
	tx: Tx,
	haushaltId: string,
	nutzerId: string,
	werte: Partial<typeof receipts.$inferInsert>,
	texte: string[],
	ocr?: string[]
) {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId: haushaltId,
			uploadedBy: nutzerId,
			imagePath: `test/wort-${randomUUID()}.webp`,
			thumbPath: `test/wort-${randomUUID()}.thumb.webp`,
			status: 'confirmed',
			sichtbarkeit: 'geteilt',
			...werte
		})
		.returning({ id: receipts.id });
	await tx.insert(receiptItems).values(texte.map((rawText, i) => ({ receiptId: b.id, lineNo: i + 1, rawText, totalPriceCents: 100 })));
	if (ocr) {
		await tx.insert(extractionRuns).values({
			receiptId: b.id,
			provider: 'test',
			model: 'test',
			ocrZeilen: ocr.map((text, i) => ({ text, box: [0, i * 30, 100, 20] as [number, number, number, number], confidence: 99 }))
		});
	}
}

describe.skipIf(AUS)('wortschatzLaden', () => {
	it('zaehlt bestaetigte, sichtbare Bons — nicht ungepruefte, nicht fremde private', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const [u] = await tx
				.insert(users)
				.values({ oidcSub: `test-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, displayName: 'Zweite Person' })
				.returning({ id: users.id });
			await tx.insert(householdMembers).values({ householdId: k.haushaltId, userId: u.id, rolle: 'mitglied' });

			await bonMit(tx, k.haushaltId, k.nutzerId, {}, ['EISBERGSALAT', 'Eisbergsalat 1 St']);
			await bonMit(tx, k.haushaltId, k.nutzerId, { status: 'review' }, ['GURKENSALAT']);
			await bonMit(tx, k.haushaltId, u.id, { sichtbarkeit: 'privat' }, ['GEHEIMWORT']);
			await bonMit(tx, k.haushaltId, u.id, {}, ['Butterkeks']);

			const geladen = await wortschatzLaden(tx as never, k);
			const ws = new Map(geladen.woerter);
			expect(ws.get('eisbergsalat')).toBe(2);
			expect(ws.get('butterkeks')).toBe(1);
			expect(ws.has('gurkensalat')).toBe(false);
			expect(ws.has('geheimwort')).toBe(false);
		});
	});

	// Abschlusspruefung 0.13.0, I5: getippt ist, was in der bestaetigten Zeile steht, aber
	// nicht im OCR-Text desselben Bons — dorthin darf gleich eingesetzt werden.
	it('getippt: Woerter, die nicht im OCR-Text ihres Bons stehen; ohne Leselauf alle', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			await bonMit(tx, k.haushaltId, k.nutzerId, {}, ['EISBERGSALAT', 'VOLLMILCH'], ['ETSBERGSALAT 1,49', 'VOLLMILCH 1,09']);
			await bonMit(tx, k.haushaltId, k.nutzerId, {}, ['Gurkensalat']);
			const { getippt } = await wortschatzLaden(tx as never, k);
			expect(new Set(getippt)).toEqual(new Set(['eisbergsalat', 'gurkensalat']));
		});
	});
});

