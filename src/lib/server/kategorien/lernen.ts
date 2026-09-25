import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { products, productAliases } from '$lib/server/db/schema';
import { normalisiereRohtext } from './normalisieren';

/**
 * Aus einer Korrektur eines Menschen eine Regel machen.
 *
 * Das ist der Kern der ganzen Kategorisierung: ohne Lernen bleibt jede Zuordnung ein
 * Modellaufruf — bei jedem Bon, fuer dieselbe Butter. Mit Lernen greift nach ein paar
 * Wochen Stufe 1 fuer den Grossteil des Wagens, die Kosten gehen gegen null, und die
 * Zuordnung wird reproduzierbar statt jedes Mal neu geraten.
 *
 * WIRFT NIE. Ein Fehler beim Lernen darf das Bestaetigen eines Bons nicht scheitern
 * lassen — der Bon ist wichtiger als die gelernte Regel. Deshalb laeuft diese Funktion
 * auch AUSSERHALB der Speicher-Transaktion: ein abgelehntes INSERT wuerde eine
 * umschliessende Transaktion abbrechen, und der gefangene Fehler haette die Korrekturen
 * mitgerissen, statt nur sich selbst.
 */
export async function lerneAusKorrektur(args: {
	householdId: string;
	merchantId: string | null;
	rawText: string;
	categoryId: string;
}): Promise<void> {
	try {
		const name = args.rawText.trim();
		const schluessel = normalisiereRohtext(args.rawText);
		// Ohne Schluessel gibt es nichts wiederzuerkennen. Eine Alias-Zeile mit leerem
		// Text traefe spaeter auf jeden namenlosen Posten.
		if (name === '' || schluessel === '') return;

		// products hat KEINE Eindeutigkeitsregel auf dem Namen (nur den Primaerschluessel),
		// also erst nachsehen. Ein blindes Einfuegen legte bei jeder Korrektur desselben
		// Artikels ein weiteres Produkt an — Karteileichen, an denen spaeter Kategorien
		// haengen, die niemand mehr findet.
		const [vorhanden] = await db
			.select({ id: products.id })
			.from(products)
			.where(and(eq(products.householdId, args.householdId), eq(products.canonicalName, name)))
			.limit(1);

		let produktId = vorhanden?.id ?? null;
		if (produktId === null) {
			const [neu] = await db
				.insert(products)
				.values({
					householdId: args.householdId,
					canonicalName: name,
					defaultCategoryId: args.categoryId
				})
				.returning({ id: products.id });
			produktId = neu?.id ?? null;
		}
		// Ein Alias ohne Produkt waere eine kaputte Zeile im Gedaechtnis: er wuerde spaeter
		// gefunden und zeigte auf nichts.
		if (produktId === null) return;

		await db
			.insert(productAliases)
			.values({
				productId: produktId,
				merchantId: args.merchantId,
				rawTextNormalized: schluessel,
				createdFrom: 'manual'
			})
			// Derselbe Text beim selben Haendler ist dieselbe Regel, keine zweite: sie wird
			// ueberschrieben, und `hits` zaehlt mit, wie oft sie sich bewaehrt hat.
			.onConflictDoUpdate({
				target: [productAliases.merchantId, productAliases.rawTextNormalized],
				set: { productId: produktId, hits: sql`${productAliases.hits} + 1` }
			});
	} catch (fehler) {
		// Nur die Meldung, nie das rohe Fehlerobjekt: ein Postgres-Fehler kann
		// Verbindungsdaten mitschleppen, und in dieses Projekt darf kein Geheimnis in ein
		// Log geraten (dieselbe Regel wie bei haendlerAufloesen im Worker).
		const meldung = fehler instanceof Error ? fehler.message : String(fehler);
		console.error(`[kategorien] Lernen fehlgeschlagen, der Bon bleibt unberuehrt: ${meldung}`);
	}
}
