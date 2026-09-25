/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/zugriff/sichtbarkeit.db.test.ts
 *
 * Bewacht die Regel, auf der der ganze Berechtigungsentwurf steht:
 *
 *     Ein Verwalter sieht die privaten Bons seiner Mitglieder NICHT.
 *
 * Aus dem erzeugten SQL folgt das bereits (sichtbar.test.ts prueft, dass Verwalter und
 * Mitglied dieselbe Bedingung bekommen). Das reicht aber nicht: dieser Test fragt die
 * echte Datenbank, ob die Bedingung auch das tut, was sie soll. Ein Filter, der richtig
 * aussieht und falsch trifft, faellt sonst erst jemandem auf, der fremde Bons sieht.
 *
 * Alles laeuft in EINER Transaktion, die am Ende zurueckgerollt wird — auf dem
 * Produktivsystem bleibt nichts liegen.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import {
	households,
	users,
	householdMembers,
	receipts,
	budgets,
	budgetKategorien,
	categories
} from '$lib/server/db/schema';
import { sichtbareBons } from './sichtbar';
import { bonLaden, listeLaden, filterAusQuery } from '$lib/server/bons/liste';
import type { Zugriffskontext } from './kontext';

const RUN = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN)('Sichtbarkeit am Bon (live)', () => {
	it('haelt die Kernregel: der Verwalter sieht den privaten Bon des Mitglieds nicht', async () => {
		await expect(
			db.transaction(async (tx) => {
				const neuerHaushalt = async (name: string) => {
					const [h] = await tx
						.insert(households)
						.values({ name, slug: randomUUID() })
						.returning({ id: households.id });
					return h.id;
				};
				const neuerNutzer = async (haushaltId: string, rolle: 'verwalter' | 'mitglied') => {
					const [u] = await tx
						.insert(users)
						.values({
							oidcSub: randomUUID(),
							email: `${randomUUID()}@example.invalid`,
							displayName: 'Testperson'
						})
						.returning({ id: users.id });
					await tx.insert(householdMembers).values({ householdId: haushaltId, userId: u.id, rolle });
					return u.id;
				};
				const neuerBon = async (
					haushaltId: string,
					userId: string,
					sichtbarkeit: 'geteilt' | 'privat'
				) => {
					const [b] = await tx
						.insert(receipts)
						.values({
							householdId: haushaltId,
							uploadedBy: userId,
							imagePath: 'test/erfunden.webp',
							thumbPath: 'test/erfunden-klein.webp',
							sichtbarkeit
						})
						.returning({ id: receipts.id });
					return b.id;
				};
				const sieht = async (k: Zugriffskontext) =>
					(await tx.select({ id: receipts.id }).from(receipts).where(sichtbareBons(k))).map(
						(z) => z.id
					);

				const h1 = await neuerHaushalt('Haushalt eins');
				const h2 = await neuerHaushalt('Haushalt zwei');
				const chef = await neuerNutzer(h1, 'verwalter');
				const mitglied = await neuerNutzer(h1, 'mitglied');
				const fremder = await neuerNutzer(h2, 'verwalter');

				const geteilt = await neuerBon(h1, mitglied, 'geteilt');
				const privatDesMitglieds = await neuerBon(h1, mitglied, 'privat');
				const privatDesChefs = await neuerBon(h1, chef, 'privat');

				const alsChef = await sieht({ haushaltId: h1, nutzerId: chef, rolle: 'verwalter' });
				const alsMitglied = await sieht({ haushaltId: h1, nutzerId: mitglied, rolle: 'mitglied' });
				const alsFremder = await sieht({ haushaltId: h2, nutzerId: fremder, rolle: 'verwalter' });

				// Die eigentliche Regel: Macht ueber das Geteilte, kein Einblick ins Private.
				expect(alsChef).not.toContain(privatDesMitglieds);
				expect(alsChef).toEqual(expect.arrayContaining([geteilt, privatDesChefs]));

				// Das Mitglied sieht sein eigenes Privates und das Geteilte — aber nicht
				// das Private des Verwalters. Die Regel gilt in beide Richtungen.
				expect(alsMitglied).toEqual(expect.arrayContaining([geteilt, privatDesMitglieds]));
				expect(alsMitglied).not.toContain(privatDesChefs);

				// Die harte Mandantengrenze: aus dem anderen Haushalt ist nichts davon zu sehen.
				expect(alsFremder).not.toEqual(expect.arrayContaining([geteilt]));
				expect(alsFremder).toHaveLength(0);

				/*
				 * Und jetzt der Nachweis fuer die Endpunkte.
				 *
				 * Der Bild-Endpunkt (/receipts/[id]/image) und die Detailseite gehen ueber
				 * `bonLaden`, die API-Liste ueber `listeLaden`. Beide sollen die Bedingung
				 * "erben" — aber geerbt ist eine Behauptung, solange es niemand nachgerechnet
				 * hat. Ein Bon, den man nicht sieht, dessen Bild man aber laden kann, ist kein
				 * halber Schutz, sondern gar keiner.
				 *
				 * Geprueft wird die Datenschicht, nicht die HTTP-Huelle: liefert `bonLaden`
				 * null, antwortet der Endpunkt mit 404 — das steht dort unmittelbar
				 * nebeneinander und ist ohne Datenbank pruefbar.
				 */
				const chefKontext: Zugriffskontext = { haushaltId: h1, nutzerId: chef, rolle: 'verwalter' };
				const tdb = tx as unknown as typeof db;

				expect(await bonLaden(tdb, chefKontext, privatDesMitglieds)).toBeNull();
				expect(await bonLaden(tdb, chefKontext, privatDesChefs)).not.toBeNull();
				expect(await bonLaden(tdb, chefKontext, geteilt)).not.toBeNull();

				const { filter } = filterAusQuery(new URLSearchParams(), { status: 'alle', monat: null });
				const { bons } = await listeLaden(tdb, chefKontext, filter);
				const gelistet = bons.map((b) => b.id);
				expect(gelistet).not.toContain(privatDesMitglieds);
				expect(gelistet).toEqual(expect.arrayContaining([geteilt, privatDesChefs]));

				// Nichts davon soll bleiben.
				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});

	it('laesst zwei PRIVATE Toepfe auf derselben Kategorie zu, zwei GETEILTE nicht', async () => {
		/*
		 * Der Index heisst richtig und steht richtig da — das prueft fk-integrity.db.test.ts.
		 * Hier geht es darum, ob er auch das Richtige TUT. Ein Index, dessen Text stimmt und
		 * der trotzdem falsch trifft, faellt sonst erst jemandem auf, dem die Oberflaeche
		 * einen Datenbankfehler zeigt, aus dem er nichts lesen kann.
		 */
		await expect(
			db.transaction(async (tx) => {
				const [h] = await tx
					.insert(households)
					.values({ name: 'Indexprobe', slug: randomUUID() })
					.returning({ id: households.id });
				const nutzer = async () => {
					const [u] = await tx
						.insert(users)
						.values({
							oidcSub: randomUUID(),
							email: `${randomUUID()}@example.invalid`,
							displayName: 'Testperson'
						})
						.returning({ id: users.id });
					return u.id;
				};
				const a = await nutzer();
				const b = await nutzer();
				const [kat] = await tx.select({ id: categories.id }).from(categories).limit(1);

				const topf = async (eigentuemerId: string | null) => {
					const [t] = await tx
						.insert(budgets)
						.values({
							householdId: h.id,
							name: 'Geschenke',
							sichtbarkeit: eigentuemerId ? 'privat' : 'geteilt',
							eigentuemerId
						})
						.returning({ id: budgets.id });
					return t.id;
				};
				const zuordnen = (budgetId: string, eigentuemerId: string | null) =>
					tx.insert(budgetKategorien).values({
						budgetId,
						householdId: h.id,
						categoryId: kat.id,
						giltAb: '2026-09-01',
						eigentuemerId
					});

				// Zwei private Toepfe verschiedener Mitglieder auf derselben Kategorie:
				// der eigentliche Zweck der Aenderung. Ginge das nicht, waeren private
				// Toepfe in einem Haushalt mit zwei Personen praktisch unbrauchbar.
				await zuordnen(await topf(a), a);
				await zuordnen(await topf(b), b);

				// Zwei GETEILTE auf derselben Kategorie muessen weiterhin scheitern. Ohne
				// NULLS NOT DISTINCT ginge das durch, weil Postgres zwei NULL-Eigentuemer
				// als verschieden ansieht — die Regel, die es seit jeher gibt, waere beim
				// Einbau der privaten Toepfe still verlorengegangen.
				await zuordnen(await topf(null), null);
				await expect(zuordnen(await topf(null), null)).rejects.toThrow();

				throw new Error('ROLLBACK_ABSICHT');
			})
			// AUSDRUECKLICH auf diese Meldung, nicht auf "irgendein Fehler": sonst ginge
			// auch eine fehlgeschlagene Behauptung weiter oben als Erfolg durch, und der
			// Test waere blind gruen.
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
