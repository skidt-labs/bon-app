import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { households, receipts, users } from '$lib/server/db/schema';
import { DOPPEL_GRUND, doppeltEntscheiden, originalKurz, vermutetesOriginal } from './doppelt';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Live-Waechter gegen die LAUFENDE Datenbank — hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/doppelt.db.test.ts
 *
 * Schreibt in EINER Transaktion und wirft am Ende, damit Postgres alles zuruecknimmt. Ein
 * eigener, erfundener Haushalt mit zwei Nutzern — die echten Bons kommen in keinem
 * Vergleich vor, weil jede Abfrage auf den Haushalt beschraenkt ist.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('Doppel-Erkennung gegen die echte Datenbank', () => {
	it('findet, verschweigt und entscheidet genau nach der Regel', async () => {
		const tag = `doppel-test-${randomUUID()}`;

		await expect(
			db.transaction(async (tx) => {
				const [haushalt] = await tx
					.insert(households)
					.values({ name: 'Doppel-Test', slug: tag })
					.returning({ id: households.id });
				const nutzer = async (n: string) =>
					(
						await tx
							.insert(users)
							.values({ oidcSub: `${tag}-${n}`, email: `${tag}-${n}@example.invalid`, displayName: n })
							.returning({ id: users.id })
					)[0].id;
				const ich = await nutzer('ich');
				const partner = await nutzer('partner');

				const zeit = new Date('2026-08-05T17:20:00Z');
				const plus = (min: number) => new Date(zeit.getTime() + min * 60_000);
				let n = 0;
				const bon = async (felder: Partial<typeof receipts.$inferInsert>) =>
					(
						await tx
							.insert(receipts)
							.values({
								householdId: haushalt.id,
								uploadedBy: ich,
								imagePath: `test/${tag}-${++n}.webp`,
								thumbPath: `test/${tag}-${n}.thumb.webp`,
								status: 'review',
								totalGrossCents: 4001,
								purchasedAt: zeit,
								...felder
							})
							.returning({ id: receipts.id })
					)[0].id;

				const suche = (id: string, uploadedBy: string, purchasedAt: Date, totalGrossCents = 4001) =>
					vermutetesOriginal(tx, { id, householdId: haushalt.id, uploadedBy, purchasedAt, totalGrossCents });

				// --- Die Regel ---------------------------------------------------------
				const original = await bon({ status: 'confirmed' });
				const neu = await bon({ purchasedAt: plus(1) });
				expect(await suche(neu, ich, plus(1))).toBe(original);
				// Fuenf Minuten sind die Grenze, sechs nicht mehr.
				expect(await suche(neu, ich, plus(5))).toBe(original);
				expect(await suche(neu, ich, plus(6))).toBeNull();
				// Ein Cent Unterschied ist ein anderer Einkauf.
				expect(await suche(neu, ich, plus(1), 4002)).toBeNull();
				// Sich selbst findet ein Bon nicht.
				expect(await suche(original, ich, zeit)).toBe(neu);

				// --- Sichtbarkeit: der private Bon des Partners wird NICHT verglichen ---
				const partnerPrivat = await bon({
					uploadedBy: partner,
					sichtbarkeit: 'privat',
					totalGrossCents: 777,
					purchasedAt: plus(30)
				});
				expect(await suche(randomUUID(), ich, plus(30), 777)).toBeNull();
				// ... der geteilte aber schon.
				await tx.update(receipts).set({ sichtbarkeit: 'geteilt' }).where(eq(receipts.id, partnerPrivat));
				expect(await suche(randomUUID(), ich, plus(30), 777)).toBe(partnerPrivat);

				// --- Verworfene und fehlgeschlagene Bons sind keine Originale -----------
				await bon({ status: 'doppelt', totalGrossCents: 555, purchasedAt: plus(60) });
				await bon({ status: 'failed', totalGrossCents: 555, purchasedAt: plus(60) });
				expect(await suche(randomUUID(), ich, plus(60), 555)).toBeNull();

				// --- Entscheidungen -----------------------------------------------------
				const k: Zugriffskontext = { haushaltId: haushalt.id, nutzerId: ich, rolle: 'mitglied' };
				const markiert = await bon({
					purchasedAt: plus(1),
					vermutetesOriginalId: original,
					needsReviewReason: ['sum_mismatch', DOPPEL_GRUND]
				});
				const lies = async (id: string) =>
					(await tx.select().from(receipts).where(eq(receipts.id, id)))[0];

				// Eigener Einkauf: Hinweis weg, die ANDERE Beanstandung bleibt.
				expect(await doppeltEntscheiden(tx, k, markiert, 'eigenerEinkauf')).toBe(true);
				let r = await lies(markiert);
				expect(r.vermutetesOriginalId).toBeNull();
				expect(r.needsReviewReason).toEqual(['sum_mismatch']);
				expect(r.status).toBe('review');
				// Ohne offenen Hinweis greift keine zweite Entscheidung.
				expect(await doppeltEntscheiden(tx, k, markiert, 'doppelt')).toBe(false);

				// War der Doppel-Hinweis der einzige Grund, steht danach null — kein leeres Array.
				const nurDoppel = await bon({ vermutetesOriginalId: original, needsReviewReason: [DOPPEL_GRUND] });
				expect(await doppeltEntscheiden(tx, k, nurDoppel, 'eigenerEinkauf')).toBe(true);
				expect((await lies(nurDoppel)).needsReviewReason).toBeNull();

				// Doppelt → verworfen; wiederherstellen → zurueck MIT Hinweis.
				const zweiter = await bon({ vermutetesOriginalId: original, needsReviewReason: [DOPPEL_GRUND] });
				expect(await doppeltEntscheiden(tx, k, zweiter, 'doppelt')).toBe(true);
				expect((await lies(zweiter)).status).toBe('doppelt');
				expect(await doppeltEntscheiden(tx, k, zweiter, 'doppelt')).toBe(false);
				expect(await doppeltEntscheiden(tx, k, zweiter, 'wiederherstellen')).toBe(true);
				r = await lies(zweiter);
				expect(r.status).toBe('review');
				expect(r.vermutetesOriginalId).toBe(original);

				// Den privaten Bon eines anderen kann niemand entscheiden — er ist unsichtbar.
				const fremd = await bon({
					uploadedBy: partner,
					sichtbarkeit: 'privat',
					vermutetesOriginalId: original,
					needsReviewReason: [DOPPEL_GRUND]
				});
				expect(await doppeltEntscheiden(tx, k, fremd, 'doppelt')).toBe(false);
				expect((await lies(fremd)).status).toBe('review');

				// Der Hinweis zeigt das Original nur, solange man es sehen darf.
				expect((await originalKurz(tx, k, original))?.totalGrossCents).toBe(4001);
				const kPartner: Zugriffskontext = { haushaltId: haushalt.id, nutzerId: partner, rolle: 'mitglied' };
				await tx.update(receipts).set({ sichtbarkeit: 'privat' }).where(eq(receipts.id, original));
				expect(await originalKurz(tx, kPartner, original)).toBeNull();

				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	});
});
