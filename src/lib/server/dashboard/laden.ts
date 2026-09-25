import { count, eq } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { listeLaden, zaehlerLaden } from '$lib/server/bons/liste';
import { monatszahlenLaden } from '$lib/server/berichte/monatszahlen';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { aktuellerMonat } from '$lib/server/zeit';

/** So viele wartende Bons stehen direkt auf der Startseite — der Rest hinter „alle ansehen". */
const VORSCHAU = 5;

/**
 * Die Daten der Startseite. Zwei Adressen zeigen sie: /dashboard, und am Schreibtisch
 * die Eingangstuer / — deshalb liegt das Laden hier und nicht in einem der beiden
 * Loader. Zwei Fassungen desselben Ladens wuerden auseinanderlaufen.
 */
export async function startseiteLaden(db: typeof Db, k: Zugriffskontext) {
	const monat = aktuellerMonat();
	const [zaehler, wartend, zahlen, [kategorien]] = await Promise.all([
		zaehlerLaden(db, k),
		listeLaden(db, k, { status: 'brauchtDich', monat: null, haendler: null, suche: null }),
		monatszahlenLaden(db, k, monat),
		// Wie viele Positionen ueberhaupt schon eine Kategorie tragen. Die Startseite sagt
		// damit „1 von 140" statt einer leeren Kachel ohne Erklaerung: der Grund fuer die
		// Leere ist wichtiger als die Leere.
		db
			.select({ mitKategorie: count(receiptItems.categoryId), gesamt: count() })
			.from(receiptItems)
			.innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
			.where(sichtbareBons(k))
	]);

	return {
		monat,
		zaehler,
		zahlen,
		kategorien,
		// listeLaden sortiert schon so, wie der Pruefstapel (stapel.ts) durchgeht — die
		// Vorschau zeigt schlicht den Anfang davon, damit ein Klick dort weitermacht,
		// wo der Stapel anfaengt.
		wartend: wartend.bons.slice(0, VORSCHAU),
		wartendGesamt: wartend.bons.length
	};
}

export type Startseitendaten = Awaited<ReturnType<typeof startseiteLaden>> & {
	haushalt?: string | null;
	user?: { displayName: string } | null;
};
