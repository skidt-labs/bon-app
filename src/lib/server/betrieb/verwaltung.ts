import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	households,
	householdMembers,
	users,
	receipts,
	einladungen,
	instanz
} from '$lib/server/db/schema';

/**
 * Die Betriebsseite arbeitet mit ZAEHLERSTAENDEN, nie mit Inhalten.
 *
 * Dass ein Haushalt 340 Bons hat, muss der Betreiber wissen duerfen — was darauf steht,
 * geht ihn nichts an. Keine Funktion in dieser Datei liest Positionen, Betraege,
 * Haendler, Produkte oder Toepfe, und keine benutzt `sichtbareBons`/`sichtbareToepfe`:
 * die beantworten die Frage „was darf ICH sehen", und hier wird sie gar nicht gestellt.
 */

const STANDARD_LAUFZEIT_TAGE = 7;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export type HaushaltsZeile = {
	id: string;
	name: string;
	mitglieder: number;
	bons: number;
	angelegtAm: Date;
};

export async function haushalteUebersicht(): Promise<HaushaltsZeile[]> {
	// Zwei Unterabfragen statt zweier Verbunde: ein Verbund ueber beide zaehlte das
	// Kreuzprodukt (drei Mitglieder mal zehn Bons ergaeben dreissig).
	return db
		.select({
			id: households.id,
			name: households.name,
			mitglieder: sql<number>`(select count(*)::int from ${householdMembers} where ${householdMembers.householdId} = ${households.id})`,
			bons: sql<number>`(select count(*)::int from ${receipts} where ${receipts.householdId} = ${households.id})`,
			angelegtAm: households.createdAt
		})
		.from(households)
		.orderBy(desc(households.createdAt));
}

export type NutzerZeile = {
	id: string;
	displayName: string;
	email: string;
	gesperrtAm: Date | null;
	haushalt: string | null;
};

export async function nutzerUebersicht(): Promise<NutzerZeile[]> {
	return db
		.select({
			id: users.id,
			displayName: users.displayName,
			email: users.email,
			gesperrtAm: users.gesperrtAm,
			haushalt: households.name
		})
		.from(users)
		.leftJoin(householdMembers, eq(householdMembers.userId, users.id))
		.leftJoin(households, eq(households.id, householdMembers.householdId))
		.orderBy(desc(users.createdAt));
}

/**
 * Einen Haushalt anlegen und eine Einladung dafuer erzeugen — OHNE selbst beizutreten.
 *
 * Das ist die strukturelle Absicherung der ganzen Rolle: es gibt keine unsichtbare
 * Anwesenheit. Wer die Einladung einloest, wird erster Verwalter. Will der Betreiber
 * selbst hinein, muss er sie einloesen und steht danach in der Mitgliederliste wie jeder
 * andere — und sieht auch dann keine privaten Bons, weil die Sichtbarkeitsbedingung die
 * Rolle nicht kennt.
 *
 * `erstelltVon` bleibt darum leer: die Einladung gehoert dem Haushalt, nicht dem
 * Betreiber, und es gibt in diesem Haushalt noch niemanden, auf den sie zeigen koennte.
 */
export async function haushaltAnlegenMitEinladung(
	name: string,
	betreiberUserId: string,
	tage: number = STANDARD_LAUFZEIT_TAGE
): Promise<{ householdId: string; token: string; laeuftAbAm: Date }> {
	const token = randomBytes(32).toString('base64url');
	const laeuftAbAm = new Date(Date.now() + tage * 24 * 60 * 60 * 1000);
	return db.transaction(async (tx) => {
		const [h] = await tx
			.insert(households)
			.values({ name, slug: randomUUID() })
			.returning({ id: households.id });
		await tx.insert(einladungen).values({
			householdId: h.id,
			tokenHash: hashToken(token),
			rolle: 'verwalter',
			erstelltVon: betreiberUserId,
			laeuftAbAm
		});
		return { householdId: h.id, token, laeuftAbAm };
	});
}

export class HaushaltNichtLeer extends Error {}

/** Nur ein LEERER Haushalt laesst sich hier entfernen — aufraeumen muss jemand drinnen. */
export async function haushaltLoeschen(householdId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [[m], [b]] = await Promise.all([
			tx.select({ n: count() }).from(householdMembers).where(eq(householdMembers.householdId, householdId)),
			tx.select({ n: count() }).from(receipts).where(eq(receipts.householdId, householdId))
		]);
		if (m.n > 0 || b.n > 0) throw new HaushaltNichtLeer();
		await tx.delete(households).where(eq(households.id, householdId));
	});
}

export class SelbstSperrung extends Error {}

/**
 * Sperren ist eine ZUGANGSFRAGE, kein Datenverlust: Bons, Mitgliedschaften und Berichte
 * bleiben unveraendert. Fuer Datenverlust gibt es „Mitglied entfernen" mit seiner
 * eigenen, ausdruecklichen Warnung.
 *
 * Der Betreiber kann sich nicht selbst sperren — sonst kaeme niemand mehr an die
 * Betriebsseite, und der einzige Weg zurueck fuehrte ueber die Datenbank.
 */
export async function nutzerSperren(zielUserId: string, betreiberUserId: string): Promise<void> {
	if (zielUserId === betreiberUserId) throw new SelbstSperrung();
	await db.update(users).set({ gesperrtAm: new Date() }).where(eq(users.id, zielUserId));
}

export async function nutzerEntsperren(zielUserId: string): Promise<void> {
	await db.update(users).set({ gesperrtAm: null }).where(eq(users.id, zielUserId));
}

/** Die eine Zeile, mit Anlegen bei Bedarf — eine fehlende Zeile heisst „Vorgabe". */
export async function selbstbedienungLesen(): Promise<boolean> {
	const [zeile] = await db.select({ an: instanz.selbstbedienung }).from(instanz).where(eq(instanz.id, 1));
	return zeile?.an ?? true;
}

export async function selbstbedienungSetzen(an: boolean): Promise<void> {
	await db
		.insert(instanz)
		.values({ id: 1, selbstbedienung: an, geaendertAm: new Date() })
		.onConflictDoUpdate({
			target: instanz.id,
			set: { selbstbedienung: an, geaendertAm: new Date() }
		});
}

/** Nur fuer die Anzeige: wie viele offene Einladungen es insgesamt gibt. */
export async function offeneEinladungen(): Promise<number> {
	const [z] = await db
		.select({ n: count() })
		.from(einladungen)
		.where(and(isNull(einladungen.eingeloestAm), sql`${einladungen.laeuftAbAm} > now()`));
	return z.n;
}

/**
 * Fuers Betriebsprotokoll: der Anzeigename des Ziels ZUM ZEITPUNKT der Aktion, vor dem
 * Loeschen bzw. Sperren gelesen. Nur Name bzw. displayName — nichts sonst. Fehlt die
 * Zeile, null (der Aufrufer nimmt dann die ID).
 */
export async function haushaltsName(householdId: string): Promise<string | null> {
	const [z] = await db.select({ name: households.name }).from(households).where(eq(households.id, householdId));
	return z?.name ?? null;
}

export async function nutzerName(userId: string): Promise<string | null> {
	const [z] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
	return z?.name ?? null;
}
