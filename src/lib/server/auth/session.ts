import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users, householdMembers } from '../db/schema';
import type { Rolle } from '$lib/server/haushalt/mitglieder';

export const SESSION_COOKIE = 'bon_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
	id: string;
	/** Der Anspruch des Identitaetsanbieters — daran haengt die Betreiberrolle. */
	oidcSub: string;
	email: string;
	displayName: string;
	householdId: string;
	rolle: Rolle;
};

export function generateSessionId(): string {
	return randomBytes(32).toString('base64url');
}

export function isExpired(expiresAt: Date): boolean {
	return expiresAt.getTime() <= Date.now();
}

export async function createSession(userId: string) {
	const id = generateSessionId();
	const expiresAt = new Date(Date.now() + TTL_MS);
	await db.insert(sessions).values({ id, userId, expiresAt });
	return { id, expiresAt };
}

export async function validateSession(sessionId: string): Promise<SessionUser | null> {
	// Der Haushalt kommt aus household_members, nicht mehr aus users.householdId: die
	// Mitgliedschaft ist jetzt die Wahrheit ueber Zugehoerigkeit UND Rolle. Ein Nutzer
	// ohne Mitgliedschaft bekommt hier null — also keine Sitzung. Das ist richtig: ohne
	// Haushalt gibt es nichts zu sehen.
	const [row] = await db
		.select({
			expiresAt: sessions.expiresAt,
			id: users.id,
			oidcSub: users.oidcSub,
			gesperrtAm: users.gesperrtAm,
			email: users.email,
			displayName: users.displayName,
			householdId: householdMembers.householdId,
			rolle: householdMembers.rolle
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.innerJoin(householdMembers, eq(householdMembers.userId, users.id))
		.where(eq(sessions.id, sessionId));

	if (!row) return null;
	if (isExpired(row.expiresAt)) {
		await db.delete(sessions).where(eq(sessions.id, sessionId));
		return null;
	}
	// Gesperrt heisst SOFORT ungueltig, nicht erst nach den 30 Tagen der Sitzung. Die
	// Sitzungszeile bleibt stehen: das Sperren ist zuruecknehmbar, und dann soll die
	// bestehende Anmeldung einfach wieder gelten.
	if (row.gesperrtAm !== null) return null;
	return {
		id: row.id,
		oidcSub: row.oidcSub,
		email: row.email,
		displayName: row.displayName,
		householdId: row.householdId,
		rolle: row.rolle
	};
}

export async function deleteSession(sessionId: string) {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}
