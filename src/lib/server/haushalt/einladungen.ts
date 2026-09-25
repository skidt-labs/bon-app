import { randomBytes, createHash } from 'node:crypto';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import {
	einladungen,
	households,
	users,
	householdMembers,
	receipts,
	budgets,
	budgetKategorien,
	products,
	matrixPairingCodes
} from '../db/schema';
import type { Zugriffskontext } from '../zugriff/kontext';
import type { Rolle } from './mitglieder';
import { verknuepfungLoesen } from '../matrix/links';
import { loescheBilder } from '../storage/images';

/** 7 Tage. Lang genug, um einen Link ueber einen Chat weiterzugeben, kurz genug, dass
 *  ein liegengelassener Link nicht auf ewig gueltig bleibt. */
export const STANDARD_LAUFZEIT_TAGE = 7;

/**
 * Traegt den Einladungs-Token durch den OIDC-Umweg: `/einladung/[token]` setzt dieses
 * Cookie, wenn niemand angemeldet ist, und `auth/callback` liest es nach der Anmeldung
 * wieder aus, um zur Einladung zurueckzuleiten — genau wie `oidc_verifier`/`oidc_state`
 * (siehe auth/login und auth/callback), nur mit laengerer Gueltigkeit: der Weg ueber
 * die Anmeldestelle dauert laenger als ein Code-Tausch.
 */
export const EINLADUNG_TOKEN_COOKIE = 'einladung_token';
export const EINLADUNG_COOKIE_TTL_S = 10 * 60;

/** Wird geworfen, wenn eine Aenderung den letzten Verwalter herabstufen oder entfernen wuerde. */
export class LetzterVerwalter extends Error {
	constructor() {
		super('Der letzte Verwalter kann weder herabgestuft noch entfernt werden.');
		this.name = 'LetzterVerwalter';
	}
}

/** Wird geworfen, wenn das Ziel-Mitglied nicht (mehr) zum Haushalt aus dem Kontext gehoert. */
export class MitgliedNichtGefunden extends Error {
	constructor() {
		super('Dieses Mitglied gehört nicht zu deinem Haushalt.');
		this.name = 'MitgliedNichtGefunden';
	}
}

/**
 * Jede Tabelle mit einer household_id-Spalte, aufgeteilt danach, wie einladungEinloesen
 * sie behandelt. Bewacht von einladungen.db.test.ts ("Vollstaendigkeit der
 * Leerheits-Pruefung") per information_schema — kommt in Aufgabe 5/6 eine neue
 * haushaltsbezogene Tabelle dazu, OHNE dass sie hier UND unten in der Zaehlung
 * beruecksichtigt wird, schlaegt dieser Test fehl. Fix-Runde 1 (Review): `products`
 * fehlte, ein Haushalt mit gewachsenem Produktkatalog aber sonst leer galt faelschlich
 * als leer und waere geloescht worden.
 */
export const HAUSHALT_TABELLEN_GEZAEHLT = [
	'budget_kategorien',
	'budgets',
	'household_members',
	'products',
	'receipts'
] as const;

/**
 * Tabellen mit household_id, die BEWUSST NICHT gezaehlt werden — mit Begruendung, damit
 * das eine Entscheidung bleibt und keine Luecke.
 */
export const HAUSHALT_TABELLEN_AUSGENOMMEN: Record<string, string> = {
	einladungen:
		'Kaskadiert beim Loeschen des Haushalts automatisch weg (onDelete: cascade) — ' +
		'eine offene, nie eingeloeste Einladung ist kein Datum, dessen Verlust zaehlt.'
};

/**
 * Nur der Hash wird gespeichert (siehe schema.ts). Normalisiert wird nichts — anders
 * als beim Matrix-Kopplungscode tippt hier niemand von Hand ab, der Token kommt per
 * Link.
 */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function istEinloesbar(
	e: { laeuftAbAm: Date; eingeloestAm: Date | null },
	jetzt = new Date()
): 'ok' | 'abgelaufen' | 'verbraucht' {
	if (e.eingeloestAm) return 'verbraucht';
	if (e.laeuftAbAm.getTime() <= jetzt.getTime()) return 'abgelaufen';
	return 'ok';
}

/**
 * Der letzte Verwalter darf nicht gehen und sich nicht herabstufen. Sonst stuende ein
 * Haushalt ohne Verwalter da — niemand koennte ihn je wieder oeffnen, und es gaebe
 * keinen Weg zurueck ausser an der Datenbank vorbei.
 */
export function letzterVerwalter(
	mitglieder: { userId: string; rolle: Rolle }[],
	userId: string
): boolean {
	const verwalter = mitglieder.filter((m) => m.rolle === 'verwalter');
	return verwalter.length === 1 && verwalter[0].userId === userId;
}

/**
 * Einen Einmal-Link fuer den Beitritt zu `k.haushaltId` erzeugen. Der Klartext verlaesst
 * diese Funktion genau einmal und wird nirgends gespeichert — nur sein SHA-256-Hash
 * landet in der Datenbank (siehe schema.ts).
 */
export async function einladungErzeugen(
	k: Zugriffskontext,
	rolle: Rolle,
	tage: number = STANDARD_LAUFZEIT_TAGE
): Promise<{ token: string; laeuftAbAm: Date }> {
	const token = randomBytes(32).toString('base64url');
	const laeuftAbAm = new Date(Date.now() + tage * 24 * 60 * 60 * 1000);
	await db.insert(einladungen).values({
		householdId: k.haushaltId,
		tokenHash: hashToken(token),
		rolle,
		erstelltVon: k.nutzerId,
		laeuftAbAm
	});
	return { token, laeuftAbAm };
}

/**
 * Was `/einladung/[token]` anzeigt, BEVOR ein Mensch bestaetigt. Entwertet nichts —
 * eine Linkvorschau (Matrix, WhatsApp, Mailclient) ruft eine URL auf, sobald sie in
 * einem Chat auftaucht, lange bevor ein Mensch sie sieht. Wuerde diese Funktion schon
 * entwerten, waere die Einladung tot, bevor der eingeladene Mensch sie ueberhaupt
 * geoeffnet hat. Entwertet wird ausschliesslich in einladungEinloesen.
 *
 * Liefert `null` sowohl fuer einen unbekannten als auch fuer einen nicht mehr
 * einloesbaren Token — der Unterschied ist fuer die Anzeige vor dem Einloesen ohne
 * Belang, und eine eigene Meldung fuer "unbekannt" wuerde nur verraten, dass geraten
 * wurde.
 */
export async function einladungPruefen(
	token: string
): Promise<{ householdId: string; haushaltsname: string; rolle: Rolle } | null> {
	const [zeile] = await db
		.select({
			householdId: einladungen.householdId,
			rolle: einladungen.rolle,
			laeuftAbAm: einladungen.laeuftAbAm,
			eingeloestAm: einladungen.eingeloestAm,
			haushaltsname: households.name
		})
		.from(einladungen)
		.innerJoin(households, eq(households.id, einladungen.householdId))
		.where(eq(einladungen.tokenHash, hashToken(token)));

	if (!zeile || istEinloesbar(zeile, new Date()) !== 'ok') return null;
	return { householdId: zeile.householdId, haushaltsname: zeile.haushaltsname, rolle: zeile.rolle };
}

/**
 * Eine Einladung einloesen: der Nutzer verlaesst seinen bisherigen Haushalt und wird
 * Mitglied des Haushalts hinter dem Token.
 *
 * Laeuft in EINER Transaktion, in dieser Reihenfolge:
 *   1. Die Einladungszeile per FOR UPDATE sperren — ein zweiter, fast gleichzeitiger
 *      Klick auf denselben Link wartet hier auf den Commit dieser Transaktion und
 *      sieht danach `eingeloest_am` gesetzt, statt beide Klicks durch dieselbe Pruefung
 *      kommen und die Mitgliedschaft zweimal umhaengen zu lassen.
 *   2. `istEinloesbar` pruefen.
 *   3. Den ALTEN Haushalt des Einloesenden bewerten: hat er noch Bons, Toepfe oder
 *      WEITERE Mitglieder, aendert diese Funktion NICHTS und meldet
 *      'haushalt-nicht-leer' — lieber eine klare Absage als ein stiller Datenverlust.
 *      Das deckt nebenbei die Letzter-Verwalter-Regel fuer GENAU DIESEN Weg mit ab, ganz
 *      ohne eigene Rollen-Abfrage: haette der alte Haushalt noch ein weiteres Mitglied,
 *      waere ER es, der nach diesem Auszug ohne Verwalter dastuende, liesse man den
 *      Auszug zu — 'haushalt-nicht-leer' verhindert genau das. Nur wenn der Einloesende
 *      der EINZIGE Bewohner ist (der Normalfall: frisch angemeldet, eigener leerer
 *      Haushalt, dann eingeladen), loest sich der alte Haushalt komplett auf, und die
 *      Frage "wer verwaltet ihn danach" stellt sich nicht mehr.
 *   4. Mitgliedschaft umhaengen und den alten Haushalt loeschen.
 *   5. Einladung entwerten.
 *
 * Ein unbekannter Token bekommt dieselbe Antwort wie ein abgelaufener ('abgelaufen'):
 * beides heisst fuer den Aufrufer "besorg dir eine neue Einladung", eine eigene Meldung
 * fuer "unbekannt" wuerde nur verraten, dass geraten wurde.
 */
export async function einladungEinloesen(
	token: string,
	userId: string
): Promise<'ok' | 'abgelaufen' | 'verbraucht' | 'haushalt-nicht-leer'> {
	const jetzt = new Date();
	return db.transaction(async (tx) => {
		const [zeile] = await tx
			.select()
			.from(einladungen)
			.where(eq(einladungen.tokenHash, hashToken(token)))
			.for('update');
		if (!zeile) return 'abgelaufen';

		const stand = istEinloesbar(zeile, jetzt);
		if (stand !== 'ok') return stand;

		const [alt] = await tx
			.select({ householdId: householdMembers.householdId })
			.from(householdMembers)
			.where(eq(householdMembers.userId, userId));
		// Kann laut validateSession nicht vorkommen (jeder angemeldete Nutzer hat eine
		// Mitgliedschaft) — trotzdem kein stiller Rueckfall, sondern ein lauter Fehler.
		if (!alt) throw new Error(`Nutzer ${userId} hat keine Mitgliedschaft — kann keine Einladung einloesen`);
		const altesHaushaltId = alt.householdId;

		const [{ n: weitereMitglieder }] = await tx
			.select({ n: count() })
			.from(householdMembers)
			.where(and(eq(householdMembers.householdId, altesHaushaltId), ne(householdMembers.userId, userId)));
		const [{ n: bons }] = await tx
			.select({ n: count() })
			.from(receipts)
			// ABSICHTLICH ohne sichtbareBons(): hier wird gezaehlt, ob der Haushalt LEER ist,
			// nicht, was der Anfragende sehen darf. Ein privater Bon eines anderen Mitglieds
			// macht den Haushalt genauso wenig leer wie ein geteilter — wuerde er hier
			// uebersehen, loeschte das Einloesen einer Einladung fremde Daten mit.
			.where(eq(receipts.householdId, altesHaushaltId));
		const [{ n: toepfe }] = await tx
			.select({ n: count() })
			.from(budgets)
			.where(eq(budgets.householdId, altesHaushaltId));
		const [{ n: topfKategorien }] = await tx
			.select({ n: count() })
			.from(budgetKategorien)
			.where(eq(budgetKategorien.householdId, altesHaushaltId));
		// Review-Befund Fix-Runde 1: fehlte hier. Ein Haushalt mit null Bons, null
		// Toepfen, null weiteren Mitgliedern, aber einem gewachsenen Produktkatalog
		// (products.household_id, onDelete cascade) galt als "leer" und haette den
		// Katalog beim Loeschen des Haushalts stillschweigend mitgerissen.
		const [{ n: produkte }] = await tx
			.select({ n: count() })
			.from(products)
			.where(eq(products.householdId, altesHaushaltId));

		if (weitereMitglieder > 0 || bons > 0 || toepfe > 0 || topfKategorien > 0 || produkte > 0) {
			return 'haushalt-nicht-leer';
		}

		// Beide Spalten umhaengen: household_members UND das (bis Aufgabe 7 noch
		// lebende) users.household_id. Nicht nur der in household.ts dokumentierten
		// Deckungsgleichheit wegen — ohne dieses Update zeigte users.household_id
		// weiter auf den alten Haushalt, und dessen Fremdschluessel (NOT NULL, kein ON
		// DELETE) liesse die Loeschung gleich darunter mit einem Datenbankfehler
		// scheitern.
		await tx
			.update(householdMembers)
			.set({ householdId: zeile.householdId, rolle: zeile.rolle })
			.where(eq(householdMembers.userId, userId));

		// Der alte Haushalt ist jetzt leer — die letzte Referenz war die eben umgehaengte
		// Mitgliedschaft.
		await tx.delete(households).where(eq(households.id, altesHaushaltId));

		await tx
			.update(einladungen)
			.set({ eingeloestAm: jetzt, eingeloestVon: userId })
			.where(eq(einladungen.id, zeile.id));

		return 'ok';
	});
}

/**
 * Die Rolle eines Mitglieds im eigenen Haushalt aendern. Scoped auf `k.haushaltId`:
 * `zielUserId` muss im selben Haushalt sein wie der Aufrufer, sonst wirft die Funktion
 * `MitgliedNichtGefunden` statt eine Aenderung vorzutaeuschen, die nicht stattfand.
 *
 * Lesen (Letzter-Verwalter-Pruefung), Pruefen und Schreiben laufen in EINER Transaktion
 * mit `FOR UPDATE` auf allen Mitgliedszeilen des Haushalts. Review-Befund Fix-Runde 1:
 * ohne die Sperre koennten zwei Verwalter, die sich GLEICHZEITIG gegenseitig herabstufen,
 * beide auf demselben (in diesem Moment noch gueltigen) "es gibt ja noch einen zweiten"
 * lesen und beide schreiben — der Haushalt stuende danach ohne Verwalter da, genau der
 * Zustand, den letzterVerwalter() verhindern soll. Mit der Sperre serialisiert Postgres
 * die beiden Versuche: der zweite liest nach dem Commit des ersten neu und sieht dann
 * korrekt "ich bin der letzte".
 */
export async function rolleSetzen(k: Zugriffskontext, zielUserId: string, rolle: Rolle): Promise<void> {
	await db.transaction(async (tx) => {
		const mitglieder = await tx
			.select({ userId: householdMembers.userId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.householdId, k.haushaltId))
			.for('update');

		if (rolle !== 'verwalter' && letzterVerwalter(mitglieder, zielUserId)) throw new LetzterVerwalter();

		const [betroffen] = await tx
			.update(householdMembers)
			.set({ rolle })
			.where(and(eq(householdMembers.userId, zielUserId), eq(householdMembers.householdId, k.haushaltId)))
			.returning({ id: householdMembers.id });
		if (!betroffen) throw new MitgliedNichtGefunden();
	});
}

/**
 * Ein Mitglied aus dem eigenen Haushalt entfernen.
 *
 * Macht heute DREI Dinge: offene Matrix-Kopplungscodes des Mitglieds loeschen, die
 * bestehende Matrix-Verknuepfung loesen und die Mitgliedschaft entfernen. Der
 * urspruengliche Plan sah dazwischen zwei weitere Schritte vor —
 * private Bons und private Toepfe des Mitglieds loeschen —, aber "privat" ist erst ab
 * Aufgabe 5/6 ueberhaupt eine Spalte (`sichtbarkeit`/`eigentuemer_id`). Ohne sie waere
 * jede Loeschung hier eine Vermutung darueber, was privat heisst, mit dem Risiko,
 * GETEILTE Daten des Haushalts zu loeschen. Sobald Aufgabe 5 die Spalten hat, gehoeren
 * die beiden Loeschungen GENAU HIER hin, vor dem Entfernen der Mitgliedschaft.
 *
 * Review-Befund Fix-Runde 2: die Matrix-Verknuepfung wurde vorher NICHT geloest — ein
 * entferntes Mitglied konnte per Matrix weiter Bons in den alten Haushalt einschleusen,
 * weil `nutzerZuMatrixId()` ueber `users.household_id` aufloest, das hier unveraendert
 * blieb. `verknuepfungLoesen()` uebernimmt keine Bons, sie schliesst nur den Weg (siehe
 * dort) — genau das soll hier zusaetzlich zur Mitgliedschaft passieren, nicht mehr.
 *
 * Befund R02 (Fix-Runde 3, Schicht 1 von 3): Fix-Runde 2 hat einen Weg offen gelassen —
 * ein Mitglied, das sich VOR seinem Ausschluss einen Matrix-Kopplungscode erzeugt hat
 * (`codeAnlegen()`, 10 Minuten gueltig), konnte sich damit NACH `mitgliedEntfernen()`
 * innerhalb der Gueltigkeit erneut koppeln. Deshalb werden hier zusaetzlich die NOCH
 * NICHT eingeloesten Codes des Betroffenen geloescht — in DERSELBEN Transaktion wie
 * Mitgliedschaft und Verknuepfung, sonst koennte ein Code genau in der Luecke
 * dazwischen noch eingeloest werden. Nur `usedAt IS NULL`: ein bereits verbrauchter
 * Code ist ohnehin nicht erneut einloesbar (siehe pairing.ts) und kein Datum, dessen
 * Verlust zaehlt. Schicht 2 (`codeEinloesen()` prueft Mitgliedschaft) und Schicht 3
 * (`nutzerZuMatrixId()` loest ueber `household_members` auf) sichern denselben Weg
 * zusaetzlich ab, falls ein Code hier trotzdem uebersehen wuerde.
 *
 * Der Nutzerdatensatz bleibt in jedem Fall bestehen: geteilte Bons verweisen ueber
 * `uploaded_by` und `confirmed_by` weiter auf ihn. `users.household_id` bleibt bewusst
 * auf dem alten Haushalt stehen, bis sich der Nutzer neu anmeldet — dann greift
 * `mitgliedschaftWiederherstellen()` in auth/callback (siehe household.ts) und setzt
 * einen frischen, eigenen Haushalt.
 *
 * Lesen, Pruefen und Schreiben laufen in EINER Transaktion mit `FOR UPDATE` auf allen
 * Mitgliedszeilen des Haushalts — derselbe Wettlauf und derselbe Schutz wie in
 * rolleSetzen (siehe dort): zwei Verwalter, die sich gleichzeitig gegenseitig entfernen,
 * duerfen sich nicht beide auf denselben veralteten Stand verlassen koennen. Scoped auf
 * `k.haushaltId`: `zielUserId` muss im selben Haushalt sein, sonst wirft die Funktion
 * `MitgliedNichtGefunden` statt ein Entfernen vorzutaeuschen, das nicht stattfand.
 */
export async function mitgliedEntfernen(k: Zugriffskontext, zielUserId: string): Promise<void> {
	let bilder: string[] = [];
	await db.transaction(async (tx) => {
		const mitglieder = await tx
			.select({ userId: householdMembers.userId, rolle: householdMembers.rolle })
			.from(householdMembers)
			.where(eq(householdMembers.householdId, k.haushaltId))
			.for('update');
		if (letzterVerwalter(mitglieder, zielUserId)) throw new LetzterVerwalter();

		/*
		 * Privates geht mit dem Menschen, Geteiltes bleibt beim Haushalt.
		 *
		 * Die privaten Bons des Ausscheidenden koennte sonst niemand mehr sehen — er
		 * selbst nicht (keine Mitgliedschaft) und sonst auch keiner (privat). Sie laegen
		 * unerreichbar in der Datenbank und in Berichten, die niemand aufrufen kann.
		 * `receipt_items` haengt per Kaskade dran, `budget_betraege` und
		 * `budget_kategorien` ebenso am Topf.
		 *
		 * Die BILDER werden hier nur eingesammelt, nicht geloescht: ein Rollback holt eine
		 * geloeschte Datei nicht zurueck. Entfernt werden sie nach dem Commit.
		 */
		const privateBons = await tx
			.delete(receipts)
			.where(
				and(
					eq(receipts.householdId, k.haushaltId),
					eq(receipts.uploadedBy, zielUserId),
					eq(receipts.sichtbarkeit, 'privat')
				)
			)
			.returning({ imagePath: receipts.imagePath, thumbPath: receipts.thumbPath });
		bilder = privateBons.flatMap((b) => [b.imagePath, b.thumbPath]);

		await tx
			.delete(budgets)
			.where(
				and(
					eq(budgets.householdId, k.haushaltId),
					eq(budgets.eigentuemerId, zielUserId),
					eq(budgets.sichtbarkeit, 'privat')
				)
			);

		const [betroffen] = await tx
			.delete(householdMembers)
			.where(and(eq(householdMembers.userId, zielUserId), eq(householdMembers.householdId, k.haushaltId)))
			.returning({ id: householdMembers.id });
		if (!betroffen) throw new MitgliedNichtGefunden();

		// NACH der Mitgliedschaft: eine geworfene MitgliedNichtGefunden soll weder die
		// Verknuepfung loesen noch Codes loeschen, wenn ohnehin nichts entfernt wurde.
		// Befund R02, Schicht 1: offene Codes VOR der Verknuepfung raeumen — beides in
		// derselben Transaktion, die Reihenfolge der beiden untereinander ist ohne
		// Belang.
		await tx
			.delete(matrixPairingCodes)
			.where(and(eq(matrixPairingCodes.userId, zielUserId), isNull(matrixPairingCodes.usedAt)));
		await verknuepfungLoesen(tx, zielUserId);
	});
	// Erst jetzt, nach dem Commit: siehe Kommentar oben.
	await loescheBilder(bilder);
}

/**
 * Was ein Entfernen kosten wuerde — fuer den Dialog, VOR dem Klick.
 *
 * "Mitglied entfernen" loescht dessen private Bons und Toepfe unwiderruflich. Das
 * ungefragt zu tun waere falsch; es ungefragt zu VERSCHWEIGEN auch. Darum nennt der
 * Dialog die Zahlen, und diese Funktion liefert sie.
 */
export async function entfernenVorschau(
	k: Zugriffskontext,
	zielUserId: string
): Promise<{ privateBons: number; privateToepfe: number }> {
	const [[bons], [toepfe]] = await Promise.all([
		db
			.select({ n: count() })
			.from(receipts)
			.where(
				and(
					eq(receipts.householdId, k.haushaltId),
					eq(receipts.uploadedBy, zielUserId),
					eq(receipts.sichtbarkeit, 'privat')
				)
			),
		db
			.select({ n: count() })
			.from(budgets)
			.where(
				and(
					eq(budgets.householdId, k.haushaltId),
					eq(budgets.eigentuemerId, zielUserId),
					eq(budgets.sichtbarkeit, 'privat')
				)
			)
	]);
	return { privateBons: bons.n, privateToepfe: toepfe.n };
}
