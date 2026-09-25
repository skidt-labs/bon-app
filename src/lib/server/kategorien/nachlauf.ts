import { and, count, eq, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, receiptItems, receipts } from '$lib/server/db/schema';
import { SONSTIGES_UNSORTIERT_SLUG } from './baum';
import { bonEinsortieren, type EinsortierErgebnis } from './einsortieren';
import type { ModellDeps } from './modell';

/**
 * Der Nachlauf ueber den Bestand: Bons, die schon da waren, bevor es die Kaskade gab,
 * bekommen ihre Kategorien nachtraeglich.
 *
 * Er fasst NUR leere Kategorien an (`nurLeere`), nie gesetzte — eine Zuordnung, die ein
 * Mensch getroffen hat, ist die Wahrheit, gegen die spaeter gemessen wird, und darf von
 * keinem Nachlauf ueberschrieben werden.
 *
 * Bon fuer Bon, nicht alles auf einmal: jeder Bon ist ein eigener Modellaufruf, und ein
 * Fehler bei einem darf die uebrigen nicht mitnehmen. Der Bericht sagt hinterher, was
 * wo passiert ist.
 */
export type NachlaufBericht = {
	bons: number;
	ausGedaechtnis: number;
	vomModell: number;
	unsortiert: number;
	fehler: { receiptId: string; grund: string }[];
	verworfeneSlugs: Record<string, number>;
};

export async function offeneBons(householdId?: string): Promise<string[]> {
	// Dieselbe Auswahl wie in bonEinsortieren: ohne Kategorie, oder auf „Unsortiert"
	// gefallen ohne Quelle. Eine andere Auswahl hier hiesse, Bons zu besuchen, an denen
	// es nichts zu tun gibt — oder welche auszulassen, an denen es etwas gaebe.
	const [u] = await db
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.slug, SONSTIGES_UNSORTIERT_SLUG));
	const offen = u
		? or(
				isNull(receiptItems.categoryId),
				and(eq(receiptItems.categoryId, u.id), isNull(receiptItems.categorySource))
			)
		: isNull(receiptItems.categoryId);
	const zeilen = await db
		.selectDistinct({ id: receipts.id })
		.from(receipts)
		.innerJoin(receiptItems, eq(receiptItems.receiptId, receipts.id))
		.where(householdId ? and(eq(receipts.householdId, householdId), offen) : offen)
		.orderBy(receipts.id);
	return zeilen.map((z) => z.id);
}

export async function nachlaufStarten(
	modell: ModellDeps,
	opts: { householdId?: string; melden?: (id: string, e: EinsortierErgebnis) => void } = {}
): Promise<NachlaufBericht> {
	const bericht: NachlaufBericht = {
		bons: 0,
		ausGedaechtnis: 0,
		vomModell: 0,
		unsortiert: 0,
		fehler: [],
		verworfeneSlugs: {}
	};

	for (const id of await offeneBons(opts.householdId)) {
		const e = await bonEinsortieren(id, modell, { nurLeere: true });
		bericht.bons++;
		bericht.ausGedaechtnis += e.ausGedaechtnis;
		bericht.vomModell += e.vomModell;
		bericht.unsortiert += e.unsortiert;
		if (e.fehler) bericht.fehler.push({ receiptId: id, grund: e.fehler });
		// Was das Modell erfinden WOLLTE, gezaehlt: schlaegt es dieselbe Kategorie immer
		// wieder vor, gehoert sie vermutlich in den Baum.
		for (const v of e.verworfen) {
			bericht.verworfeneSlugs[v.slug] = (bericht.verworfeneSlugs[v.slug] ?? 0) + 1;
		}
		opts.melden?.(id, e);
	}
	return bericht;
}

/** Wie viele Positionen ueberhaupt noch ohne Kategorie sind — fuer Vorher/Nachher. */
export async function ohneKategorie(): Promise<number> {
	const [{ n }] = await db
		.select({ n: count() })
		.from(receiptItems)
		.where(isNull(receiptItems.categoryId));
	return Number(n);
}

