import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { db as Db } from '$lib/server/db';
import { budgets, budgetBetraege, budgetKategorien, categories, receipts, receiptItems } from '$lib/server/db/schema';
import { budgetsFuerMonat } from './aufloesung';
import { sichtbareBons, sichtbareToepfe } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Anlegen, umbenennen, Betrag festlegen, Kategorien zuordnen und loesen, loeschen.
 *
 * Alles, was mit Zeit zu tun hat, rechnet auf Datums-ZEICHENKETTEN — siehe
 * aufloesung.ts: ein „gilt ab" ist ein Datum, kein Zeitpunkt.
 */

const MONAT = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/** Der Erste eines Monats. `null`, wenn die Eingabe kein Monat ist. */
export function monatsErster(monat: string): string | null {
	return MONAT.test(monat) ? `${monat}-01` : null;
}

/**
 * Der letzte Tag VOR einem Monat — das Ende einer Zuordnung, die ab diesem Monat nicht
 * mehr gelten soll. „Loesen ab Oktober" heisst: im September zaehlt sie noch.
 *
 * Gerechnet mit Date.UTC und wieder als Zeichenkette ausgegeben: der Monatsletzte haengt
 * an Schaltjahren, die keine Regex kennt, und UTC haelt die Zeitzone heraus.
 */
export function letzterTagVorMonat(monat: string): string | null {
	if (!MONAT.test(monat)) return null;
	const [jahr, nr] = monat.split('-').map(Number);
	const d = new Date(Date.UTC(jahr, nr - 1, 1));
	d.setUTCDate(0);
	return d.toISOString().slice(0, 10);
}

export const budgetSchema = z.object({
	name: z.string().trim().min(1).max(80),
	/** Vorgabe false: ein Topf wird bewusst angelegt, und der Normalfall ist der gemeinsame. */
	privat: z.boolean().default(false)
});

const KATEGORIE = z.uuid();
const MONAT_SCHEMA = z.string().regex(MONAT, 'Monat als JJJJ-MM angeben');

export const aenderungSchema = z.discriminatedUnion('art', [
	z.object({ art: z.literal('umbenennen'), name: z.string().trim().min(1).max(80) }),
	z.object({
		art: z.literal('betrag'),
		monat: MONAT_SCHEMA,
		// Ganzzahliger Cent, nicht negativ: man kann sich nicht vornehmen, Geld einzunehmen.
		amountCents: z.int().min(0).max(2_147_483_647)
	}),
	z.object({ art: z.literal('zuordnen'), categoryId: KATEGORIE, abMonat: MONAT_SCHEMA }),
	z.object({ art: z.literal('loesen'), categoryId: KATEGORIE, abMonat: MONAT_SCHEMA })
]);

export type Aenderung = z.infer<typeof aenderungSchema>;

/**
 * Die Kategorie gehoert schon einem anderen Topf. Die Datenbank lehnt das ab (teilweiser
 * eindeutiger Index); diese Ausnahme traegt zusaetzlich den NAMEN des belegenden Topfs,
 * damit die Oberflaeche sagen kann, wohin die Kategorie gehoert — „schon vergeben" allein
 * laesst den Menschen suchen.
 */
export class KategorieBelegt extends Error {
	constructor(readonly topfName: string) {
		super(`Diese Kategorie gehört bereits zum Topf „${topfName}".`);
		this.name = 'KategorieBelegt';
	}
}

type Ausfuehrer = Pick<typeof Db, 'select' | 'insert' | 'update'>;

export async function budgetAnlegen(
	db: Ausfuehrer,
	k: Zugriffskontext,
	name: string,
	privat = false
): Promise<string> {
	const [zeile] = await db
		.insert(budgets)
		.values({
			householdId: k.haushaltId,
			name,
			sichtbarkeit: privat ? 'privat' : 'geteilt',
			// Der CHECK budgets_privat_hat_eigentuemer verlangt beides zusammen: privat
			// genau dann, wenn es einen Eigentuemer gibt.
			eigentuemerId: privat ? k.nutzerId : null
		})
		.returning({ id: budgets.id });
	return zeile.id;
}

export async function budgetUmbenennen(db: Ausfuehrer, budgetId: string, name: string) {
	await db.update(budgets).set({ name }).where(eq(budgets.id, budgetId));
}

/**
 * Der Topf, wenn er zu diesem Haushalt gehoert — sonst `null`. Wie bonLaden fuer Bons:
 * die Route unterscheidet danach nicht zwischen „gibt es nicht" und „gehoert dir nicht",
 * beides ist 404.
 */
export async function topfLaden(db: Ausfuehrer, k: Zugriffskontext, budgetId: string) {
	const [topf] = await db
		// `sichtbarkeit` gehoert dazu: der Aufrufer entscheidet damit, ob geaendert werden
		// darf (darfTopfAendern). Sehen und Aendern sind zwei Fragen — diese Abfrage
		// beantwortet die erste und liefert das Material fuer die zweite gleich mit.
		.select({ id: budgets.id, sichtbarkeit: budgets.sichtbarkeit })
		.from(budgets)
		.where(and(eq(budgets.id, budgetId), sichtbareToepfe(k)));
	return topf ?? null;
}

/**
 * Der Betrag ab einem Monat. Upsert auf (budget_id, gilt_ab): zweimal denselben Monat
 * festzulegen heisst, ihn zu aendern — nicht, zwei Wahrheiten anzulegen.
 */
export async function betragSetzen(
	db: Ausfuehrer,
	budgetId: string,
	monat: string,
	amountCents: number
) {
	const giltAb = monatsErster(monat);
	if (!giltAb) throw new Error(`Kein Monat: ${monat}`);
	await db
		.insert(budgetBetraege)
		.values({ budgetId, giltAb, amountCents })
		.onConflictDoUpdate({
			target: [budgetBetraege.budgetId, budgetBetraege.giltAb],
			set: { amountCents }
		});
}

/**
 * Kategorie ab einem Monat diesem Topf zuordnen.
 *
 * Erst nachsehen, wer sie hat, dann einfuegen — und die Datenbank bleibt trotzdem die
 * Instanz, die entscheidet: geht zwischen beidem eine zweite Zuordnung durch, lehnt der
 * teilweise eindeutige Index sie ab. Das Nachsehen dient nur dem NAMEN in der Meldung;
 * ohne ihn liesse „schon vergeben" den Menschen suchen.
 *
 * Umgekehrt — erst einfuegen, dann bei Ablehnung nachsehen — waere naheliegender und
 * falsch: laeuft das Ganze in einer Transaktion, hat Postgres sie nach dem gescheiterten
 * INSERT bereits abgebrochen, und die Abfrage danach liefe ins Leere.
 */
export async function kategorieZuordnen(
	db: Ausfuehrer,
	k: Zugriffskontext,
	budgetId: string,
	categoryId: string,
	abMonat: string
) {
	const giltAb = monatsErster(abMonat);
	if (!giltAb) throw new Error(`Kein Monat: ${abMonat}`);

	/*
	 * Der EIGENTUEMER kommt vom Topf, nicht vom Aufrufer.
	 *
	 * Bis 18.09.2026 schrieb diese Funktion `eigentuemer_id` gar nicht — jede Zeile hatte
	 * dort NULL. Damit war der Index `budget_kategorien_aktiv_unique` mit seinem
	 * NULLS NOT DISTINCT wirkungslos: er sah alle Zuordnungen als geteilt an, und zwei
	 * private Toepfe auf derselben Kategorie kollidierten weiterhin. Der Datenbanktest
	 * dazu war gruen, weil er die Zeilen direkt einfuegte — er prueft den Index und
	 * uebersah den Schreiber (Befund R19).
	 */
	const [topf] = await db
		.select({ sichtbarkeit: budgets.sichtbarkeit, eigentuemerId: budgets.eigentuemerId })
		.from(budgets)
		.where(and(eq(budgets.id, budgetId), eq(budgets.householdId, k.haushaltId)));
	if (!topf) throw new Error('Topf gehoert nicht zu diesem Haushalt');
	const eigentuemerId = topf.sichtbarkeit === 'privat' ? topf.eigentuemerId : null;

	/*
	 * Die Konfliktsuche laeuft im SELBEN Geltungsbereich, nicht ueber den ganzen Haushalt.
	 *
	 * Sonst zweierlei: ein privater Topf eines anderen Mitglieds blockierte den eigenen,
	 * obwohl beide nebeneinander gelten duerfen — und die Fehlermeldung nannte dabei
	 * dessen NAMEN. „Geheime medizinische Behandlung" gehoert nicht in eine 409-Antwort
	 * an jemand Fremdes (Befund R19).
	 */
	const [belegt] = await db
		.select({ budgetId: budgetKategorien.budgetId, name: budgets.name })
		.from(budgetKategorien)
		.innerJoin(budgets, eq(budgets.id, budgetKategorien.budgetId))
		.where(
			and(
				eq(budgetKategorien.householdId, k.haushaltId),
				eq(budgetKategorien.categoryId, categoryId),
				isNull(budgetKategorien.giltBis),
				eigentuemerId === null
					? isNull(budgetKategorien.eigentuemerId)
					: eq(budgetKategorien.eigentuemerId, eigentuemerId)
			)
		);
	// Schon in DIESEM Topf: nichts zu tun. Ein Fehler waere hier eine Ueberraschung,
	// keine Auskunft — das Ergebnis ist ja genau das gewuenschte.
	if (belegt?.budgetId === budgetId) return;
	if (belegt) throw new KategorieBelegt(belegt.name);

	try {
		await db
			.insert(budgetKategorien)
			.values({ budgetId, householdId: k.haushaltId, categoryId, giltAb, eigentuemerId });
	} catch (err) {
		if (!istEindeutigkeitsfehler(err)) throw err;
		// Zwischen Nachsehen und Einfuegen ist jemand dazwischengekommen. Der Name fehlt
		// hier bewusst: ihn jetzt zu holen hiesse, nach einem Fehler weiterzufragen.
		throw new KategorieBelegt('einem anderen Topf');
	}
}

/** Die laufende Zuordnung dieser Kategorie endet mit dem Monat davor. */
/**
 * Die Zuordnung EINES Topfs beenden — dessen Id gehoert zwingend dazu.
 *
 * Bis 18.09.2026 fehlte sie: die Bedingung lautete nur Haushalt + Kategorie + offen.
 * Wer irgendeinen Topf aendern durfte, loeste damit die Zuordnung JEDES Topfs derselben
 * Kategorie — auch die eines gemeinsamen Topfs, den er nicht verwalten darf, und die
 * eines fremden privaten. Ueber einen selbst angelegten privaten Topf war das fuer
 * jedes Mitglied erreichbar (Befund R18). Die Route prueft, ob der Mensch DIESEN Topf
 * aendern darf; diese Funktion muss sich daran halten, statt breiter zu treffen.
 */
export async function kategorieLoesen(
	db: Ausfuehrer,
	k: Zugriffskontext,
	budgetId: string,
	categoryId: string,
	abMonat: string
) {
	const giltBis = letzterTagVorMonat(abMonat);
	if (!giltBis) throw new Error(`Kein Monat: ${abMonat}`);
	await db
		.update(budgetKategorien)
		.set({ giltBis })
		.where(
			and(
				eq(budgetKategorien.budgetId, budgetId),
				eq(budgetKategorien.householdId, k.haushaltId),
				eq(budgetKategorien.categoryId, categoryId),
				isNull(budgetKategorien.giltBis)
			)
		);
}

/**
 * Loeschen heisst beenden, nicht entfernen: der Topf behaelt Name und Betraege, damit
 * vergangene Berichte bleiben, wie sie waren. Seine laufenden Zuordnungen enden mit dem
 * Monat davor, und `geloescht_ab` haelt fest, ab wann es ihn nicht mehr gibt.
 */
export async function budgetLoeschen(db: Ausfuehrer, k: Zugriffskontext, budgetId: string, abMonat: string) {
	const giltAb = monatsErster(abMonat);
	const giltBis = letzterTagVorMonat(abMonat);
	if (!giltAb || !giltBis) throw new Error(`Kein Monat: ${abMonat}`);
	await db
		.update(budgetKategorien)
		.set({ giltBis })
		.where(and(eq(budgetKategorien.budgetId, budgetId), isNull(budgetKategorien.giltBis)));
	await db
		.update(budgets)
		.set({ geloeschtAb: giltAb })
		.where(and(eq(budgets.id, budgetId), sichtbareToepfe(k)));
}

/** Postgres 23505 — Verstoss gegen eine Eindeutigkeitsregel. */
function istEindeutigkeitsfehler(err: unknown): boolean {
	const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
	return code === '23505';
}

/**
 * Alles, was die Einstellungsseite "Budgets" fuer einen Monat braucht: die Toepfe, wie
 * budgetsFuerMonat sie fuer diesen Monat aufloest, und wie viele Positionen ueberhaupt
 * schon eine Kategorie tragen.
 */
export async function budgetsSeiteLaden(db: typeof Db, k: Zugriffskontext, monat: string) {
	const erster = `${monat}-01`;

	const [toepfe, betraege, zuordnungen, kategorien, [positionen]] = await Promise.all([
		db
			.select({
				id: budgets.id,
				name: budgets.name,
				sichtbarkeit: budgets.sichtbarkeit,
				eigentuemerId: budgets.eigentuemerId,
				geloeschtAb: budgets.geloeschtAb
			})
			.from(budgets)
			.where(sichtbareToepfe(k))
			.orderBy(asc(budgets.name)),
		db
			.select({
				budgetId: budgetBetraege.budgetId,
				giltAb: budgetBetraege.giltAb,
				amountCents: budgetBetraege.amountCents
			})
			.from(budgetBetraege)
			.innerJoin(budgets, eq(budgets.id, budgetBetraege.budgetId))
			.where(sichtbareToepfe(k)),
		db
			// Nur die Zuordnungen SICHTBARER Toepfe: sonst kaeme die Zuordnung eines
			// fremden privaten Topfs mit und verdraengte in der Aufloesung die eigene
			// (Befund R20). Der Eigentuemer wird mitgelesen, weil die Aufloesung die
			// Bereiche daran auseinanderhaelt.
			.select({
				budgetId: budgetKategorien.budgetId,
				categoryId: budgetKategorien.categoryId,
				giltAb: budgetKategorien.giltAb,
				giltBis: budgetKategorien.giltBis,
				eigentuemerId: budgetKategorien.eigentuemerId
			})
			.from(budgetKategorien)
			.innerJoin(budgets, eq(budgets.id, budgetKategorien.budgetId))
			.where(sichtbareToepfe(k)),
		db
			.select({ id: categories.id, name: categories.name, parentId: categories.parentId })
			.from(categories)
			.orderBy(asc(categories.sort), asc(categories.name)),
		db
			.select({ mitKategorie: count(receiptItems.categoryId), gesamt: count() })
			.from(receiptItems)
			.innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
			.where(sichtbareBons(k))
	]);

	// Ein geloeschter Topf verschwindet erst ab dem Monat seiner Loeschung. Fuer einen
	// frueheren Monat gehoert er weiter dazu — dafuer gibt es geloescht_ab.
	const sichtbar = toepfe.filter((t) => t.geloeschtAb === null || t.geloeschtAb > erster);
	const aufgeloest = budgetsFuerMonat(sichtbar, betraege, zuordnungen, kategorien, monat);

	return {
		kategorien,
		budgets: aufgeloest.budgets,
		ausserhalb: aufgeloest.ausserhalb,
		// Wie viele Positionen ueberhaupt eine Kategorie tragen. Ohne die waere jeder
		// Balken eine Behauptung — die Seite sagt lieber, warum sie leer ist.
		positionen
	};
}
