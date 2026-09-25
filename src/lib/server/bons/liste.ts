import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { monatsgrenzen } from '$lib/server/zeit';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';

/**
 * Die eine Liste hinter Posteingang und Bons. Beide Seiten unterscheiden sich nur im
 * Vorfilter: der Posteingang beginnt mit "braucht dich", das Archiv mit "alle, dieser
 * Monat". Alles, was entscheidet (Filter aus der URL, Statuslisten, Zaehler), ist eine
 * reine Funktion mit Test; die Abfrage selbst ist duenn.
 */
export type ReceiptStatus = (typeof receipts.$inferSelect)['status'];
export type StatusFilter = 'brauchtDich' | 'wirdGelesen' | 'fehlgeschlagen' | 'bestaetigt' | 'alle';

export type ListenFilter = {
	status: StatusFilter;
	monat: string | null;
	haendler: string | null;
	suche: string | null;
};

export type BonZeile = {
	id: string;
	status: ReceiptStatus;
	merchant: string | null;
	purchasedAt: Date | null;
	createdAt: Date;
	totalGrossCents: number | null;
	problems: string[] | null;
	failureReason: string | null;
	source: (typeof receipts.$inferSelect)['source'];
	positionen: number;
};

export type Zaehler = { brauchtDich: number; wirdGelesen: number; fehlgeschlagen: number; bestaetigt: number };

const STATUS_FILTER: readonly StatusFilter[] = ['brauchtDich', 'wirdGelesen', 'fehlgeschlagen', 'bestaetigt', 'alle'];

/**
 * "Braucht dich" ist review UND failed — beides wartet auf einen Menschen. pending und
 * extracting warten auf die Maschine. Dieselbe Abgrenzung, die der Posteingang schon
 * bisher fuer "warten auf dich" gezogen hat. `null` heisst: nicht nach Status filtern.
 */
export function statusListe(f: StatusFilter): ReceiptStatus[] | null {
	switch (f) {
		case 'brauchtDich':
			return ['review', 'failed'];
		case 'wirdGelesen':
			return ['pending', 'extracting'];
		case 'fehlgeschlagen':
			return ['failed'];
		case 'bestaetigt':
			return ['confirmed'];
		case 'alle':
			return null;
	}
}

function leerZuNull(wert: string | null): string | null {
	const w = wert?.trim() ?? '';
	return w === '' ? null : w;
}

/**
 * Liest die Filter aus der URL. Ein unbrauchbarer Wert faellt auf den Standard zurueck
 * UND erzeugt einen Hinweis, den die Seite anzeigt — nie still. Sonst glaubt der
 * Mensch, er saehe den September, und sieht alles.
 */
export function filterAusQuery(
	params: URLSearchParams,
	standard: { status: StatusFilter; monat: string | null }
): { filter: ListenFilter; hinweise: string[] } {
	const hinweise: string[] = [];

	let status = standard.status;
	const rohStatus = leerZuNull(params.get('status'));
	if (rohStatus !== null) {
		if ((STATUS_FILTER as readonly string[]).includes(rohStatus)) status = rohStatus as StatusFilter;
		else hinweise.push(`Den Filter „${rohStatus}" gibt es nicht — gezeigt wird „${standard.status}".`);
	}

	let monat = standard.monat;
	const rohMonat = leerZuNull(params.get('monat'));
	if (rohMonat !== null) {
		if (monatsgrenzen(rohMonat) !== null) {
			monat = rohMonat;
		} else {
			// Zurueck auf "alle Monate", nicht auf den Standardmonat: wer einen Monat
			// eingetippt hat, wollte filtern — ein stiller Standardmonat saehe aus wie
			// sein Wunsch und waere es nicht. Der Hinweis sagt, was gezeigt wird.
			monat = null;
			hinweise.push(`„${rohMonat}" ist kein Monat (erwartet JJJJ-MM) — gezeigt werden alle Monate.`);
		}
	}

	return {
		filter: { status, monat, haendler: leerZuNull(params.get('haendler')), suche: leerZuNull(params.get('suche')) },
		hinweise
	};
}

export function zaehlerAus(zeilen: { status: string; n: number }[]): Zaehler {
	const je = (s: string) => zeilen.filter((z) => z.status === s).reduce((a, z) => a + Number(z.n), 0);
	return {
		brauchtDich: je('review') + je('failed'),
		wirdGelesen: je('pending') + je('extracting'),
		fehlgeschlagen: je('failed'),
		bestaetigt: je('confirmed')
	};
}

/** `%` und `_` sind in ILIKE Platzhalter — aus der Eingabe des Menschen sollen sie Zeichen sein. */
function suchmuster(eingabe: string): string {
	return '%' + eingabe.replace(/[\\%_]/g, '\\$&') + '%';
}

/**
 * Der Zaehler MUSS dieselbe Bedingung benutzen wie die Liste, nicht bloss denselben
 * Haushalt. Sonst zaehlt er fremde private Bons mit, waehrend die Liste darunter sie
 * nicht zeigt — und wer den Unterschied sieht, sucht nach etwas, das es fuer ihn nicht
 * gibt. Eine Zahl, die etwas anderes sagt als die Liste, ist schlimmer als keine Zahl.
 */
export async function zaehlerLaden(db: typeof Db, k: Zugriffskontext): Promise<Zaehler> {
	const zeilen = await db
		.select({ status: receipts.status, n: count() })
		.from(receipts)
		.where(sichtbareBons(k))
		.groupBy(receipts.status);
	return zaehlerAus(zeilen);
}

export async function listeLaden(
	db: typeof Db,
	k: Zugriffskontext,
	filter: ListenFilter
): Promise<{ bons: BonZeile[]; zaehler: Zaehler }> {
	// Kaufzeitpunkt, sonst Eingang: ein Bon, der noch gelesen wird, hat noch kein
	// purchased_at und soll trotzdem im richtigen Monat und an der richtigen Stelle stehen.
	const wann = sql`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`;

	const bedingungen = [sichtbareBons(k)];
	const stati = statusListe(filter.status);
	if (stati) bedingungen.push(inArray(receipts.status, stati));
	const grenzen = filter.monat ? monatsgrenzen(filter.monat) : null;
	if (grenzen) bedingungen.push(gte(wann, grenzen.von), lt(wann, grenzen.bis));
	if (filter.haendler) bedingungen.push(ilike(receipts.merchantNameRaw, suchmuster(filter.haendler)));
	if (filter.suche) {
		const muster = suchmuster(filter.suche);
		bedingungen.push(
			or(
				ilike(receipts.merchantNameRaw, muster),
				exists(
					db
						.select({ eins: sql`1` })
						.from(receiptItems)
						.where(and(eq(receiptItems.receiptId, receipts.id), ilike(receiptItems.rawText, muster)))
				)
			)!
		);
	}

	const [bons, zaehler] = await Promise.all([
		db
			.select({
				id: receipts.id,
				status: receipts.status,
				merchant: receipts.merchantNameRaw,
				purchasedAt: receipts.purchasedAt,
				createdAt: receipts.createdAt,
				totalGrossCents: receipts.totalGrossCents,
				problems: receipts.needsReviewReason,
				failureReason: receipts.failureReason,
				source: receipts.source,
				positionen: sql<number>`(select count(*)::int from ${receiptItems} where ${receiptItems.receiptId} = ${receipts.id})`
			})
			.from(receipts)
			.where(and(...bedingungen))
			.orderBy(desc(wann))
			.limit(200),
		zaehlerLaden(db, k)
	]);

	return { bons, zaehler };
}

/** Der Bon, wenn er zu diesem Haushalt gehoert — sonst `null`. Nie 403, immer 404: ein
 *  Bon eines fremden Haushalts sieht fuer den Aufrufer aus wie einer, den es nicht gibt. */
export async function bonLaden(db: typeof Db, k: Zugriffskontext, bonId: string) {
	const [bon] = await db.select().from(receipts).where(and(eq(receipts.id, bonId), sichtbareBons(k)));
	return bon ?? null;
}

/**
 * Die Positionen eines Bons, in Lesereihenfolge. Ohne eigenen Haushaltsfilter: wer diese
 * Funktion aufruft, hat den Bon schon per bonLaden geprueft und kennt seine Id bereits —
 * ein zweiter Filter auf denselben Datensatz waere Schmuck, keine Sicherung.
 */
export async function bonPositionenLaden(db: typeof Db, bonId: string) {
	return db.select().from(receiptItems).where(eq(receiptItems.receiptId, bonId)).orderBy(asc(receiptItems.lineNo));
}

/** Einen neuen Bon fuer den Haushalt aus dem Kontext anlegen. Liefert die neue Id. */
export async function bonAnlegen(
	db: typeof Db,
	k: Zugriffskontext,
	felder: {
		imagePath: string;
		thumbPath: string;
		source: (typeof receipts.$inferInsert)['source'];
	}
): Promise<string> {
	const [row] = await db
		.insert(receipts)
		.values({
			householdId: k.haushaltId,
			uploadedBy: k.nutzerId,
			imagePath: felder.imagePath,
			thumbPath: felder.thumbPath,
			source: felder.source,
			status: 'pending'
		})
		.returning({ id: receipts.id });
	return row.id;
}

/**
 * Markiert einen Bon als fehlgeschlagen, wenn das Einreihen in die Warteschlange nicht
 * geklappt hat. Kein Haushaltsfilter: die Id ist an dieser Stelle bereits bekannt und
 * geprueft (frisch angelegt oder ueber bonLaden/bonReaktivieren geladen).
 */
export async function bonAlsFehlgeschlagenMarkieren(db: typeof Db, bonId: string, reason: string) {
	await db
		.update(receipts)
		.set({ status: 'failed', failureReason: reason.slice(0, 500) })
		.where(eq(receipts.id, bonId));
}

/**
 * Ein 'failed' Bon zurueck in die Warteschlange. `null`, wenn er nicht sichtbar ist oder
 * nicht (mehr) 'failed' — das atomare UPDATE trifft dann keine Zeile.
 */
export async function bonReaktivieren(
	db: typeof Db,
	k: Zugriffskontext,
	bonId: string
): Promise<{ id: string } | null> {
	const [reactivated] = await db
		.update(receipts)
		.set({ status: 'pending', failureReason: null })
		.where(and(eq(receipts.id, bonId), sichtbareBons(k), eq(receipts.status, 'failed')))
		.returning({ id: receipts.id });
	return reactivated ?? null;
}
