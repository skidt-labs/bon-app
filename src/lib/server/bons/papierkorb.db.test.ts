import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { receipts } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import { DOPPEL_GRUND } from '$lib/bons/beanstandungen';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { inPapierkorbLegen, ausPapierkorbHolen, endgueltigLoeschen, abgelaufeneBons, bonsEndgueltigLoeschen, papierkorbGrenze } from './papierkorb';

/**
 * Gegen die Test-Datenbank, hinter RUN_DB_TESTS=1, zurueckgerollt:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/papierkorb.db.test.ts
 *
 * Die Bons legt der Test selbst an, mit Schein-Bildpfaden: endgueltigLoeschen
 * entfernt Dateien, und ein Rollback holt keine Datei zurueck — echte Bons fasst er nie an.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const TAG = 86_400_000;

describe.skipIf(AUS)('Papierkorb gegen die echte Datenbank', () => {
	it('verwirft, verweigert Doppeltes, holt zurueck, loescht nur aus dem Papierkorb', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
			const d = tx as never;
			const neu = async (status: 'review' | 'confirmed') => {
				const [b] = await tx
					.insert(receipts)
					.values({
						householdId: k.haushaltId,
						uploadedBy: k.nutzerId,
						imagePath: 'test/papierkorb-nicht-da.webp',
						thumbPath: 'test/papierkorb-nicht-da.thumb.webp',
						status,
						confirmedAt: status === 'confirmed' ? new Date('2026-09-01T10:00:00Z') : null
					})
					.returning({ id: receipts.id });
				return b.id;
			};

			// Bestaetigt: erst mit Rueckfrage, dann zurueck — und er ist wieder bestaetigt.
			const best = await neu('confirmed');
			expect(await inPapierkorbLegen(d, k, best, false)).toMatchObject({ ok: false, status: 409 });
			expect(await inPapierkorbLegen(d, k, best, true)).toEqual({ ok: true });
			// Zweiter Klick: 409, und der Vorstatus bleibt 'confirmed'.
			expect(await inPapierkorbLegen(d, k, best, true)).toMatchObject({ ok: false, status: 409 });
			const [imKorb] = await tx.select().from(receipts).where(eq(receipts.id, best));
			expect(imKorb.status).toBe('verworfen');
			expect(imKorb.statusVorVerwerfen).toBe('confirmed');
			expect(imKorb.verworfenVon).toBe(k.nutzerId);
			expect(imKorb.verworfenAm).not.toBeNull();
			expect(await ausPapierkorbHolen(d, k, best)).toEqual({ ok: true, eingereiht: false, status: 'confirmed' });
			const [zurueck] = await tx.select().from(receipts).where(eq(receipts.id, best));
			expect(zurueck.status).toBe('confirmed');
			expect(zurueck.confirmedAt).toEqual(new Date('2026-09-01T10:00:00Z'));
			expect(zurueck.verworfenAm).toBeNull();
			expect(zurueck.statusVorVerwerfen).toBeNull();

			// Loeschen nur aus dem Papierkorb.
			const offen = await neu('review');
			expect(await endgueltigLoeschen(d, k, offen)).toMatchObject({ ok: false, status: 409 });
			expect(await tx.select().from(receipts).where(eq(receipts.id, offen))).toHaveLength(1);
			expect(await inPapierkorbLegen(d, k, offen, false)).toEqual({ ok: true });
			expect(await endgueltigLoeschen(d, k, offen)).toEqual({ ok: true });
			expect(await tx.select().from(receipts).where(eq(receipts.id, offen))).toHaveLength(0);

			// Frist: 31 Tage alt ist faellig, 29 Tage nicht.
			const alt = await neu('review');
			const jung = await neu('review');
			await inPapierkorbLegen(d, k, alt, false);
			await inPapierkorbLegen(d, k, jung, false);
			const jetzt = new Date();
			await tx.update(receipts).set({ verworfenAm: new Date(jetzt.getTime() - 31 * TAG) }).where(eq(receipts.id, alt));
			await tx.update(receipts).set({ verworfenAm: new Date(jetzt.getTime() - 29 * TAG) }).where(eq(receipts.id, jung));
			const faellig = await abgelaufeneBons(d, jetzt);
			expect(faellig).toContain(alt);
			expect(faellig).not.toContain(jung);

			// Ein anderer Mensch im Haushalt sieht den geteilten Bon (sichtbareBons fragt nur
			// Haushalt und Sichtbarkeit), darf ihn aber nicht verwerfen: 403, nichts geschrieben.
			await tx.update(receipts).set({ sichtbarkeit: 'geteilt' }).where(eq(receipts.id, best));
			const anderer = { ...k, nutzerId: '00000000-0000-4000-8000-000000000000' };
			const r = await inPapierkorbLegen(d, anderer, best, true);
			expect(r).toMatchObject({ ok: false, status: 403 });
			const [unberuehrt] = await tx.select().from(receipts).where(eq(receipts.id, best));
			expect(unberuehrt.status).toBe('confirmed');
		});
	});
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('Papierkorb leeren: die Frist steht im DELETE (Sammelfassung 4.3)', () => {
	it('loescht keinen Bon, der zwischen Auswahl und DELETE zurueckgeholt und neu verworfen wurde', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const d = tx as never;
			const [b] = await tx
				.insert(receipts)
				.values({ householdId: k.haushaltId, uploadedBy: k.nutzerId, imagePath: 'test/frist-nicht-da.webp', thumbPath: 'test/frist-nicht-da.thumb.webp', status: 'review' })
				.returning({ id: receipts.id });
			expect(await inPapierkorbLegen(d, k, b.id, false)).toEqual({ ok: true });
			const jetzt = new Date();
			await tx.update(receipts).set({ verworfenAm: new Date(jetzt.getTime() - 31 * 86_400_000) }).where(eq(receipts.id, b.id));
			expect(await abgelaufeneBons(d, jetzt)).toContain(b.id);

			// Zwischen Auswahl und DELETE: zurueckgeholt und gleich wieder verworfen.
			expect(await ausPapierkorbHolen(d, k, b.id)).toMatchObject({ ok: true });
			expect(await inPapierkorbLegen(d, k, b.id, false)).toEqual({ ok: true });

			// Nur den eigenen Bon: in bon_test koennen fremde, laengst faellige Bons liegen, und
			// loescheBilder nach dem DELETE holt kein Rollback zurueck. Die Bildablage ist in Tests
			// nie die der Produktion (vitest.setup.ts, testBildablage) — fremde Bilder trotzdem nicht.
			expect(await bonsEndgueltigLoeschen(d, [b.id], { verworfenVor: papierkorbGrenze(jetzt) })).toBe(0);
			expect(await tx.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, b.id))).toHaveLength(1);
		});
	});
});

/** Ein Bon mit Schein-Bildpfaden — endgueltigLoeschen entfernt Dateien, echte gibt es hier nicht. */
async function scheinBon(tx: Tx, k: Zugriffskontext, felder: Partial<typeof receipts.$inferInsert>): Promise<string> {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId: k.haushaltId,
			uploadedBy: k.nutzerId,
			imagePath: 'test/papierkorb-nicht-da.webp',
			thumbPath: 'test/papierkorb-nicht-da.thumb.webp',
			...felder
		})
		.returning({ id: receipts.id });
	return b.id;
}

describe.skipIf(AUS)('Papierkorb: Doppel und Einreihen (zurueckgerollt)', () => {
	// 2.11: scheitert das Einreihen, steht der Bon auf „fehlgeschlagen", und die Antwort sagt es.
	it('meldet eingereiht:false, wenn ein zurueckgeholter Bon nicht eingereiht werden kann', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const id = await scheinBon(tx, k, { status: 'verworfen', statusVorVerwerfen: 'extracting', verworfenAm: new Date() });
			const r = await ausPapierkorbHolen(tx as never, k, id, async () => {
				throw new Error('Warteschlange weg');
			});
			expect(r).toEqual({ ok: true, eingereiht: false, status: 'pending' });
			const [z] = await tx.select().from(receipts).where(eq(receipts.id, id));
			expect(z.status).toBe('failed');
			expect(z.failureReason).toBe('Warteschlange weg');
		});
	});

	// 2.8 (Entscheidung 07.10.2026): geht das Original endgueltig, geht der Doppel zurueck in die
	// Pruefung, und der Hinweis „Sieht aus wie ein schon erfasster Bon" faellt ueberall weg.
	it('loest beim endgueltigen Loeschen die Doppel-Verweise auf das Original', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const jetzt = new Date();
			const original = await scheinBon(tx, k, { status: 'verworfen', statusVorVerwerfen: 'review', verworfenAm: jetzt });
			const anderesOriginal = await scheinBon(tx, k, { status: 'review' });
			const doppel = await scheinBon(tx, k, { status: 'doppelt', vermutetesOriginalId: original, needsReviewReason: [DOPPEL_GRUND] });
			const mitHinweis = await scheinBon(tx, k, {
				status: 'review',
				vermutetesOriginalId: original,
				needsReviewReason: ['sum_mismatch', DOPPEL_GRUND]
			});
			const doppelImKorb = await scheinBon(tx, k, {
				status: 'verworfen',
				statusVorVerwerfen: 'doppelt',
				verworfenAm: jetzt,
				vermutetesOriginalId: original,
				needsReviewReason: [DOPPEL_GRUND]
			});
			const fremderDoppel = await scheinBon(tx, k, {
				status: 'doppelt',
				vermutetesOriginalId: anderesOriginal,
				needsReviewReason: [DOPPEL_GRUND]
			});

			expect(await endgueltigLoeschen(tx as never, k, original)).toEqual({ ok: true });

			const zeile = async (id: string) => (await tx.select().from(receipts).where(eq(receipts.id, id)))[0];
			expect(await zeile(doppel)).toMatchObject({ status: 'review', vermutetesOriginalId: null, needsReviewReason: null });
			expect(await zeile(mitHinweis)).toMatchObject({ status: 'review', vermutetesOriginalId: null, needsReviewReason: ['sum_mismatch'] });
			expect(await zeile(doppelImKorb)).toMatchObject({ status: 'verworfen', statusVorVerwerfen: 'review', needsReviewReason: null });
			expect(await zeile(fremderDoppel)).toMatchObject({
				status: 'doppelt',
				vermutetesOriginalId: anderesOriginal,
				needsReviewReason: [DOPPEL_GRUND]
			});
		});
	});
});
