import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { householdMembers, rolle } from '$lib/server/db/schema';

/**
 * ABGELEITET aus dem Datenbank-Enum, nicht daneben geschrieben.
 *
 * Bis 18.09.2026 stand dieselbe Aussage zweimal da — einmal als pgEnum in schema.ts,
 * einmal als Union hier. Zwei Wahrheiten ueber dieselbe Frage halten genau so lange,
 * bis jemand eine davon aendert; danach faellt es beim naechsten Migrationslauf auf,
 * nicht beim Tippen.
 */
export type Rolle = (typeof rolle.enumValues)[number];
export type Mitgliedschaft = { householdId: string; rolle: Rolle };

/** Getrennt von der Abfrage, damit die Regel ohne Datenbank pruefbar ist. */
export function mitgliedschaftAusZeilen(zeilen: Mitgliedschaft[]): Mitgliedschaft | null {
	if (zeilen.length === 0) return null;
	if (zeilen.length > 1) {
		throw new Error(
			`Nutzer hat mehrere Mitgliedschaften (${zeilen.length}) — welcher Haushalt gemeint ist, ist nicht entscheidbar`
		);
	}
	return zeilen[0];
}

export async function mitgliedschaftLaden(userId: string): Promise<Mitgliedschaft | null> {
	const zeilen = await db
		.select({ householdId: householdMembers.householdId, rolle: householdMembers.rolle })
		.from(householdMembers)
		.where(eq(householdMembers.userId, userId));
	return mitgliedschaftAusZeilen(zeilen);
}

export type Mitglied = { userId: string; rolle: Rolle };

/**
 * Alle Mitglieder eines Haushalts mit ihrer Rolle — die Grundlage der
 * Letzter-Verwalter-Pruefung in haushalt/einladungen.ts (rolleSetzen, mitgliedEntfernen,
 * einladungEinloesen). Ohne den vollstaendigen Bestand liesse sich nicht entscheiden, ob
 * ein bestimmtes Mitglied der EINZIGE Verwalter ist.
 */
export async function mitgliederEinesHaushalts(haushaltId: string): Promise<Mitglied[]> {
	return db
		.select({ userId: householdMembers.userId, rolle: householdMembers.rolle })
		.from(householdMembers)
		.where(eq(householdMembers.householdId, haushaltId));
}
