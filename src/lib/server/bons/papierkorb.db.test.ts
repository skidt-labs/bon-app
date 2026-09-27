import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, householdMembers } from '$lib/server/db/schema';
import { inPapierkorbLegen, ausPapierkorbHolen, endgueltigLoeschen, abgelaufeneBons } from './papierkorb';

/**
 * Gegen die LAUFENDE Datenbank, hinter RUN_DB_TESTS=1, in einer Transaktion, die am Ende
 * zurueckrollt. Die Bons legt der Test selbst an, mit Schein-Bildpfaden: endgueltigLoeschen
 * entfernt Dateien, und ein Rollback holt keine Datei zurueck — echte Bons fasst er nie an.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');
const TAG = 86_400_000;

describe.skipIf(AUS)('Papierkorb gegen die echte Datenbank', () => {
	it('verwirft, verweigert Doppeltes, holt zurueck, loescht nur aus dem Papierkorb', async () => {
		const [m] = await db
			.select({ userId: householdMembers.userId, householdId: householdMembers.householdId })
			.from(householdMembers)
			.limit(1);
		if (!m) return;
		const k = { haushaltId: m.householdId, nutzerId: m.userId, rolle: 'mitglied' as const };

		await expect(
			db.transaction(async (tx) => {
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
				expect(await ausPapierkorbHolen(d, k, best)).toEqual({ ok: true });
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

				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	});
});
