/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/household.db.test.ts
 *
 * Bewacht die Eigenschaft, die seit Aufgabe 2 (18.09.2026) an die Stelle des alten
 * Wettlaufschutzes per Upsert getreten ist: `erstanmeldungAnlegen()` legt Haushalt,
 * Nutzer und Mitgliedschaft in EINER Transaktion an. Zwei Dinge werden geprüft:
 *
 * 1. Zwei Erstanmeldungen VERSCHIEDENER Nutzer ergeben zwei getrennte Haushalte,
 *    Nutzer und Mitgliedschaften (beide rolle='verwalter') statt des einen
 *    gemeinsamen 'default'-Haushalts von früher. Das sind zwei ECHTE, unabhängige
 *    Transaktionen — genau das ist gewollt ("zwei verschiedene Nutzer sollen jetzt
 *    ausdruecklich zwei Haushalte bekommen", Kommentar in household.ts). Ein
 *    gemeinsames ROLLBACK würde also genau die Eigenschaft wegdefinieren, die hier
 *    geprüft wird (dass beide Anlagen tatsächlich bestehen bleiben) — Aufräumen
 *    deshalb gezielt über einen eigenen Test-Tag im `afterAll`, wie in
 *    pairing.db.test.ts.
 *
 * 2. Bricht die Transaktion in der Mitte ab — zweite Erstanmeldung DESSELBEN
 *    oidc_sub, der Insert in `users` schlägt also im ZWEITEN Einfügeschritt fehl,
 *    NACHDEM der erste Schritt (Haushalt) in derselben Transaktion schon lief —,
 *    bleibt nichts übrig: kein zweiter Haushalt, kein zweiter Nutzer, keine
 *    Mitgliedschaft. Hier greift ein ECHTES ROLLBACK: `db.transaction()` in
 *    `erstanmeldungAnlegen()` bricht bei einem geworfenen Fehler die ganze
 *    Transaktion ab, Postgres nimmt auch den schon gelaufenen Haushalt-Insert
 *    zurück. Genau das ist der schlimmste Ausgang, den die Aufgabenbeschreibung
 *    nennt, wenn er NICHT so behandelt würde: ein halb angelegter Nutzer käme wegen
 *    `oidc_sub UNIQUE` nie wieder in den Anlege-Zweig und könnte sich nie mehr
 *    anmelden.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { count, eq, inArray, like } from 'drizzle-orm';
import { db } from './db';
import { households, users, householdMembers } from './db/schema';
import { erstanmeldungAnlegen, mitgliedschaftWiederherstellen } from './household';
import { createSession, validateSession } from './auth/session';

const RUN = process.env.RUN_DB_TESTS === '1';
const TAG = `test-erstanmeldung-${Date.now()}`;

// household_members faellt per ON DELETE CASCADE mit dem Nutzer weg, households
// ebenso — trotzdem beides explizit aufraeumen statt sich auf die Kaskade zu
// verlassen, damit ein Blick in die Tabelle waehrend der Fehlersuche nichts
// Halbfertiges zeigt.
const angelegteUserIds: string[] = [];
const angelegteHouseholdIds: string[] = [];

afterAll(async () => {
	if (!RUN) return;
	for (const id of angelegteUserIds) await db.delete(users).where(eq(users.id, id));
	for (const id of angelegteHouseholdIds) await db.delete(households).where(eq(households.id, id));
});

describe.skipIf(!RUN)('erstanmeldungAnlegen (live)', () => {
	it('gibt zwei verschiedenen Nutzern zwei getrennte Haushalte und Mitgliedschaften', async () => {
		const a = await erstanmeldungAnlegen({
			sub: `${TAG}-a`,
			email: `${TAG}-a@example.invalid`,
			name: `${TAG}-a`
		});
		const b = await erstanmeldungAnlegen({
			sub: `${TAG}-b`,
			email: `${TAG}-b@example.invalid`,
			name: `${TAG}-b`
		});
		angelegteUserIds.push(a.userId, b.userId);
		angelegteHouseholdIds.push(a.householdId, b.householdId);

		expect(a.householdId).not.toBe(b.householdId);
		expect(a.userId).not.toBe(b.userId);

		const mitgliedschaften = await db
			.select({
				userId: householdMembers.userId,
				householdId: householdMembers.householdId,
				rolle: householdMembers.rolle
			})
			.from(householdMembers)
			.where(inArray(householdMembers.userId, [a.userId, b.userId]));

		expect(mitgliedschaften).toHaveLength(2);
		for (const m of mitgliedschaften) expect(m.rolle).toBe('verwalter');

		// Der zweite Nutzer sieht den Haushalt des ersten nicht: seine EINZIGE
		// Mitgliedschaft zeigt auf SEINEN Haushalt, nicht auf den der ersten Anmelderin.
		const mitgliedschaftB = mitgliedschaften.find((m) => m.userId === b.userId);
		expect(mitgliedschaftB?.householdId).toBe(b.householdId);
		expect(mitgliedschaftB?.householdId).not.toBe(a.householdId);
	});

	it('laesst bei einer zweiten Erstanmeldung DESSELBEN Nutzers nichts uebrig', async () => {
		const sub = `${TAG}-doppelt`;
		const erste = await erstanmeldungAnlegen({
			sub,
			email: `${sub}@example.invalid`,
			name: `${sub}-original`
		});
		angelegteUserIds.push(erste.userId);
		angelegteHouseholdIds.push(erste.householdId);

		const [{ n: haushalteVorher }] = await db
			.select({ n: count() })
			.from(households)
			.where(like(households.name, `%${TAG}%`));

		// users.oidc_sub ist unique — dieser Aufruf MUSS im zweiten Einfuegeschritt
		// (Nutzer) scheitern, nachdem der erste Schritt (Haushalt) in dieser Transaktion
		// schon lief.
		await expect(
			erstanmeldungAnlegen({
				sub,
				email: `${sub}-zweite@example.invalid`,
				name: `${sub}-zweite`
			})
		).rejects.toThrow();

		// Kein zweiter Haushalt haengen geblieben — der schon gelaufene erste
		// Einfuegeschritt der gescheiterten Transaktion wurde mit zurueckgerollt.
		const [{ n: haushalteNachher }] = await db
			.select({ n: count() })
			.from(households)
			.where(like(households.name, `%${TAG}%`));
		expect(haushalteNachher).toBe(haushalteVorher);

		// Kein zweiter (halb angelegter) Nutzer mit demselben oidc_sub — nur der
		// urspruengliche ist da, und zwar unveraendert.
		const nutzerDanach = await db.select({ id: users.id }).from(users).where(eq(users.oidcSub, sub));
		expect(nutzerDanach).toHaveLength(1);
		expect(nutzerDanach[0].id).toBe(erste.userId);

		// Und keine verwaiste zweite Mitgliedschaft.
		const mitgliedschaftenDanach = await db
			.select()
			.from(householdMembers)
			.where(eq(householdMembers.userId, erste.userId));
		expect(mitgliedschaftenDanach).toHaveLength(1);
	});
});

/**
 * Review-Befund Fix-Runde 2 (Aufgabe 4): mitgliedEntfernen() entfernt die
 * Mitgliedschaft, laesst aber users.household_id auf dem alten (fuer den Nutzer nicht
 * mehr zugaenglichen) Haushalt stehen. Ohne mitgliedschaftWiederherstellen() bliebe ein
 * entfernter Nutzer beim naechsten Anmeldeversuch dauerhaft im Kreis (validateSession
 * verlangt eine Mitgliedschaft, der Callback legt aber keine neue an).
 */
describe.skipIf(!RUN)('mitgliedschaftWiederherstellen (live)', () => {
	it('gibt einem Nutzer ohne Mitgliedschaft einen eigenen Haushalt und macht ihn zum Verwalter', async () => {
		// Der Ausgangszustand, den mitgliedEntfernen() hinterlaesst: der Nutzer existiert,
		// hat aber keine Zeile mehr in household_members — users.household_id zeigt noch
		// auf den alten (fremden) Haushalt.
		const alterHaushalt = await erstanmeldungAnlegen({
			sub: `${TAG}-wh-alt`,
			email: `${TAG}-wh-alt@example.invalid`,
			name: `${TAG}-wh-alt`
		});
		angelegteUserIds.push(alterHaushalt.userId);
		angelegteHouseholdIds.push(alterHaushalt.householdId);
		await db.delete(householdMembers).where(eq(householdMembers.userId, alterHaushalt.userId));

		const { householdId: neuerHaushaltId } = await mitgliedschaftWiederherstellen(
			alterHaushalt.userId,
			`${TAG}-wh-neu`
		);
		angelegteHouseholdIds.push(neuerHaushaltId);

		expect(neuerHaushaltId).not.toBe(alterHaushalt.householdId);

		const [mitgliedschaft] = await db
			.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.userId, alterHaushalt.userId));
		expect(mitgliedschaft).toEqual({ householdId: neuerHaushaltId, rolle: 'verwalter' });

	});

	it('macht die Sitzung des Nutzers wieder gueltig', async () => {
		const nutzer = await erstanmeldungAnlegen({
			sub: `${TAG}-wh-sitzung`,
			email: `${TAG}-wh-sitzung@example.invalid`,
			name: `${TAG}-wh-sitzung`
		});
		angelegteUserIds.push(nutzer.userId);
		angelegteHouseholdIds.push(nutzer.householdId);
		await db.delete(householdMembers).where(eq(householdMembers.userId, nutzer.userId));

		// Genau der Zustand aus dem Review-Befund: eine Sitzung fuer einen Nutzer OHNE
		// Mitgliedschaft liefert nichts — validateSession() joint innerjoin gegen
		// household_members.
		const sitzungOhneMitgliedschaft = await createSession(nutzer.userId);
		expect(await validateSession(sitzungOhneMitgliedschaft.id)).toBeNull();

		const { householdId } = await mitgliedschaftWiederherstellen(nutzer.userId, `${TAG}-wh-sitzung-neu`);
		angelegteHouseholdIds.push(householdId);

		const sitzungDanach = await createSession(nutzer.userId);
		const sessionUser = await validateSession(sitzungDanach.id);
		expect(sessionUser).toMatchObject({ id: nutzer.userId, householdId, rolle: 'verwalter' });
	});
});
