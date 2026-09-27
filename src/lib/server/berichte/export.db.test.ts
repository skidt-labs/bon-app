/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/berichte/export.db.test.ts
 *
 * Bewertung 25.09.2026: exportZeilenLaden verglich mit `<=` gegen das Monatsende, das
 * monatsgrenzen() AUSSCHLIESSLICH meint. Ein Bon um genau 00:00 Uhr Berliner Zeit am
 * Ersten stand damit in zwei Monatsexporten.
 *
 * Alles laeuft in EINER Transaktion, die am Ende zurueckgerollt wird.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { households, users, householdMembers, receipts, receiptItems } from '$lib/server/db/schema';
import { monatsgrenzen } from '$lib/server/zeit';
import { exportLaden } from './export';
import { leererFilter } from '$lib/berichte/filter';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('CSV-Export an der Monatsgrenze (live)', () => {
	it('fuehrt einen Bon um Mitternacht am Ersten nur im neuen Monat', async () => {
		await expect(
			db.transaction(async (tx) => {
				const [h] = await tx
					.insert(households)
					.values({ name: 'Grenztest', slug: randomUUID() })
					.returning({ id: households.id });
				const [u] = await tx
					.insert(users)
					.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
					.returning({ id: users.id });
				await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle: 'verwalter' });

				const september = monatsgrenzen('2026-09')!;
				const oktober = monatsgrenzen('2026-10')!;
				// Genau der Zeitpunkt, an dem September endet und Oktober beginnt.
				expect(september.bis.getTime()).toBe(oktober.von.getTime());

				const [bon] = await tx
					.insert(receipts)
					.values({
						householdId: h.id,
						uploadedBy: u.id,
						imagePath: 'test/erfunden.webp',
						thumbPath: 'test/erfunden-klein.webp',
						sichtbarkeit: 'geteilt',
						status: 'confirmed',
						purchasedAt: september.bis,
						totalGrossCents: 100
					})
					.returning({ id: receipts.id });
				await tx.insert(receiptItems).values({ receiptId: bon.id, lineNo: 1, rawText: 'Grenzfall', totalPriceCents: 100 });

				const k = { haushaltId: h.id, nutzerId: u.id, rolle: 'verwalter' as const };
				const tdb = tx as unknown as typeof db;
				const monat = (m: string) => leererFilter({ art: 'monat', monat: m });
				expect((await exportLaden(tdb, k, monat('2026-09'))).zeilen.map((z) => z.bonId)).not.toContain(bon.id);
				expect((await exportLaden(tdb, k, monat('2026-10'))).zeilen.map((z) => z.bonId)).toContain(bon.id);

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});

	/*
	 * Stufe 3: die Ausfuhr nimmt den Filter des Berichts. Mit Suche nur die passenden
	 * Positionen (samt Rabatt darauf); fremde private Bons nie.
	 */
	it('fuehrt mit Positionsfilter nur passende Positionen aus und nie fremdes Privates', async () => {
		await expect(
			db.transaction(async (tx) => {
				const tdb = tx as unknown as typeof db;
				const [h] = await tx.insert(households).values({ name: 'Grenztest', slug: randomUUID() }).returning({ id: households.id });
				const person = async (rolle: 'verwalter' | 'mitglied') => {
					const [u] = await tx
						.insert(users)
						.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
						.returning({ id: users.id });
					await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle });
					return u.id;
				};
				const erika = await person('verwalter');
				const max = await person('mitglied');
				const bon = async (von: string, sichtbarkeit: 'geteilt' | 'privat', zeilen: [string, number, string?, number?][]) => {
					const [r] = await tx
						.insert(receipts)
						.values({
							householdId: h.id, uploadedBy: von, imagePath: 'test/erfunden.webp', thumbPath: 'test/erfunden-klein.webp',
							sichtbarkeit, status: 'confirmed', purchasedAt: new Date('2026-09-15T12:00:00Z'), totalGrossCents: zeilen.reduce((s, z) => s + z[1], 0)
						})
						.returning({ id: receipts.id });
					await tx.insert(receiptItems).values(
						zeilen.map(([rawText, cents, lineType, appliesToLine], i) => ({
							receiptId: r.id, lineNo: i + 1, rawText, totalPriceCents: cents,
							lineType: (lineType ?? 'article') as 'article', appliesToLine: appliesToLine ?? null
						}))
					);
					return r.id;
				};
				const eigener = await bon(erika, 'geteilt', [['KAFFEE Crema', 500], ['Rabatt', -50, 'discount', 1], ['Milch', 120]]);
				const fremd = await bon(max, 'privat', [['Kaffee geheim', 7000]]);
				const k = { haushaltId: h.id, nutzerId: erika, rolle: 'verwalter' as const };
				const september = leererFilter({ art: 'monat', monat: '2026-09' });

				const alles = await exportLaden(tdb, k, september);
				expect(alles.zeilen.map((z) => z.rawText)).toEqual(['KAFFEE Crema', 'Rabatt', 'Milch']);
				const kaffee = await exportLaden(tdb, k, { ...september, suche: 'kaffee' });
				expect(kaffee.zeilen.map((z) => [z.bonId, z.rawText])).toEqual([[eigener, 'KAFFEE Crema'], [eigener, 'Rabatt']]);
				expect(kaffee.zeilen.map((z) => z.bonId)).not.toContain(fremd);

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
