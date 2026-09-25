/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/matrix/links.db.test.ts
 *
 * Befund R02, Schicht 3 (die eigentliche Absicherung): nutzerZuMatrixId() muss den
 * Haushalt über einen INNER JOIN auf household_members auflösen, nicht über das
 * stehenbleibende users.household_id. Der Mock in links.test.ts kann das nicht
 * zeigen — er tut so, als käme aus dem JOIN immer genau das heraus, was der Test
 * vorgibt, unabhängig davon, ob eine passende household_members-Zeile existiert.
 * Nur eine echte Datenbank prüft, dass der JOIN tatsächlich FILTERT.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { households, users, householdMembers, matrixLinks } from '../db/schema';
import { nutzerZuMatrixId } from './links';

const RUN = process.env.RUN_DB_TESTS === '1';
const TAG = `test-links-${Date.now()}`;

let haushaltId: string | undefined;
let userId: string | undefined;

afterAll(async () => {
	if (!RUN) return;
	// matrix_links und household_members haengen per onDelete:cascade an users, users
	// per (ungerichtetem RESTRICT) household_id an households — deshalb erst den
	// Nutzer, dann den Haushalt.
	if (userId) await db.delete(users).where(eq(users.id, userId));
	if (haushaltId) await db.delete(households).where(eq(households.id, haushaltId));
});

describe.skipIf(!RUN)('nutzerZuMatrixId (live)', () => {
	it('liefert Nutzer und Haushalt, solange eine Mitgliedschaft besteht', async () => {
		const [haushalt] = await db
			.insert(households)
			.values({ name: 'Links-Test', slug: TAG })
			.returning({ id: households.id });
		haushaltId = haushalt.id;
		const [nutzer] = await db
			.insert(users)
			.values({
				oidcSub: TAG,
				email: `${TAG}@example.invalid`,
				displayName: 'Links-Test'
			})
			.returning({ id: users.id });
		userId = nutzer.id;
		await db.insert(householdMembers).values({ householdId: haushalt.id, userId: nutzer.id, rolle: 'mitglied' });
		const matrixUserId = `@${TAG}:example.org`;
		await db.insert(matrixLinks).values({ userId: nutzer.id, matrixUserId });

		expect(await nutzerZuMatrixId(matrixUserId)).toEqual({
			userId: nutzer.id,
			householdId: haushalt.id,
			displayName: 'Links-Test'
		});
	});

	// Der Kern von Schicht 3: OBWOHL die Matrix-Verknüpfung noch existiert (Schicht 1/2
	// haben in diesem (konstruierten) Fall versagt oder wurden übersprungen), löst
	// nutzerZuMatrixId() strukturell ins Leere, sobald die Mitgliedschaft fehlt — der
	// JOIN liefert dann schlicht keine Zeile. users.household_id bleibt dabei
	// unangetastet auf dem alten Wert stehen (genau das Feld, das vorher gelesen wurde
	// und den Bug ausmachte) und wird bewusst NICHT geprüft: die Absicherung soll
	// funktionieren, ohne dass sich irgendjemand je wieder auf diese Spalte verlassen
	// müsste.
	it('liefert null, sobald die Mitgliedschaft fehlt — auch wenn die Matrix-Verknüpfung noch da ist', async () => {
		const matrixUserId = `@${TAG}:example.org`;
		await db.delete(householdMembers).where(eq(householdMembers.userId, userId!));

		expect(await nutzerZuMatrixId(matrixUserId)).toBeNull();

		const linkNochDa = await db.select().from(matrixLinks).where(eq(matrixLinks.matrixUserId, matrixUserId));
		expect(linkNochDa).toHaveLength(1);
	});
});
