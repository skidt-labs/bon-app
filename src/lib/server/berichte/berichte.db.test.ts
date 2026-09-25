/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/berichte/berichte.db.test.ts
 *
 * Bewacht: ein privater Bon eines anderen Mitglieds taucht in keiner Summe, keiner Liste
 * und keinem „Bons zu …" auf — auch nicht mit laden=/kategorie= genau auf diesen Bon.
 * „Nur meine" zeigt eigene geteilte UND private Bons.
 *
 * Alles laeuft in EINER Transaktion, die am Ende zurueckgerollt wird.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { households, users, householdMembers, receipts, receiptItems, merchants, categories } from '$lib/server/db/schema';
import { heutigerTag } from '$lib/server/zeit';
import { leererFilter } from '$lib/berichte/filter';
import { monatVon } from '$lib/berichte/kalender';
import { berichtLaden } from './abfragen';
import { bonsZuFilter } from './bons';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('Berichte: Sichtbarkeit mit Filtern (live)', () => {
	it('zeigt fremde private Bons in keiner Summe und keiner Liste', async () => {
		await expect(
			db.transaction(async (tx) => {
				const tdb = tx as unknown as typeof db;
				const [h] = await tx.insert(households).values({ name: 'Berichtstest', slug: randomUUID() }).returning({ id: households.id });
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

				const [laden] = await tx
					.insert(merchants)
					.values({ name: 'Testladen', normalizedName: `testladen-${randomUUID()}` })
					.returning({ id: merchants.id });
				// Eine vorhandene Unterkategorie samt Oberkategorie (der Kategoriebaum ist global).
				const [kind] = await tx
					.select({ id: categories.id, slug: categories.slug, parentId: categories.parentId })
					.from(categories)
					.where(isNotNull(categories.parentId))
					.limit(1);
				const oberSlug = (
					await tx.select({ id: categories.id, slug: categories.slug }).from(categories)
				).find((c) => c.id === kind.parentId)!.slug;

				const bon = async (von: string, sichtbarkeit: 'geteilt' | 'privat', cents: number, mitLaden: boolean) => {
					const [b] = await tx
						.insert(receipts)
						.values({
							householdId: h.id,
							uploadedBy: von,
							imagePath: 'test/erfunden.webp',
							thumbPath: 'test/erfunden-klein.webp',
							sichtbarkeit,
							status: 'confirmed',
							purchasedAt: new Date(),
							totalGrossCents: cents,
							merchantId: mitLaden ? laden.id : null
						})
						.returning({ id: receipts.id });
					await tx.insert(receiptItems).values({ receiptId: b.id, lineNo: 1, rawText: 'Testware', totalPriceCents: cents, categoryId: mitLaden ? kind.id : null });
					return b.id;
				};
				const erikaGeteilt = await bon(erika, 'geteilt', 1000, true);
				const erikaPrivat = await bon(erika, 'privat', 500, true);
				const maxPrivat = await bon(max, 'privat', 7000, true);
				const maxGeteilt = await bon(max, 'geteilt', 200, false);

				const heute = heutigerTag();
				const monat = leererFilter({ art: 'monat', monat: monatVon(heute) });
				const alsErika = { haushaltId: h.id, nutzerId: erika, rolle: 'verwalter' as const };
				const alsMax = { haushaltId: h.id, nutzerId: max, rolle: 'mitglied' as const };

				// Haushalt: alles Sichtbare, ohne Max' privaten Bon.
				const haushalt = await berichtLaden(tdb, alsErika, monat, heute);
				expect(haushalt.kennzahlen).toMatchObject({ summe: 1700, bons: 3 });
				expect(haushalt.verlauf[haushalt.verlauf.length - 1].cents).toBe(1700);
				expect(haushalt.budgets).toEqual({ art: 'monat', liste: [] });

				// Laden- und Kategoriefilter genau auf Max' privaten Bon: er bleibt draussen.
				expect((await berichtLaden(tdb, alsErika, { ...monat, laden: [laden.id] }, heute)).kennzahlen.summe).toBe(1500);
				expect((await berichtLaden(tdb, alsErika, { ...monat, kategorie: [kind.slug] }, heute)).kennzahlen.summe).toBe(1500);
				expect((await berichtLaden(tdb, alsErika, { ...monat, kategorie: [oberSlug] }, heute)).kennzahlen.summe).toBe(1500);

				const nachLaden = await bonsZuFilter(tdb, alsErika, { ...monat, laden: [laden.id] });
				expect(nachLaden.bons.map((b) => b.id).sort()).toEqual([erikaGeteilt, erikaPrivat].sort());
				expect(nachLaden.bons.find((b) => b.id === erikaPrivat)?.privat).toBe(true);
				const nachKategorie = await bonsZuFilter(tdb, alsErika, { ...monat, kategorie: [oberSlug] });
				expect(nachKategorie.bons.map((b) => b.id)).not.toContain(maxPrivat);
				expect(nachKategorie.summe).toBe(1500);
				expect(nachKategorie.unterkategorien).toEqual([expect.objectContaining({ slug: kind.slug, cents: 1500 })]);

				// „Nur meine": eigene geteilte UND private, nichts von Max.
				expect((await berichtLaden(tdb, alsErika, { ...monat, umfang: 'meine' }, heute)).kennzahlen).toMatchObject({ summe: 1500, bons: 2 });
				expect((await berichtLaden(tdb, alsErika, { ...monat, umfang: 'meine' }, heute)).budgets.art).toBe('keine');

				// Und andersherum: Max sieht seinen privaten, nicht Erikas.
				expect((await berichtLaden(tdb, alsMax, monat, heute)).kennzahlen.summe).toBe(1000 + 7000 + 200);
				expect((await bonsZuFilter(tdb, alsMax, { ...monat, laden: [laden.id] })).bons.map((b) => b.id)).not.toContain(erikaPrivat);
				void maxGeteilt;

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});

	/*
	 * Abschlusspruefung: (1) Ein Bon ohne erkannte Endsumme stand in „Bons zu …" fuer einen
	 * Laden als 0,00 € und zaehlte als 0 in der Summe — null ist eine Leerstelle. (2) Eine
	 * unbekannte Kategorie (veraltetes Lesezeichen) liess die Liste ALLE Bons zeigen.
	 */
	it('fuehrt Bons ohne Endsumme als Leerstelle und zeigt bei unbekannter Kategorie nichts', async () => {
		await expect(
			db.transaction(async (tx) => {
				const tdb = tx as unknown as typeof db;
				const [h] = await tx.insert(households).values({ name: 'Berichtstest', slug: randomUUID() }).returning({ id: households.id });
				const [u] = await tx
					.insert(users)
					.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: 'Testperson' })
					.returning({ id: users.id });
				await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle: 'verwalter' });
				const [laden] = await tx
					.insert(merchants)
					.values({ name: 'Testladen', normalizedName: `testladen-${randomUUID()}` })
					.returning({ id: merchants.id });
				const bon = async (cents: number | null) => {
					const [b] = await tx
						.insert(receipts)
						.values({
							householdId: h.id, uploadedBy: u.id, imagePath: 'test/erfunden.webp', thumbPath: 'test/erfunden-klein.webp',
							sichtbarkeit: 'geteilt', status: 'confirmed', purchasedAt: new Date(), totalGrossCents: cents, merchantId: laden.id
						})
						.returning({ id: receipts.id });
					await tx.insert(receiptItems).values({ receiptId: b.id, lineNo: 1, rawText: 'Testware', totalPriceCents: 300 });
					return b.id;
				};
				const mitSumme = await bon(1000);
				const ohneSumme = await bon(null);
				const k = { haushaltId: h.id, nutzerId: u.id, rolle: 'verwalter' as const };
				const monat = leererFilter({ art: 'monat', monat: monatVon(heutigerTag()) });

				const nachLaden = await bonsZuFilter(tdb, k, { ...monat, laden: [laden.id] });
				expect(nachLaden.bons.find((b) => b.id === ohneSumme)?.passendCents).toBeNull();
				expect(nachLaden.bons.find((b) => b.id === mitSumme)?.passendCents).toBe(1000);
				expect(nachLaden.summe).toBe(1000);
				expect(nachLaden.ohneBetrag).toBe(1);

				const unbekannt = await bonsZuFilter(tdb, k, { ...monat, kategorie: ['gibtsnicht'] });
				expect(unbekannt.bons).toEqual([]);
				expect(unbekannt.nachKategorie).toBe(false);
				expect(unbekannt.hinweise.join(' ')).toContain('gibtsnicht');

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
