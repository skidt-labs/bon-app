/**
 * Kaskadenstufen 1 und 2: Zuordnung ausschliesslich aus dem, was schon bekannt ist —
 * feste Regeln fuer Nicht-Produkte (Pfand, Leergut, Rabatt, Info, Bonuspunkte) und das
 * Lerngedaechtnis (product_aliases). KEIN Modellaufruf.
 *
 * Diese Datei darf nichts aus der Modellstufe (Aufgabe 6) importieren. Diese Trennung
 * ist der Grund, warum die Kaskade ohne Modellaufruf prüfbar ist — dasselbe Muster wie
 * ingest.ts gegen client.ts in Phase 1.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { categories, productAliases, products } from '../db/schema';
import { normalisiereRohtext } from './normalisieren';
import { SONSTIGES_PFAND_SLUG, SONSTIGES_RABATT_SLUG, SONSTIGES_UNSORTIERT_SLUG } from './baum';

/** Eine Bonzeile, die noch keine Kategorie hat und einsortiert werden soll. */
export type ZuOrdnendeZeile = {
	id: string;
	rawText: string;
	lineType: string;
};

/** Woher eine Zuordnung stammt und wie sicher sie ist — siehe category_source/confidence in schema.ts. */
export type Zuordnung = {
	itemId: string;
	productId: string | null;
	categoryId: string | null;
	source: 'rule' | 'llm' | 'manual' | 'none';
	confidence: number | null;
};

/**
 * Ein Treffer aus dem Lerngedaechtnis. `categoryId` ist die defaultCategoryId des
 * gefundenen Produkts und darf null sein (Produkt bekannt, aber noch keiner Kategorie
 * zugeordnet) — das ist eine echte Leerstelle, keine Verletzung von "eine 0 ist eine
 * Behauptung".
 */
export type AliasTreffer = {
	productId: string;
	categoryId: string | null;
	merchantId: string | null;
};

export type KaskadeDeps = {
	/**
	 * Sucht den besten gelernten Alias zum normalisierten Text (haushaltsweit — siehe
	 * householdId in ordneAusGedaechtnis). Die ECHTE Umsetzung bevorzugt einen Treffer
	 * beim uebergebenen Haendler; ordneAusGedaechtnis selbst liest danach nur noch
	 * `treffer.merchantId`, um zwischen Konfidenz 100 (gleicher Haendler) und 60
	 * (anderer Haendler bzw. haendlerunabhaengig gelernt) zu unterscheiden.
	 */
	aliasSuchen: (schluessel: string) => Promise<AliasTreffer | null>;
	/**
	 * Loest einen Kategorie-Slug in seine echte Datenbank-Id auf. Der Name ist bewusst
	 * NICHT mehr "unsortiertId": urspruenglich nur fuer den Rueckfall auf
	 * SONSTIGES_UNSORTIERT_SLUG gedacht, loest diese Abhaengigkeit inzwischen auch die
	 * beiden anderen festen "sonstiges"-Kategorien (Pfand, Rabatt) auf —
	 * categories.id ist KEINE feste Konstante (defaultRandom(), siehe schema.ts), muss
	 * also zur Laufzeit nachgeschlagen werden, und dieser Auftrag sieht dafuer keine
	 * weitere Abhaengigkeit vor (Review Aufgabe 5, Befund 5).
	 */
	slugAufloesen: (slug: string) => Promise<string | null>;
};

// Konfidenz-Bedeutung siehe confidence in schema.ts ("0-100. null heisst 'keine
// Aussage'"). Benannt statt verstreut (Review Aufgabe 5, Befund 4): drei Stellen mit
// derselben Zahl "100" liessen sich sonst leicht nur an einer aendern.
/** Feste Regel (Pfand/Leergut/Rabatt): keine Unsicherheit ueber die Art der Zeile. */
const KONFIDENZ_FESTE_REGEL = 100;
/** Gelernter Alias beim SELBEN Haendler: staerkster Gedaechtnis-Treffer. */
const KONFIDENZ_GLEICHER_HAENDLER = 100;
/** Gelernter Alias bei einem ANDEREN oder unbekannten Haendler: schwaecherer Hinweis. */
const KONFIDENZ_ANDERER_HAENDLER = 60;

/**
 * Baut eine Zuordnung und koppelt Konfidenz STRUKTURELL an das tatsaechliche
 * Vorhandensein einer Kategorie (Review Aufgabe 5, Befund 1/A: "Eine 0 ist eine
 * Behauptung, null ist eine Leerstelle" — dasselbe gilt fuer eine erfundene Konfidenz
 * ohne Kategorie). JEDE Zuordnung in dieser Datei entsteht ausschliesslich ueber diese
 * eine Funktion, damit kein einzelner Aufrufzweig (heute oder kuenftig) das Kopplung
 * versehentlich umgehen kann, indem er `confidence` direkt und unbedingt setzt.
 */
function zuordnungErstellen(
	itemId: string,
	productId: string | null,
	categoryId: string | null,
	source: Zuordnung['source'],
	confidenceWennKategorie: number | null
): Zuordnung {
	return {
		itemId,
		productId,
		categoryId,
		source,
		confidence: categoryId === null ? null : confidenceWennKategorie
	};
}

/**
 * Baut die Abfrage fuer den besten Alias-Kandidaten (ohne sie auszufuehren) — als
 * eigene Funktion exportiert, damit ein Test das erzeugte SQL (per `.toSQL()`) ohne
 * Datenbankzugriff auf ein explizites ORDER BY pruefen kann (Review Aufgabe 5,
 * Befund 3/C).
 */
export function aliasKandidatenQuery(schluessel: string, householdId: string) {
	return db
		.select({
			productId: productAliases.productId,
			merchantId: productAliases.merchantId,
			categoryId: products.defaultCategoryId
		})
		.from(productAliases)
		.innerJoin(products, eq(products.id, productAliases.productId))
		.where(and(eq(productAliases.rawTextNormalized, schluessel), eq(products.householdId, householdId)))
		.orderBy(asc(productAliases.createdAt), asc(productAliases.id));
	// Ohne ORDER BY ueberlaesst Postgres die Reihenfolge bei mehreren Treffern (z.B.
	// derselbe Rohtext, gelernt bei zwei verschiedenen Haendlern) dem Query-Planer —
	// nicht reproduzierbar, kann sich mit Tabellenwachstum/VACUUM/ANALYZE aendern, ohne
	// dass sich an den Daten etwas aendert (Review Aufgabe 5, Befund 3/C). createdAt
	// ASC: der ZUERST gelernte Alias gewinnt als Tie-Break, wenn (unten in
	// aliasSuchen) keiner der Kandidaten zum uebergebenen Haendler passt — auditierbar
	// und nachvollziehbar ("der aelteste Eintrag"), statt vom Zufall der Planwahl
	// abzuhaengen. id ASC ist nur ein rein technischer letzter Tie-Break fuer den bei
	// Millisekunden-Aufloesung praktisch nie eintretenden Fall exakt gleicher
	// createdAt-Zeitstempel — id ist selbst zufaellig (defaultRandom()), traegt also
	// keine eigene Bedeutung, garantiert aber eine vollstaendige, stabile Ordnung.
}

/** Produktionsabhaengigkeiten: echte Datenbankzugriffe statt der Testdoubles. */
function echteKaskadeDeps(merchantId: string | null, householdId: string): KaskadeDeps {
	return {
		async aliasSuchen(schluessel) {
			const kandidaten = await aliasKandidatenQuery(schluessel, householdId);
			if (kandidaten.length === 0) return null;
			// Zeile am UEBERGEBENEN Haendler zuerst, sonst der erste gemaess obiger
			// deterministischer SQL-Reihenfolge — die Konfidenz-Entscheidung trifft
			// ordneAusGedaechtnis anhand von merchantId.
			return kandidaten.find((k) => merchantId !== null && k.merchantId === merchantId) ?? kandidaten[0];
		},
		async slugAufloesen(slug = SONSTIGES_UNSORTIERT_SLUG) {
			const [zeile] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
			return zeile?.id ?? null;
		}
	};
}

/**
 * Stufe 1+2 der Kaskade: ordnet zu, was das feste Regelwerk und das Lerngedaechtnis
 * bereits wissen. Kein Treffer bedeutet nicht "unsortiert", sondern "offen" — die
 * Modellstufe (Aufgabe 6) bekommt diese Zeilen als naechstes.
 *
 * Wirft NIE. Ein Fehler beim Nachschlagen laesst nur die betroffene Zeile offen, statt
 * die Funktion abzubrechen — dieselbe Absicherung wie bei haendlerAufloesen() in
 * src/worker/extract-receipt.ts: die Kaskade laeuft im selben Zusammenhang wie das
 * Speichern eines Bons und darf ihn nie mitreissen.
 */
export async function ordneAusGedaechtnis(
	zeilen: ZuOrdnendeZeile[],
	merchantId: string | null,
	householdId: string,
	deps: KaskadeDeps = echteKaskadeDeps(merchantId, householdId)
): Promise<{ zugeordnet: Zuordnung[]; offen: ZuOrdnendeZeile[] }> {
	const zugeordnet: Zuordnung[] = [];
	const offen: ZuOrdnendeZeile[] = [];

	// Innerhalb EINES Aufrufs kommt derselbe feste Slug oft mehrfach vor (mehrere
	// Pfand-Zeilen auf einem Bon) — ein kleiner Zwischenspeicher erspart wiederholte
	// Nachschlagevorgaenge fuer denselben Slug.
	//
	// slugNachschlagen wirft ABSICHTLICH NIE (der `.catch` unten faengt jeden Fehler
	// von deps.slugAufloesen ab): Pfand/Leergut/Rabatt sind ueber eine FESTE Regel
	// bestimmt, keine Vermutung ueber ein unbekanntes Produkt. Schluege der
	// Slug-Nachschlag fehl und liefe die Zeile deshalb in den generischen
	// catch-Zweig unten (-> offen), verloere sie ihre feste Zuordnung und wuerde in
	// Aufgabe 8 ans Modell weitergereicht — verschwendetes Geld fuer eine Zeile, die
	// nie ein Produkt war (Review Aufgabe 5, Befund 2/B). Der Rueckgabewert null bei
	// Fehler ist trotzdem ehrlich: zuordnungErstellen() macht daraus automatisch
	// confidence: null, es wird nichts behauptet, was nicht da ist.
	const slugCache = new Map<string, Promise<string | null>>();
	const slugNachschlagen = (slug: string): Promise<string | null> => {
		let treffer = slugCache.get(slug);
		if (!treffer) {
			treffer = deps.slugAufloesen(slug).catch((fehler) => {
				// Nur die sanitierte Meldung, NIE das rohe Fehlerobjekt (kann
				// Verbindungsdaten mitschleppen) — dasselbe Muster wie im
				// generischen catch unten und beim Haendler-Fallback in
				// src/worker/extract-receipt.ts.
				const meldung = fehler instanceof Error ? fehler.message : String(fehler);
				console.error(
					`[kaskade] Slug "${slug}" konnte nicht aufgeloest werden, Zeile bleibt ohne Kategorie: ${meldung}`
				);
				return null;
			});
			slugCache.set(slug, treffer);
		}
		return treffer;
	};

	for (const zeile of zeilen) {
		try {
			// Stufe 0 (kein Gedaechtnis, kein Modell): Pfand, Leergut und Rabatt sind
			// keine Produkte — sie durchs Modell zu schicken waere verschwendetes Geld
			// und wuerde falsche Aliasse lernen. Bleibt "rule" auch dann, wenn der
			// Slug-Nachschlag fehlschlaegt (siehe slugNachschlagen oben) — nur die
			// Kategorie bleibt dann leer, die Zeile verlaesst NIE diesen Zweig.
			if (zeile.lineType === 'deposit' || zeile.lineType === 'deposit_return') {
				zugeordnet.push(
					zuordnungErstellen(
						zeile.id,
						null,
						await slugNachschlagen(SONSTIGES_PFAND_SLUG),
						'rule',
						KONFIDENZ_FESTE_REGEL
					)
				);
				continue;
			}
			if (zeile.lineType === 'discount') {
				zugeordnet.push(
					zuordnungErstellen(
						zeile.id,
						null,
						await slugNachschlagen(SONSTIGES_RABATT_SLUG),
						'rule',
						KONFIDENZ_FESTE_REGEL
					)
				);
				continue;
			}
			// Infozeilen und Bonuspunkte tragen keinen Warenwert — eine Kategorie zu
			// behaupten, wo es keine gibt, verstiesse gegen das oberste Prinzip.
			if (zeile.lineType === 'info' || zeile.lineType === 'loyalty') {
				zugeordnet.push(zuordnungErstellen(zeile.id, null, null, 'none', null));
				continue;
			}

			// Stufe 1+2: Lerngedaechtnis ueber den normalisierten Text.
			const schluessel = normalisiereRohtext(zeile.rawText);
			const treffer = schluessel === '' ? null : await deps.aliasSuchen(schluessel);
			if (!treffer) {
				offen.push(zeile);
				continue;
			}
			zugeordnet.push(
				zuordnungErstellen(
					zeile.id,
					treffer.productId,
					treffer.categoryId,
					'rule',
					merchantId !== null && treffer.merchantId === merchantId
						? KONFIDENZ_GLEICHER_HAENDLER
						: KONFIDENZ_ANDERER_HAENDLER
				)
			);
		} catch (fehler) {
			// Nur die sanitierte Meldung, NIE das rohe Fehlerobjekt (kann
			// Verbindungsdaten mitschleppen) — dasselbe Muster wie beim
			// Haendler-Fallback in src/worker/extract-receipt.ts.
			const meldung = fehler instanceof Error ? fehler.message : String(fehler);
			console.error(
				`[kaskade] Zeile ${zeile.id} konnte nicht aus dem Gedaechtnis zugeordnet werden, bleibt offen: ${meldung}`
			);
			offen.push(zeile);
		}
	}

	return { zugeordnet, offen };
}
