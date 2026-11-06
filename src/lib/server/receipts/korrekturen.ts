import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { receipts, receiptItems } from '$lib/server/db/schema';
import { ZEILENARTEN, mitVorzeichen } from '$lib/bons/zeilenarten';
import { haendlerAufloesen } from '$lib/server/merchants';
import { lerneAusKorrektur } from '$lib/server/kategorien/lernen';
import { parseBonZeit } from '$lib/server/zeit';
import { DOPPEL_GRUND, originalFuerNeuenBon } from '$lib/server/bons/doppelt';

/**
 * Der Vertrag, mit dem ein Mensch einen Bon korrigiert. Zwei Endpunkte teilen ihn:
 * PUT /api/receipts/[id] speichert (Bon bleibt `review`), POST …/confirm speichert und
 * bestaetigt. Derselbe Rumpf, dieselbe Pruefung, dieselbe Transaktion — sonst driften
 * die beiden Wege auseinander, und der eine liesse durch, was der andere ablehnt.
 *
 * Geld ist ueberall ganzzahliger Cent, nie eine Dezimalzahl: "1.09" waere 109 Cent oder
 * 1 Cent, und ein Fehler um Faktor 100 sieht plausibel aus. Dieselbe Regel wie im
 * Extraktions-Schema.
 */
const CENT = z.int().min(-2_147_483_648).max(2_147_483_647);

export const korrekturenSchema = z.object({
	receipt: z.object({
		merchantNameRaw: z.string().trim().max(200).nullable(),
		/** ISO-Zeitpunkt oder null. Geparst wird mit parseBonZeit, wie beim Worker. */
		purchasedAt: z.string().nullable(),
		totalGrossCents: CENT.nullable(),
		paymentMethod: z.string().trim().max(50).nullable(),
		/**
		 * Der Schalter aus der Pruefansicht. Vorgabe false, also "teilen" — denn dieses
		 * Feld wirkt NUR beim Bestaetigen (oder beim erneuten Speichern eines schon
		 * bestaetigten Bons). Solange ein Bon ungeprueft ist, bleibt er ohnehin privat,
		 * und ein fehlendes Feld aus einem aelteren Client darf ihn nicht still teilen.
		 */
		privatBehalten: z.boolean().default(false)
	}),
	items: z.array(
		z.object({
			/** null = neue Zeile, die es in der Datenbank noch nicht gibt. */
			id: z.uuid().nullable(),
			lineNo: z.int().min(1).max(999),
			rawText: z.string().max(500),
			lineType: z.enum(ZEILENARTEN),
			quantity: z.string().max(50).nullable(),
			unit: z.string().max(20).nullable(),
			unitPriceCents: CENT.nullable(),
			totalPriceCents: CENT,
			vatClass: z.string().max(10).nullable(),
			appliesToLine: z.int().min(1).max(999).nullable(),
			categoryId: z.uuid().nullable()
		})
		/**
		 * Rabatt und Pfandrueckgabe sind immer negativ — der Server erzwingt das, auch wenn
		 * ein Client (oder die iPhone-Tastatur ohne Minus) einen positiven Betrag schickt.
		 * Hier im Vertrag, damit beide Endpunkte, der Vergleich mit dem Bestand
		 * (`hatSichGeaendert`) und das Schreiben dieselben Werte sehen.
		 */
		.transform((i) => ({
			...i,
			totalPriceCents: mitVorzeichen(i.lineType, i.totalPriceCents),
			unitPriceCents: i.unitPriceCents === null ? null : mitVorzeichen(i.lineType, i.unitPriceCents)
		}))
	),
	/** Zeilen, die der Mensch entfernt hat — ihre IDs, damit der Server sie loeschen kann. */
	geloescht: z.array(z.uuid()),
	/**
	 * „Meine Fassung speichern“ nach einer 409 (Entwurf 2026-11-06-pruefhilfen, §4b): die
	 * Fassung der Seite gilt, auch wenn ihre Zeilen nicht mehr zum Bestand passen. Nur auf
	 * ausdruecklichen Klick; die Statuspruefung bleibt hart.
	 */
	ueberschreiben: z.boolean().default(false),
	/**
	 * Der Status, mit dem die Seite den Bon geladen hat (Abschlusspruefung 0.13.0, C1). Weicht
	 * er ab — etwa anderswo bestaetigt, waehrend dieses Fenster noch „in Pruefung“ zeigt —,
	 * lehnen beide Endpunkte ab, statt die bestaetigte Fassung zu ueberschreiben. Fehlt er
	 * (aeltere Seite), wird nicht verglichen.
	 */
	erwartet: z.string().max(20).optional()
});

export type Korrekturen = z.infer<typeof korrekturenSchema>;

/**
 * Was Zod nicht pruefen kann, weil es die Zeilen ZUEINANDER betrifft.
 *
 * Der Server nummeriert NICHT still um. Der Worker tut das (sanitizeItemsForInsert),
 * weil dort ein Modell antwortet und niemand zusieht. Hier tippt ein Mensch: eine stille
 * Korrektur seiner Eingabe waere eine Behauptung darueber, was er gemeint hat — und er
 * saehe hinterher etwas anderes, als er eingegeben hat.
 */
export function pruefeKorrekturen(k: Korrekturen): { ok: true } | { ok: false; grund: string } {
	if (k.items.length === 0) {
		return { ok: false, grund: 'Ein Bon braucht mindestens eine Position.' };
	}

	const nummern = k.items.map((i) => i.lineNo);
	const gesehen = new Set<number>();
	for (const n of nummern) {
		if (gesehen.has(n)) return { ok: false, grund: `Die Zeilennummer ${n} kommt zweimal vor.` };
		gesehen.add(n);
	}
	const sortiert = [...nummern].sort((a, b) => a - b);
	for (let i = 0; i < sortiert.length; i++) {
		if (sortiert[i] !== i + 1) {
			return {
				ok: false,
				grund: `Die Zeilennummern müssen lückenlos von 1 bis ${sortiert.length} laufen — ${sortiert[i]} passt nicht.`
			};
		}
	}

	for (const i of k.items) {
		if (i.appliesToLine === null) continue;
		if (i.appliesToLine === i.lineNo) {
			return { ok: false, grund: `Zeile ${i.lineNo} bezieht sich auf sich selbst.` };
		}
		if (!gesehen.has(i.appliesToLine)) {
			return { ok: false, grund: `Zeile ${i.lineNo} bezieht sich auf Zeile ${i.appliesToLine}, die es nicht gibt.` };
		}
	}

	return { ok: true };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Die Korrekturen passen nicht zum Bestand: eine Zeile gehoert nicht zu diesem Bon,
 * eine Zeile des Bons fehlt in den Korrekturen (weder geaendert noch geloescht), oder
 * eine Zeile ist zwischen Laden und Speichern verschwunden. Der schlimmste Ausgang
 * waere, das still zu ueberspringen und den Bon trotzdem zu bestaetigen — `confirmed`
 * ist der Status, den die Auswertungen als Wahrheit lesen. Deshalb wirft die Anwendung,
 * und der Endpunkt macht daraus ein 409 mit der Bitte, die Seite neu zu laden.
 */
/** Eine Zeile, deren Kategorie ein Mensch gesetzt hat — Futter fuer das Lerngedaechtnis. */
export type Gelerntes = { rawText: string; categoryId: string };

export class KorrekturVerfehlt extends Error {
	/**
	 * `zeilen`: die gesendeten Zeilen passen nicht zum Bestand — „Meine Fassung speichern“
	 * hilft. `status`: der Bon hat inzwischen einen anderen Status — da hilft nur Neuladen.
	 */
	constructor(
		grund: string,
		readonly art: 'zeilen' | 'status' = 'zeilen'
	) {
		super(grund);
		this.name = 'KorrekturVerfehlt';
	}
}

type Bestand = Pick<
	typeof receiptItems.$inferSelect,
	| 'id'
	| 'lineNo'
	| 'rawText'
	| 'lineType'
	| 'quantity'
	| 'unit'
	| 'unitPriceCents'
	| 'totalPriceCents'
	| 'vatClass'
	| 'categoryId'
	| 'corrected'
>;

/**
 * Hat der Mensch an dieser Zeile etwas geaendert? `corrected` wird NICHT pauschal
 * gesetzt: das Feld fuettert spaeter das Lernen (Phase 2, Aufgabe 7) — jede angesehene
 * Zeile als korrigiert zu markieren wuerde es mit Nichts trainieren. Verglichen wird
 * Feld fuer Feld gegen den Bestand; `appliesToLine` zaehlt nicht, weil ein Bezug am
 * Betrag der Zeile nichts aendert.
 */
export function hatSichGeaendert(alt: Omit<Bestand, 'id' | 'corrected'>, neu: Korrekturen['items'][number]): boolean {
	return (
		alt.lineNo !== neu.lineNo ||
		alt.rawText !== neu.rawText ||
		alt.lineType !== neu.lineType ||
		alt.quantity !== neu.quantity ||
		alt.unit !== neu.unit ||
		alt.unitPriceCents !== neu.unitPriceCents ||
		alt.totalPriceCents !== neu.totalPriceCents ||
		alt.vatClass !== neu.vatClass ||
		alt.categoryId !== neu.categoryId
	);
}

/**
 * Schreibt die Korrekturen. Immer in EINER Transaktion: geloescht, geaendert, angelegt
 * und der Kopf gehoeren zusammen — ein halb gespeicherter Bon waere schlimmer als ein
 * nicht gespeicherter.
 *
 * Zwei Regeln der Datenbank bestimmen die Reihenfolge:
 *
 * 1. UNIQUE (receipt_id, line_no) — NICHT aufschiebbar. Postgres prueft es je Zeile,
 *    sofort. Wer Zeile 1 auf 2 setzt, waehrend Zeile 2 noch 2 heisst, scheitert —
 *    obwohl der Endzustand gueltig waere. Deshalb werden alle verbleibenden Zeilen
 *    zuerst GEPARKT: line_no wird negiert. Negative Nummern kollidieren weder
 *    untereinander (die alten waren eindeutig) noch mit den neuen (die sind positiv).
 *    Erst dann bekommt jede Zeile ihre endgueltige Nummer, und neue Zeilen werden
 *    eingefuegt. Vorher wird geprueft, dass der Bestand vollstaendig abgedeckt ist —
 *    sonst bliebe eine vergessene Zeile mit negativer Nummer zurueck.
 *
 * 2. Der Self-FK (receipt_id, applies_to_line) → (receipt_id, line_no). Beim Parken
 *    werden alle Bezuege geloest, nach dem Schreiben neu gesetzt. Wuerde man sie
 *    mitschreiben, verboete der FK eine Zeile, deren Bezug gleich erst entsteht.
 */
export async function korrekturenAnwenden(
	tx: Tx,
	receiptId: string,
	k: Korrekturen,
	opts: {
		bestaetigen: boolean;
		userId: string;
		warBestaetigt?: boolean;
		/**
		 * Der Status, den der Aufrufer gelesen und geprueft hat. Der Kopf wird nur
		 * geschrieben, solange der Bon ihn noch traegt — sonst KorrekturVerfehlt. Noetig,
		 * seit auch fehlgeschlagene Bons hier ankommen: ein gleichzeitiges „Erneut lesen"
		 * setzt sie auf pending, und der Worker ueberschriebe danach die eingetippten Zeilen.
		 */
		ausStatus: (typeof receipts.$inferSelect)['status'];
		/** Vermutetes Original (originalBeimEintragen). Gesetzt: Doppel-Hinweis statt Bestaetigung. */
		doppelVon?: string | null;
		/** Bei `ueberschreiben`: wie viele Zeilen neu angelegt und wie viele geloescht wurden — fuers Protokoll. */
		beimUeberschreiben?: (z: { neu: number; geloescht: number }) => void;
	}
): Promise<Gelerntes[]> {
	/**
	 * Was ein Mensch neu einsortiert hat. Wird NICHT hier gelernt, sondern zurueckgegeben
	 * und vom Aufrufer NACH der Transaktion verarbeitet: ein abgelehntes INSERT beim
	 * Lernen wuerde diese Transaktion abbrechen, und der gefangene Fehler haette die
	 * Korrekturen mitgerissen statt nur sich selbst. Postgres kennt kein Weitermachen
	 * nach einem Fehler.
	 */
	const gelernt: Gelerntes[] = [];
	const bestand: Bestand[] = await tx
		.select({
			id: receiptItems.id,
			lineNo: receiptItems.lineNo,
			rawText: receiptItems.rawText,
			lineType: receiptItems.lineType,
			quantity: receiptItems.quantity,
			unit: receiptItems.unit,
			unitPriceCents: receiptItems.unitPriceCents,
			totalPriceCents: receiptItems.totalPriceCents,
			vatClass: receiptItems.vatClass,
			categoryId: receiptItems.categoryId,
			corrected: receiptItems.corrected
		})
		.from(receiptItems)
		.where(eq(receiptItems.receiptId, receiptId));
	const bestandNachId = new Map(bestand.map((z) => [z.id, z]));
	/**
	 * Zeilen, die beim Ueberschreiben aus einer veralteten Id neu angelegt werden. Ihre
	 * Kategorie ist nicht unbedingt von Hand — sie wird weder gelernt noch als „manual“
	 * gefuehrt (Abschlusspruefung 0.13.0, I6).
	 */
	const ausVeraltet = new Set<object>();

	if (k.ueberschreiben) {
		// Die Fassung der Seite gilt: unbekannte Ids werden neue Zeilen, nicht erwaehnte
		// Bestandszeilen fallen weg, „geaendert und geloescht“ gilt als geaendert. Der Status
		// bleibt unten hart geprueft — ein inzwischen bestaetigter Bon wird nie ueberschrieben.
		const items = k.items.map((i) => {
			if (i.id === null || bestandNachId.has(i.id)) return i;
			const neu = { ...i, id: null };
			ausVeraltet.add(neu);
			return neu;
		});
		const bleibt = new Set(items.flatMap((i) => (i.id === null ? [] : [i.id])));
		const weg = bestand.filter((z) => !bleibt.has(z.id)).map((z) => z.id);
		opts.beimUeberschreiben?.({ neu: items.filter((i) => i.id === null).length, geloescht: weg.length });
		k = { ...k, items, geloescht: weg };
	}

	const gesendet = new Set(k.items.flatMap((i) => (i.id === null ? [] : [i.id])));
	const geloescht = new Set(k.geloescht);

	for (const i of k.items) {
		if (i.id !== null && !bestandNachId.has(i.id)) {
			throw new KorrekturVerfehlt(`Die Zeile ${i.id} gehört nicht zu diesem Bon oder ist inzwischen weg.`);
		}
	}
	for (const id of geloescht) {
		if (gesendet.has(id)) throw new KorrekturVerfehlt(`Die Zeile ${id} soll zugleich geändert und gelöscht werden.`);
		if (!bestandNachId.has(id)) throw new KorrekturVerfehlt(`Die zu löschende Zeile ${id} gehört nicht zu diesem Bon.`);
	}
	for (const z of bestand) {
		if (!gesendet.has(z.id) && !geloescht.has(z.id)) {
			throw new KorrekturVerfehlt(`Die Zeile ${z.lineNo} des Bons fehlt in den Korrekturen — weder geändert noch gelöscht.`);
		}
	}

	if (k.geloescht.length > 0) {
		await tx
			.delete(receiptItems)
			.where(and(eq(receiptItems.receiptId, receiptId), inArray(receiptItems.id, k.geloescht)));
	}

	// Parken und Bezuege loesen — siehe Kommentar oben.
	await tx
		.update(receiptItems)
		.set({ appliesToLine: null, lineNo: sql`-${receiptItems.lineNo}` })
		.where(eq(receiptItems.receiptId, receiptId));

	for (const i of k.items) {
		const werte = {
			lineNo: i.lineNo,
			rawText: i.rawText,
			lineType: i.lineType,
			quantity: i.quantity,
			unit: i.unit,
			unitPriceCents: i.unitPriceCents,
			totalPriceCents: i.totalPriceCents,
			vatClass: i.vatClass,
			categoryId: i.categoryId
		};
		if (i.id === null) {
			// Eine von Hand angelegte Zeile traegt ihre Kategorie von Hand — eine aus einer
			// veralteten Id neu angelegte nicht unbedingt (ausVeraltet).
			const vonHand = i.categoryId !== null && !ausVeraltet.has(i);
			if (vonHand) gelernt.push({ rawText: i.rawText, categoryId: i.categoryId! });
			await tx.insert(receiptItems).values({
				receiptId,
				...werte,
				...(vonHand ? { categorySource: 'manual' as const } : {}),
				corrected: true
			});
			continue;
		}
		const alt = bestandNachId.get(i.id)!;
		// Hat ein Mensch die Kategorie geaendert, traegt die Zeile das auch: sonst ist
		// eine menschliche Zuordnung von einer geratenen nicht zu unterscheiden — und
		// genau diese Unterscheidung ist die Grundlage des Lernens (Phase 2, Aufgabe 7)
		// und der Schutz davor, dass ein Nachlauf sie ueberschreibt.
		const kategorieGeaendert = alt.categoryId !== i.categoryId;
		if (kategorieGeaendert && i.categoryId !== null) {
			gelernt.push({ rawText: i.rawText, categoryId: i.categoryId });
		}
		const getroffen = await tx
			.update(receiptItems)
			.set({
				...werte,
				...(kategorieGeaendert ? { categorySource: 'manual' as const, confidence: null } : {}),
				corrected: alt.corrected || hatSichGeaendert(alt, i)
			})
			.where(and(eq(receiptItems.id, i.id), eq(receiptItems.receiptId, receiptId)))
			.returning({ id: receiptItems.id });
		// Wettlauf zwischen dem Lesen des Bestands und dem Schreiben — jemand anderes
		// hat die Zeile gerade entfernt. Nicht still weitermachen.
		if (getroffen.length !== 1) {
			throw new KorrekturVerfehlt(`Die Zeile ${i.id} ist zwischen Laden und Speichern verschwunden.`);
		}
	}

	for (const i of k.items.filter((x) => x.appliesToLine !== null)) {
		await tx
			.update(receiptItems)
			.set({ appliesToLine: i.appliesToLine })
			.where(and(eq(receiptItems.receiptId, receiptId), eq(receiptItems.lineNo, i.lineNo)));
	}

	const merchantId = await haendlerAufloesen(k.receipt.merchantNameRaw, tx);
	// Ein von Hand eingetragener, vorher fehlgeschlagener Bon: beim Bestaetigen bestaetigt,
	// beim blossen Speichern ein Bon in Pruefung. Der alte Fehlergrund stimmt dann nicht mehr.
	const ausFehlschlag = opts.ausStatus === 'failed';
	const kopfGetroffen = await tx
		.update(receipts)
		.set({
			merchantId,
			merchantNameRaw: k.receipt.merchantNameRaw,
			purchasedAt: parseBonZeit(k.receipt.purchasedAt),
			totalGrossCents: k.receipt.totalGrossCents,
			paymentMethod: k.receipt.paymentMethod,
			...(opts.bestaetigen
				? { status: 'confirmed' as const, confirmedAt: new Date(), confirmedBy: opts.userId }
				: ausFehlschlag
					? { status: 'review' as const }
					: {}),
			...(ausFehlschlag ? { failureReason: null } : {}),
			// Wer bestaetigt oder einen Fehlschlag von Hand eintraegt, hat entschieden, dass es ein
			// Bon ist: der Kein-Bon-Hinweis faellt weg (Pruefung 27.09.2026). Der Doppel-Hinweis
			// darunter ersetzt die Liste, wenn es einen gibt.
			...(opts.bestaetigen || ausFehlschlag
				? {
						needsReviewReason: sql`nullif(${receipts.needsReviewReason} - 'kein_bon_leer'::text - 'kein_bon_ohne_preise'::text - 'kein_bon_kartenbeleg'::text, '[]'::jsonb)`
					}
				: {}),
			...(opts.doppelVon ? { vermutetesOriginalId: opts.doppelVon, needsReviewReason: [DOPPEL_GRUND] } : {}),
			/**
			 * Die Sichtbarkeit folgt dem Schalter — aber nur in zwei Faellen:
			 *
			 * 1. beim Bestaetigen. Das ist der Moment, in dem ein Mensch den Bon gesehen
			 *    hat; vorher waere Teilen eine Behauptung ueber etwas Ungeprueftes.
			 * 2. beim erneuten Speichern eines bereits bestaetigten Bons. Sonst koennte
			 *    man einen Bon nicht nachtraeglich privat stellen, wenn einem erst
			 *    hinterher auffaellt, was darauf steht.
			 *
			 * Beim blossen Zwischenspeichern eines ungeprueften Bons bleibt sie
			 * unberuehrt: er ist dann ohnehin 'privat', und ein 'geteilt' hier wuerde
			 * genau die Regel aushebeln, fuer die es die Spalte gibt.
			 */
			...(opts.bestaetigen || opts.warBestaetigt
				? { sichtbarkeit: k.receipt.privatBehalten ? ('privat' as const) : ('geteilt' as const) }
				: {}),
			/**
			 * Der VORSATZ wird immer mitgeschrieben, auch beim blossen Zwischenspeichern.
			 *
			 * Sonst ging er beim Klick auf „Spaeter" verloren: der Bon blieb zwar privat
			 * (das ist er als ungepruefter ohnehin), aber die Entscheidung war weg, der
			 * Schalter stand beim Wiederoeffnen wieder aus, und das naechste Bestaetigen
			 * teilte den Bon (Befund R22). `sichtbarkeit` sagt, was jetzt gilt; diese
			 * Spalte sagt, was beim Bestaetigen gelten soll.
			 */
			privatGewuenscht: k.receipt.privatBehalten
		})
		.where(and(eq(receipts.id, receiptId), eq(receipts.status, opts.ausStatus)))
		.returning({ id: receipts.id });
	if (kopfGetroffen.length !== 1) {
		throw new KorrekturVerfehlt('Der Bon hat sich zwischen Laden und Speichern geändert.', 'status');
	}

	return gelernt;
}

/**
 * Doppel-Pruefung fuer einen von Hand eingetragenen Fehlschlag. Beim ausgelesenen Bon
 * hat das der Worker erledigt; ein fehlgeschlagener hatte keine Summe und war deshalb nie
 * Kandidat (bons/doppelt.ts). Genau er ist aber oft das erste, angeschnittene Foto eines
 * Bons, der danach noch einmal fotografiert und bestaetigt wurde.
 *
 * VOR der Transaktion und wirft nie: wie beim Worker faellt bei einem Fehler nur der
 * Hinweis weg, der Bon wird deshalb nicht abgewiesen.
 */
export async function originalBeimEintragen(
	receipt: { id: string; status: string },
	k: Korrekturen
): Promise<string | null> {
	if (receipt.status !== 'failed') return null;
	try {
		return await originalFuerNeuenBon(db, receipt.id, parseBonZeit(k.receipt.purchasedAt), k.receipt.totalGrossCents);
	} catch (err) {
		const meldung = err instanceof Error ? err.message : String(err);
		console.error(`[korrekturen] Doppel-Suche für Bon ${receipt.id} fehlgeschlagen, Bon läuft ohne Hinweis weiter: ${meldung}`);
		return null;
	}
}

/**
 * Was ein Mensch neu einsortiert hat, ins Lerngedaechtnis uebernehmen.
 *
 * Laeuft NACH der Transaktion und wirft nie: der Bon ist gespeichert, und eine
 * gescheiterte Lernregel darf daran nichts mehr aendern. Geteilt zwischen PUT und
 * POST .../confirm — vorher an beiden Stellen wortgleich dupliziert.
 */
export async function lernenNachtragen(receiptId: string, gelernt: Gelerntes[]) {
	if (gelernt.length === 0) return;
	const [bon] = await db
		.select({
			householdId: receipts.householdId,
			merchantId: receipts.merchantId,
			sichtbarkeit: receipts.sichtbarkeit
		})
		.from(receipts)
		.where(eq(receipts.id, receiptId));
	if (!bon) return;

	/**
	 * Aus PRIVATEN Bons wird nicht gelernt.
	 *
	 * `lerneAusKorrektur` schreibt Produktnamen nach `products` — und die sind pro
	 * HAUSHALT sichtbar, nicht pro Person. Ein privater Bon mit „Verlobungsring" erzeugte
	 * sonst einen Eintrag, den alle im Haushalt sehen: das Geheimnis waere weg, obwohl der
	 * Bon selbst verborgen bleibt. Was privat ist, lehrt nichts.
	 *
	 * Der Preis ist ein bisschen Erkennungsqualitaet. Der Preis der Alternative waere das
	 * Feature selbst.
	 *
	 * Die Pruefung steht hier und NICHT in lerneAusKorrektur: die Lernfunktion weiss
	 * nichts von Sichtbarkeit und soll auch nichts davon wissen — sie bekommt Rohtext und
	 * Kategorie und macht daraus eine Regel.
	 */
	if (bon.sichtbarkeit === 'privat') return;

	for (const g of gelernt) {
		await lerneAusKorrektur({
			householdId: bon.householdId,
			merchantId: bon.merchantId,
			rawText: g.rawText,
			categoryId: g.categoryId
		});
	}
}
