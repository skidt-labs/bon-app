/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/berichte/optionen.db.test.ts
 *
 * Bewacht: die Vorschau der Filterauswahl („Betrag · N Bons") zaehlt private Bons anderer
 * nie mit — sonst verriete schon die Zahl neben einem Namen, dass es sie gibt.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { households, users, householdMembers, receipts, receiptItems, merchants } from '$lib/server/db/schema';
import { heutigerTag } from '$lib/server/zeit';
import { leererFilter } from '$lib/berichte/filter';
import { monatVon } from '$lib/berichte/kalender';
import { filterOptionen } from './optionen';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('Filterauswahl: Vorschau (live)', () => {
	it('zaehlt fremdes Privates nicht und rechnet mit den uebrigen Filtern', async () => {
		await expect(
			db.transaction(async (tx) => {
				const tdb = tx as unknown as typeof db;
				const [h] = await tx.insert(households).values({ name: 'Berichtstest', slug: randomUUID() }).returning({ id: households.id });
				const person = async (rolle: 'verwalter' | 'mitglied') => {
					const [u] = await tx
						.insert(users)
						.values({ oidcSub: randomUUID(), email: `${randomUUID()}@example.invalid`, displayName: rolle === 'verwalter' ? 'Erika' : 'Max' })
						.returning({ id: users.id });
					await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle });
					return u.id;
				};
				const erika = await person('verwalter');
				const max = await person('mitglied');
				const [laden] = await tx.insert(merchants).values({ name: 'Testladen', normalizedName: `testladen-${randomUUID()}` }).returning({ id: merchants.id });
				const bon = async (von: string, sichtbarkeit: 'geteilt' | 'privat', cents: number, mitLaden: boolean) => {
					const [r] = await tx
						.insert(receipts)
						.values({
							householdId: h.id, uploadedBy: von, imagePath: 'test/erfunden.webp', thumbPath: 'test/erfunden-klein.webp',
							sichtbarkeit, status: 'confirmed', purchasedAt: new Date(), totalGrossCents: cents, merchantId: mitLaden ? laden.id : null
						})
						.returning({ id: receipts.id });
					await tx.insert(receiptItems).values({ receiptId: r.id, lineNo: 1, rawText: 'Testware', totalPriceCents: cents });
				};
				await bon(erika, 'geteilt', 1000, true);
				await bon(erika, 'privat', 500, true);
				await bon(max, 'privat', 7000, true);
				await bon(max, 'geteilt', 200, false);

				const k = { haushaltId: h.id, nutzerId: erika, rolle: 'verwalter' as const };
				const monat = leererFilter({ art: 'monat', monat: monatVon(heutigerTag()) });

				const personen = await filterOptionen(tdb, k, monat, 'person');
				expect(personen.find((o) => o.wert === max)).toMatchObject({ name: 'Max', cents: 200, bons: 1, gewaehlt: false });
				expect(personen.find((o) => o.wert === erika)).toMatchObject({ cents: 1500, bons: 2 });

				const laeden = await filterOptionen(tdb, k, { ...monat, laden: [laden.id] }, 'laden');
				expect(laeden.find((o) => o.wert === laden.id)).toMatchObject({ name: 'Testladen', cents: 1500, bons: 2, gewaehlt: true });
				expect(laeden.find((o) => o.wert === 'ohne')).toMatchObject({ name: 'Laden unbekannt', cents: 200, bons: 1 });

				// Die uebrigen Filter wirken: mit Person=Max bleibt beim Laden nur „unbekannt".
				const mitPerson = await filterOptionen(tdb, k, { ...monat, person: [max] }, 'laden');
				expect(mitPerson.map((o) => o.wert)).toEqual(['ohne']);

				const kategorien = await filterOptionen(tdb, k, monat, 'kategorie');
				expect(kategorien.find((o) => o.wert === 'unsortiert')).toMatchObject({ name: 'Ohne Kategorie', cents: 1700, bons: 3 });

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
