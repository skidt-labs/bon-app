import { eq } from 'drizzle-orm';
import { db } from '../db';
import { matrixLinks, users, householdMembers } from '../db/schema';

/**
 * Die Zuordnung hängt am ABSENDER, nicht am Raum. Ein Direktchat kann später weitere
 * Mitglieder bekommen; eine Zuordnung über den Raum schriebe dann fremde Bilder dem
 * falschen Konto zu.
 *
 * Gibt `null` zurück, wenn das Matrix-Konto nicht gekoppelt ist. Ein Rückfall auf
 * irgendeinen Nutzer wäre ein Leck in fremde Kaufhistorie.
 *
 * Befund R02 (die eigentliche Absicherung, Schicht 3 von 3): der Haushalt kommt über
 * einen INNER JOIN auf `household_members`, NICHT über `users.household_id`. Ein
 * entferntes Mitglied behält seinen Nutzerdatensatz (geteilte Bons verweisen weiter
 * darauf, siehe mitgliedEntfernen()) samt dem darin stehengebliebenen
 * `household_id` — würde dieses Feld hier gelesen, löste der Matrix-Weg
 * weiterhin in den ALTEN Haushalt auf, selbst wenn irgendwo ein offener
 * Kopplungscode übersehen würde (Schicht 1/2, siehe einladungen.ts/pairing.ts).
 * Fehlt die Mitgliedschaft, liefert der JOIN gar keine Zeile — unabhängig davon,
 * ob die Matrix-Verknüpfung selbst noch existiert. `users.household_id` fällt in
 * Aufgabe 7 ohnehin weg; das hier nimmt das für diesen Pfad vorweg.
 */
export async function nutzerZuMatrixId(
	matrixUserId: string
): Promise<{ userId: string; householdId: string; displayName: string } | null> {
	const [zeile] = await db
		.select({
			userId: users.id,
			householdId: householdMembers.householdId,
			displayName: users.displayName
		})
		.from(matrixLinks)
		.innerJoin(users, eq(users.id, matrixLinks.userId))
		.innerJoin(householdMembers, eq(householdMembers.userId, users.id))
		.where(eq(matrixLinks.matrixUserId, matrixUserId));
	return zeile ?? null;
}

export async function verknuepfungFuerNutzer(
	userId: string
): Promise<{ matrixUserId: string; createdAt: Date } | null> {
	const [zeile] = await db
		.select({ matrixUserId: matrixLinks.matrixUserId, createdAt: matrixLinks.createdAt })
		.from(matrixLinks)
		.where(eq(matrixLinks.userId, userId));
	return zeile ?? null;
}

type Ausfuehrer = Pick<typeof db, 'delete'>;

/**
 * Bereits erfasste Bons bleiben unberührt — nur der Weg wird geschlossen.
 *
 * Nimmt den Ausfuehrer als Parameter (statt den globalen `db`-Import direkt zu
 * benutzen), damit `mitgliedEntfernen()` (haushalt/einladungen.ts) das Loesen der
 * Verknuepfung in DERSELBEN Transaktion mit dem Entfernen der Mitgliedschaft
 * zusammenfassen kann — ein entferntes Mitglied, das per Matrix weiter Bons in den
 * alten Haushalt einschleusen kann, waere sonst ein Loch neben dem eigentlichen
 * Entfernen.
 */
export async function verknuepfungLoesen(ausfuehrer: Ausfuehrer, userId: string): Promise<void> {
	await ausfuehrer.delete(matrixLinks).where(eq(matrixLinks.userId, userId));
}
