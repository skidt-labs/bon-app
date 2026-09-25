import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { db } from './db';
import { households, users, householdMembers, receipts } from './db/schema';

export function haushaltsname(anzeigename: string): string {
	const n = anzeigename.trim();
	if (!n || n === 'Unbekannt') return 'Mein Haushalt';
	return `Haushalt ${n}`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Nur den Haushalt anlegen — der gemeinsame erste Schritt von `erstanmeldungAnlegen()`
 * (neuer Nutzer) und `mitgliedschaftWiederherstellen()` (bestehender Nutzer ohne
 * Mitgliedschaft). Der Slug ist ein Zufallswert, siehe Kommentar an
 * `erstanmeldungAnlegen()`.
 */
async function neuerHaushalt(tx: Tx, anzeigename: string): Promise<{ id: string }> {
	const [h] = await tx
		.insert(households)
		.values({ name: haushaltsname(anzeigename), slug: randomUUID() })
		.returning({ id: households.id });
	return h;
}

/**
 * Eine Erstanmeldung vollstaendig anlegen: eigener Haushalt, Nutzer, Mitgliedschaft.
 *
 * Bis 18.09.2026 landete jeder Anmelder im selben Haushalt 'default'. Das war Absicht —
 * solange es genau einen Haushalt gab. Sobald sich ein Zweiter anmelden kann, ist es ein
 * Datenriss: er saehe sofort alle fremden Bons, und niemand bekaeme davon etwas mit.
 *
 * Die drei Einfuegungen MUESSEN in dieser Reihenfolge und in EINER Transaktion laufen:
 * `users.household_id` ist NOT NULL (der Haushalt muss also zuerst da sein), und
 * `household_members.user_id` zeigt auf den Nutzer (der also vor der Mitgliedschaft da
 * sein muss). Bricht ein Schritt weg, koennte sich der Nutzer nie anmelden —
 * validateSession braucht die Mitgliedschaft.
 *
 * Der Slug ist ein Zufallswert. Er hatte genau eine Aufgabe, den Upsert auf 'default',
 * und hat nach dieser Aenderung keine mehr; die Spalte ist aber `not null unique` mit
 * Vorgabe 'default' — der ZWEITE Haushalt ohne ausdruecklichen Slug scheiterte sonst an
 * der Eindeutigkeit, und zwar mit einem Datenbankfehler statt einer Meldung. Die Spalte
 * ganz zu entfernen gehoert zu Aufgabe 7.
 */
export async function erstanmeldungAnlegen(profile: {
	sub: string;
	email: string;
	name: string;
}): Promise<{ userId: string; householdId: string }> {
	return db.transaction(async (tx) => {
		const h = await neuerHaushalt(tx, profile.name);
		const [u] = await tx
			.insert(users)
			.values({
				oidcSub: profile.sub,
				email: profile.email,
				displayName: profile.name
			})
			.returning({ id: users.id });
		await tx.insert(householdMembers).values({
			householdId: h.id,
			userId: u.id,
			rolle: 'verwalter'
		});
		return { userId: u.id, householdId: h.id };
	});
}

/**
 * Ein BESTEHENDER Nutzer ohne Mitgliedschaft bekommt einen eigenen, leeren Haushalt und
 * wird dessen Verwalter — dieselbe Behandlung wie bei einer Erstanmeldung, nur ohne den
 * Nutzer-Datensatz neu anzulegen (er ist ja schon da).
 *
 * Review-Befund Fix-Runde 2 (Aufgabe 4): `mitgliedEntfernen()` entfernt die
 * Mitgliedschaft, laesst den Nutzer aber bewusst bestehen (geteilte Bons verweisen
 * weiter auf ihn). `validateSession()` liefert ohne Mitgliedschaft aber keine Sitzung —
 * der Callback fand den Nutzer trotzdem ueber `oidc_sub`, legte eine Sitzung an, und
 * jede folgende Seite warf ihn wegen der fehlenden Mitgliedschaft sofort zurueck zur
 * Anmeldung. Dauerhaft im Kreis, und ohne gueltige Sitzung liess sich auch keine neue
 * Einladung mehr annehmen (die setzt eine an). Diese Funktion macht den Nutzer wieder
 * handlungsfaehig, GENAU wie das eigene Kommentar an `erstanmeldungAnlegen()` es fuer
 * die Erstanmeldung schon verlangt — nur fuer den Fall, dass der Nutzer nicht neu,
 * sondern nur ohne Zuhause ist.
 *
 * `users.household_id` wird mitgezogen: solange die Spalte lebt (bis Aufgabe 7), muss
 * sie denselben Haushalt zeigen wie die neue Mitgliedschaft — aus demselben Grund wie
 * in `einladungEinloesen()` (siehe dort): ein FOR-UPDATE-Schutz ist hier nicht noetig,
 * die Eindeutigkeit von `household_members.user_id` (UNIQUE) macht aus einem
 * gleichzeitigen zweiten Aufruf einen Datenbankfehler statt einer zweiten,
 * verwaisten Mitgliedschaft.
 */
export async function mitgliedschaftWiederherstellen(
	userId: string,
	anzeigename: string
): Promise<{ householdId: string }> {
	return db.transaction(async (tx) => {
		const h = await neuerHaushalt(tx, anzeigename);
		await tx.insert(householdMembers).values({ householdId: h.id, userId, rolle: 'verwalter' });
		return { householdId: h.id };
	});
}

/**
 * Die Mitglieder eines Haushalts mit der Zahl ihrer erfassten Bons — fuer die
 * Haushalts-Uebersicht.
 *
 * Filtert bewusst ueber `household_members`, nicht mehr wie vor Aufgabe 3 ueber
 * `eq(users.household_id, …)`. Das ist kein Stilwechsel, sondern ein Wechsel der
 * Quelle der Wahrheit: seit Aufgabe 1 ist `household_members` die Wahrheit ueber
 * Zugehoerigkeit UND Rolle, `users.household_id` ist seither nur noch ein Rest aus der
 * Zeit davor und faellt in Aufgabe 7 ganz weg. Heute liefern beide Spalten fuer jeden
 * Nutzer denselben Haushalt (Backfill aus Aufgabe 1/2) — aendert sich das je einmal,
 * ist `household_members` die Spalte, der zu glauben ist.
 */
export async function mitgliederMitZaehlung(householdId: string) {
	return db
		.select({
			id: users.id,
			displayName: users.displayName,
			email: users.email,
			erfasst: count(receipts.id)
		})
		.from(users)
		.leftJoin(householdMembers, eq(householdMembers.userId, users.id))
		.leftJoin(receipts, eq(receipts.uploadedBy, users.id))
		.where(eq(householdMembers.householdId, householdId))
		.groupBy(users.id);
}
