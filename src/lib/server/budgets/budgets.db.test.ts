import { describe, it, expect } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	budgets,
	budgetBetraege,
	budgetKategorien,
	categories,
	households,
	users,
	householdMembers
} from '$lib/server/db/schema';
import { randomUUID } from 'node:crypto';
import { budgetAnlegen, betragSetzen, kategorieLoesen, kategorieZuordnen } from './verwaltung';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Live-Waechter gegen die LAUFENDE Datenbank — hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/budgets/budgets.db.test.ts
 *
 * Schreibt in einer Transaktion und wirft am Ende, damit Postgres alles zuruecknimmt.
 * Geprueft wird genau das, was kein Einheitstest kann: dass die Regel „eine Kategorie
 * gehoert zu einer Zeit hoechstens einem Topf" als DATENBANKREGEL greift und nicht nur
 * als Absicht in der Oberflaeche. Der Entwurf verlangt sie ausdruecklich dort — eine
 * Oberflaeche, die Vergebenes blos ausgraut, laesst jeden anderen Weg offen.
 *
 * Die erwarteten Verstoesse laufen in `tx.transaction(...)`, also auf einem
 * SICHERUNGSPUNKT. Ohne den waere die aeussere Transaktion nach dem ersten Fehler
 * abgebrochen und jede weitere Anweisung liefe ins Leere — Postgres kennt kein
 * „weitermachen nach einem Fehler".
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('Budget-Zuordnungen gegen die echte Datenbank', () => {
	it('laesst eine Kategorie nur in EINEM laufenden Topf zu, nach Beendigung wieder frei', async () => {
		const [haushalt] = await db.select({ id: households.id }).from(households).limit(1);
		const [kategorie] = await db.select({ id: categories.id }).from(categories).limit(1);
		if (!haushalt || !kategorie) return;
		const [{ vorher }] = await db.select({ vorher: count() }).from(budgets);

		await expect(
			db.transaction(async (tx) => {
				const [topfA] = await tx
					.insert(budgets)
					.values({ householdId: haushalt.id, name: 'Waechter A' })
					.returning({ id: budgets.id });
				const [topfB] = await tx
					.insert(budgets)
					.values({ householdId: haushalt.id, name: 'Waechter B' })
					.returning({ id: budgets.id });

				// Ein Betrag je Topf und Monat. Zwei Angaben fuer denselben Monat waeren zwei
				// Wahrheiten fuer denselben Zeitraum.
				await tx
					.insert(budgetBetraege)
					.values({ budgetId: topfA.id, giltAb: '2026-09-01', amountCents: 25000 });
				await expect(
					tx.transaction(async (sp) => {
						await sp
							.insert(budgetBetraege)
							.values({ budgetId: topfA.id, giltAb: '2026-09-01', amountCents: 30000 });
					})
				).rejects.toThrow();

				const [erste] = await tx
					.insert(budgetKategorien)
					.values({
						budgetId: topfA.id,
						householdId: haushalt.id,
						categoryId: kategorie.id,
						giltAb: '2026-09-01'
					})
					.returning({ id: budgetKategorien.id });

				// Dieselbe Kategorie ein zweites Mal, laufend: die Datenbank muss ablehnen.
				await expect(
					tx.transaction(async (sp) => {
						await sp.insert(budgetKategorien).values({
							budgetId: topfB.id,
							householdId: haushalt.id,
							categoryId: kategorie.id,
							giltAb: '2026-09-01'
						});
					})
				).rejects.toThrow();

				// Wird die erste beendet, ist die Kategorie wieder frei — sonst koennte eine
				// Kategorie nie den Topf wechseln, und genau das soll moeglich sein.
				await tx
					.update(budgetKategorien)
					.set({ giltBis: '2026-09-30' })
					.where(eq(budgetKategorien.id, erste.id));

				const [zweite] = await tx
					.insert(budgetKategorien)
					.values({
						budgetId: topfB.id,
						householdId: haushalt.id,
						categoryId: kategorie.id,
						giltAb: '2026-10-01'
					})
					.returning({ id: budgetKategorien.id });
				expect(zweite.id).toBeTruthy();

				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);

		const [{ nachher }] = await db.select({ nachher: count() }).from(budgets);
		expect(nachher).toBe(vorher);
	});
});

describe.skipIf(AUS)('Verwaltung gegen die echte Datenbank', () => {
	it('nennt beim Konflikt den Topf, dem die Kategorie schon gehoert', async () => {
		const [haushalt] = await db.select({ id: households.id }).from(households).limit(1);
		const [kategorie] = await db.select({ id: categories.id }).from(categories).limit(1);
		if (!haushalt || !kategorie) return;
		const k: Zugriffskontext = { haushaltId: haushalt.id, nutzerId: 'test', rolle: 'mitglied' };
		const [{ vorher }] = await db.select({ vorher: count() }).from(budgets);

		await expect(
			db.transaction(async (tx) => {
				const a = await budgetAnlegen(tx, k, 'Lebensmittel');
				const b = await budgetAnlegen(tx, k, 'Haushalt');
				await kategorieZuordnen(tx, k, a, kategorie.id, '2026-09');

				// Derselbe Topf noch einmal: kein Fehler, das Ergebnis stimmt ja schon.
				await kategorieZuordnen(tx, k, a, kategorie.id, '2026-09');

				// Ein anderer Topf: abgelehnt, MIT Namen. Das laeuft hier IN einer
				// Transaktion — der frueheren Fassung, die den Namen erst nach dem
				// abgelehnten INSERT holte, waere genau hier die Abfrage ins Leere gelaufen.
				await expect(kategorieZuordnen(tx, k, b, kategorie.id, '2026-09')).rejects.toThrow(
					/Lebensmittel/
				);

				// Nach dem Loesen ab Oktober ist sie frei — im September zaehlt sie noch.
				// Die Topf-Id gehoert seit Befund R18 zwingend dazu: ohne sie traf das
				// UPDATE jede offene Zuordnung dieser Kategorie im Haushalt. Hier ist es
				// Topf `a`, dessen Zuordnung beendet werden soll.
				await kategorieLoesen(tx, k, a, kategorie.id, '2026-10');
				await kategorieZuordnen(tx, k, b, kategorie.id, '2026-10');

				// Betrag zweimal fuer denselben Monat heisst aendern, nicht anlegen.
				await betragSetzen(tx, a, '2026-09', 25000);
				await betragSetzen(tx, a, '2026-09', 30000);
				const betraege = await tx.select().from(budgetBetraege).where(eq(budgetBetraege.budgetId, a));
				expect(betraege).toHaveLength(1);
				expect(betraege[0].amountCents).toBe(30000);

				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);

		const [{ nachher }] = await db.select({ nachher: count() }).from(budgets);
		expect(nachher).toBe(vorher);
	});

	it('schreibt den Eigentuemer mit und loest nur den eigenen Topf (R18/R19)', async () => {
		/*
		 * Diese Probe geht durch die ECHTEN Funktionen, nicht an ihnen vorbei.
		 *
		 * Der bestehende Live-Test zum Index fuegte seine Zeilen direkt ein und war
		 * deshalb gruen, obwohl `kategorieZuordnen` die Spalte `eigentuemer_id` gar nicht
		 * schrieb: er prueft den Index und uebersah den Schreiber. Ein Waechter, der die
		 * Regel kennt, aber nicht den Weg dorthin, faengt genau den Fehler nicht, fuer den
		 * es ihn gibt.
		 */
		await expect(
			db.transaction(async (tx) => {
				const [h] = await tx
					.insert(households)
					.values({ name: 'R18R19', slug: randomUUID() })
					.returning({ id: households.id });
				const nutzer = async (rolle: 'verwalter' | 'mitglied') => {
					const [u] = await tx
						.insert(users)
						.values({
							oidcSub: randomUUID(),
							email: `${randomUUID()}@example.invalid`,
							displayName: 'Testperson'
						})
						.returning({ id: users.id });
					await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, rolle });
					return u.id;
				};
				const chef = await nutzer('verwalter');
				const mitglied = await nutzer('mitglied');
				const [kat] = await tx.select({ id: categories.id }).from(categories).limit(1);
				const kChef: Zugriffskontext = { haushaltId: h.id, nutzerId: chef, rolle: 'verwalter' };
				const kMit: Zugriffskontext = { haushaltId: h.id, nutzerId: mitglied, rolle: 'mitglied' };

				const geteilt = await budgetAnlegen(tx, kChef, 'Haushalt', false);
				const privatChef = await budgetAnlegen(tx, kChef, 'Geschenke Chef', true);
				const privatMit = await budgetAnlegen(tx, kMit, 'Geschenke Mitglied', true);

				// Alle drei duerfen DIESELBE Kategorie fuehren — je in ihrem Bereich.
				// Vor der Korrektur scheiterte schon der zweite Aufruf, weil die
				// Konfliktsuche ueber den ganzen Haushalt lief.
				await kategorieZuordnen(tx, kChef, geteilt, kat.id, '2026-09');
				await kategorieZuordnen(tx, kChef, privatChef, kat.id, '2026-09');
				await kategorieZuordnen(tx, kMit, privatMit, kat.id, '2026-09');

				// Der Eigentuemer steht an der Zuordnung — sonst waere der Index mit
				// NULLS NOT DISTINCT wirkungslos, weil alle Zeilen NULL truegen.
				const zeilen = await tx
					.select({ budgetId: budgetKategorien.budgetId, eig: budgetKategorien.eigentuemerId })
					.from(budgetKategorien)
					.where(eq(budgetKategorien.householdId, h.id));
				const je = new Map(zeilen.map((z) => [z.budgetId, z.eig]));
				expect(je.get(geteilt)).toBeNull();
				expect(je.get(privatChef)).toBe(chef);
				expect(je.get(privatMit)).toBe(mitglied);

				// Das Mitglied loest seine eigene Zuordnung — und NUR seine. Vor der
				// Korrektur traf dasselbe UPDATE alle drei, auch den gemeinsamen Topf,
				// den ein Mitglied gar nicht verwalten darf.
				await kategorieLoesen(tx, kMit, privatMit, kat.id, '2026-10');
				const offen = await tx
					.select({ budgetId: budgetKategorien.budgetId, bis: budgetKategorien.giltBis })
					.from(budgetKategorien)
					.where(eq(budgetKategorien.householdId, h.id));
				const bis = new Map(offen.map((z) => [z.budgetId, z.bis]));
				expect(bis.get(privatMit)).not.toBeNull();
				expect(bis.get(geteilt)).toBeNull();
				expect(bis.get(privatChef)).toBeNull();

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
