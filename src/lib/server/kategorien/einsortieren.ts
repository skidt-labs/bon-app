import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, receiptItems, receipts } from '$lib/server/db/schema';
import { ordneAusGedaechtnis, type Zuordnung } from './kaskade';
import { ordneMitModell, type ModellDeps } from './modell';
import { SONSTIGES_UNSORTIERT_SLUG } from './baum';
import type { ExtractionUsage } from '$lib/server/extraction/types';

/**
 * Einen Bon einsortieren: Lerngedaechtnis (Aufgabe 5), dann Modell (Aufgabe 6), dann
 * schreiben. Eine Stelle fuer beide Wege — den Worker beim Auslesen und den Nachlauf
 * ueber den Bestand; zwei Fassungen wuerden auseinanderlaufen.
 *
 * Laeuft AUSSERHALB der Speicher-Transaktion des Bons, nicht darin: der Modellaufruf
 * dauert Sekunden, und eine Transaktion, die so lange offen steht, haelt eine
 * Verbindung und Sperren fest. Der Bon ist zu diesem Zeitpunkt bereits gespeichert —
 * die Kategorien kommen danach dazu.
 *
 * WIRFT NIE. Eine Kategorie ist wuenschenswert, ein Bon ist unverzichtbar: schlaegt das
 * Modell fehl, bleiben die offenen Zeilen auf „Unsortiert" und der Bon geht normal in
 * die Pruefung. Was dabei schiefging, steht im Ergebnis, statt zu verschwinden.
 */
export type EinsortierErgebnis = {
	/** Zeilen, die aus dem Gedaechtnis kamen (Regel oder gelernter Alias). */
	ausGedaechtnis: number;
	/** Zeilen, die das Modell zugeordnet hat. */
	vomModell: number;
	/** Zeilen, die auf Unsortiert gefallen sind. */
	unsortiert: number;
	/** Was das Modell vorschlug, das es nicht gibt. */
	verworfen: { itemId: string; slug: string }[];
	/** Warum das Modell nichts beitragen konnte. null = es lief. */
	fehler: string | null;
	usage: ExtractionUsage;
};

const LEER: EinsortierErgebnis = {
	ausGedaechtnis: 0,
	vomModell: 0,
	unsortiert: 0,
	verworfen: [],
	fehler: null,
	usage: null
};

export async function bonEinsortieren(
	receiptId: string,
	modell: ModellDeps,
	opts: { nurLeere?: boolean } = {}
): Promise<EinsortierErgebnis> {
	try {
		const [bon] = await db
			.select({ householdId: receipts.householdId, merchantId: receipts.merchantId })
			.from(receipts)
			.where(eq(receipts.id, receiptId));
		if (!bon) return LEER;

		const [unsortiertZeile] = await db
			.select({ id: categories.id })
			.from(categories)
			.where(eq(categories.slug, SONSTIGES_UNSORTIERT_SLUG));
		const unsortiertId = unsortiertZeile?.id ?? null;

		/**
		 * Die Voreinstellung fasst NUR an, was die Maschine offen gelassen hat: Zeilen
		 * ohne Kategorie, und solche, die auf „Unsortiert" gefallen sind, OHNE dass eine
		 * Quelle daran steht. Alles andere bleibt unberuehrt — eine Zuordnung durch eine
		 * feste Regel (`rule`), durch das Modell (`llm`) oder durch einen Menschen
		 * (`manual`) ist eine Aussage, und ein Nachlauf ueberschreibt keine Aussagen.
		 *
		 * `nurLeere: false` nimmt alles, auch Gesetztes — fuer den Fall, dass man einen
		 * Bon absichtlich neu einsortieren will.
		 */
		const offenerBestand =
			unsortiertId === null
				? isNull(receiptItems.categoryId)
				: or(
						isNull(receiptItems.categoryId),
						and(eq(receiptItems.categoryId, unsortiertId), isNull(receiptItems.categorySource))
					);
		const zeilen = await db
			.select({
				id: receiptItems.id,
				rawText: receiptItems.rawText,
				lineType: receiptItems.lineType
			})
			.from(receiptItems)
			.where(
				opts.nurLeere === false
					? eq(receiptItems.receiptId, receiptId)
					: and(eq(receiptItems.receiptId, receiptId), offenerBestand)
			);
		if (zeilen.length === 0) return LEER;

		const { zugeordnet, offen } = await ordneAusGedaechtnis(zeilen, bon.merchantId, bon.householdId);

		// Der Modellaufruf darf den Bon nicht mitreissen — dieselbe Regel wie bei
		// haendlerAufloesen im Worker.
		let vorschlaege: Record<string, string> = {};
		let verworfen: { itemId: string; slug: string }[] = [];
		let fehler: string | null = null;
		let usage: ExtractionUsage = null;
		try {
			const m = await ordneMitModell(offen, modell);
			vorschlaege = m.vorschlaege;
			verworfen = m.verworfen;
			fehler = m.fehler;
			usage = m.usage;
		} catch (err) {
			fehler = err instanceof Error ? err.message : String(err);
		}

		// Slugs in echte Ids aufloesen — categories.id ist defaultRandom(), keine Konstante.
		const gebrauchteSlugs = [...new Set([...Object.values(vorschlaege), SONSTIGES_UNSORTIERT_SLUG])];
		const idJeSlug = new Map(
			(
				await db
					.select({ slug: categories.slug, id: categories.id })
					.from(categories)
					.where(inArray(categories.slug, gebrauchteSlugs))
			).map((z) => [z.slug, z.id])
		);
		const schreiben: Zuordnung[] = [...zugeordnet];
		let vomModell = 0;
		let unsortiert = 0;
		for (const z of offen) {
			const slug = vorschlaege[z.id];
			const catId = slug ? (idJeSlug.get(slug) ?? null) : null;
			if (catId) {
				vomModell++;
				schreiben.push({ itemId: z.id, productId: null, categoryId: catId, source: 'llm', confidence: 60 });
			} else {
				unsortiert++;
				// Konfidenz null, nicht 0: „keine Aussage" ist eine Leerstelle, und die
				// Pruefansicht soll diese Zeilen als unsicher behandeln koennen.
				schreiben.push({ itemId: z.id, productId: null, categoryId: unsortiertId, source: 'none', confidence: null });
			}
		}

		for (const s of schreiben) {
			await db
				.update(receiptItems)
				.set({
					categoryId: s.categoryId,
					categorySource: s.source === 'none' ? null : s.source,
					confidence: s.confidence,
					productId: s.productId
				})
				.where(eq(receiptItems.id, s.itemId));
		}

		return { ausGedaechtnis: zugeordnet.length, vomModell, unsortiert, verworfen, fehler, usage };
	} catch (err) {
		// Auch das Laden oder Schreiben darf den Aufrufer nicht mitreissen.
		return { ...LEER, fehler: err instanceof Error ? err.message : String(err) };
	}
}
