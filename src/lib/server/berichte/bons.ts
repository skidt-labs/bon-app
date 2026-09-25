import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { categories, merchants, receipts, receiptItems } from '$lib/server/db/schema';
import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import { tagesgrenzen } from '$lib/server/zeit';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { zeitraumTage, type BerichtFilter } from '$lib/berichte/filter';
import { alsTag, bonBedingung, wann } from './abfragen';
import { kategorienAufloesen, passendePositionen } from './rechnung';

export type BonZeile = {
	id: string;
	tag: string;
	haendler: string | null;
	/** Nur eigene Bons koennen privat UND sichtbar sein — der Chip sagt „nur du siehst ihn". */
	privat: boolean;
	gesamtCents: number | null;
	/** null = Bon ohne erkannte Endsumme (nur ohne Kategoriefilter) — eine Leerstelle, keine 0. */
	passendCents: number | null;
	passende: { rawText: string; cents: number; kategorie: string | null }[];
};

export type BonsZuFilter = {
	hinweise: string[];
	titel: string | null;
	bons: BonZeile[];
	summe: number;
	/** Bons ohne erkannte Endsumme: sie stehen in der Liste, aber nicht in der Summe. */
	ohneBetrag: number;
	positionen: number;
	/** Ob wirklich nach Kategorie gefiltert wird (unbekannte Slugs zaehlen nicht). */
	nachKategorie: boolean;
	/** Bei einer Oberkategorie: ihre Unterkategorien mit Betrag, als Filterpillen. */
	unterkategorien: { slug: string; name: string; cents: number }[];
	/** Bei einer Unterkategorie: der Weg zurueck zur Oberkategorie. */
	oberkategorie: { slug: string; name: string } | null;
};

/**
 * „Bons zu …": die bestaetigten Bons eines Zeitraums, die zum Filter passen — mit den
 * passenden Positionen. Ohne Kategoriefilter (nur Laden) zaehlt die gedruckte Bonsumme,
 * wie in der Kopfzahl des Berichts; mit Kategoriefilter die Summe der passenden Zeilen.
 */
export async function bonsZuFilter(db: typeof Db, k: Zugriffskontext, filter: BerichtFilter): Promise<BonsZuFilter> {
	const tage = zeitraumTage(filter.zeitraum);
	const grenzen = tagesgrenzen(tage.von, tage.bis);
	if (!grenzen) throw new Error(`Unbrauchbarer Zeitraum ${tage.von}–${tage.bis}`);
	const hinweise: string[] = [];

	const [kategorien, laeden] = await Promise.all([
		db.select({ id: categories.id, name: categories.name, parentId: categories.parentId, slug: categories.slug }).from(categories),
		filter.laden.length === 0
			? Promise.resolve([] as { id: string; name: string }[])
			: db.select({ id: merchants.id, name: merchants.name }).from(merchants).where(inArray(merchants.id, filter.laden))
	]);
	if (laeden.length < filter.laden.length) hinweise.push('Einen der gewählten Läden gibt es nicht (mehr).');
	const aufgeloest = kategorienAufloesen(filter.kategorie, kategorien);
	for (const s of aufgeloest.unbekannt) hinweise.push(`Die Kategorie „${s}" gibt es nicht — ignoriert.`);
	const nachKategorie = aufgeloest.ids.size > 0;

	// Blieb von der Kategorie nichts uebrig (veraltetes Lesezeichen) und gibt es keinen
	// Laden, waere die Abfrage ungefiltert — sie zeigte ALLE Bons unter „Bons zu …".
	if (!nachKategorie && filter.laden.length === 0) {
		return {
			hinweise: [...hinweise, 'Wähle im Bericht eine Kategorie oder einen Laden.'],
			titel: null,
			bons: [],
			summe: 0,
			ohneBetrag: 0,
			positionen: 0,
			nachKategorie: false,
			unterkategorien: [],
			oberkategorie: null
		};
	}

	const titel =
		(nachKategorie
			? filter.kategorie.map((s) => kategorien.find((c) => c.slug === s)?.name).filter(Boolean).join(', ')
			: laeden.map((l) => l.name).join(', ')) || null;

	const bons = await db
		.select({
			id: receipts.id,
			tag: alsTag,
			cents: receipts.totalGrossCents,
			sichtbarkeit: receipts.sichtbarkeit,
			haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`
		})
		.from(receipts)
		.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
		.where(and(bonBedingung(k, filter), eq(receipts.status, 'confirmed'), gte(wann, grenzen.von), lt(wann, grenzen.bis)))
		.orderBy(desc(wann), asc(receipts.id));

	const positionen =
		bons.length === 0
			? []
			: await db
					.select({
						receiptId: receiptItems.receiptId,
						lineNo: receiptItems.lineNo,
						rawText: receiptItems.rawText,
						categoryId: receiptItems.categoryId,
						lineType: sql<string>`${receiptItems.lineType}`,
						totalPriceCents: receiptItems.totalPriceCents
					})
					.from(receiptItems)
					.where(inArray(receiptItems.receiptId, bons.map((b) => b.id)))
					.orderBy(asc(receiptItems.receiptId), asc(receiptItems.lineNo));

	const treffer = nachKategorie
		? passendePositionen(positionen, aufgeloest.ids)
		: positionen.filter((p) => MONETAER.includes(p.lineType as LineType));
	const jeBon = new Map<string, typeof treffer>();
	for (const p of treffer) jeBon.set(p.receiptId, [...(jeBon.get(p.receiptId) ?? []), p]);
	const kategorieName = new Map(kategorien.map((c) => [c.id, c.name]));

	const zeilen: BonZeile[] = [];
	for (const b of bons) {
		const passende = jeBon.get(b.id) ?? [];
		if (nachKategorie && passende.length === 0) continue;
		zeilen.push({
			id: b.id,
			tag: b.tag,
			haendler: b.haendler,
			privat: b.sichtbarkeit === 'privat',
			gesamtCents: b.cents,
			passendCents: nachKategorie ? passende.reduce((s, p) => s + p.totalPriceCents, 0) : b.cents,
			passende: passende.map((p) => ({
				rawText: p.rawText,
				cents: p.totalPriceCents,
				kategorie: p.categoryId === null ? null : (kategorieName.get(p.categoryId) ?? null)
			}))
		});
	}

	let unterkategorien: BonsZuFilter['unterkategorien'] = [];
	let oberkategorie: BonsZuFilter['oberkategorie'] = null;
	const gewaehlt = filter.kategorie.length === 1 ? kategorien.find((c) => c.slug === filter.kategorie[0]) : undefined;
	if (gewaehlt && gewaehlt.parentId === null) {
		const behalten = new Set(zeilen.map((z) => z.id));
		const summen = new Map<string, number>();
		for (const p of treffer) {
			if (behalten.has(p.receiptId) && p.categoryId !== null && p.categoryId !== gewaehlt.id) {
				summen.set(p.categoryId, (summen.get(p.categoryId) ?? 0) + p.totalPriceCents);
			}
		}
		unterkategorien = kategorien
			.filter((c) => c.parentId === gewaehlt.id && summen.has(c.id))
			.map((c) => ({ slug: c.slug, name: c.name, cents: summen.get(c.id)! }))
			.sort((a, b) => b.cents - a.cents);
	} else if (gewaehlt && gewaehlt.parentId !== null) {
		const eltern = kategorien.find((c) => c.id === gewaehlt.parentId);
		if (eltern) oberkategorie = { slug: eltern.slug, name: eltern.name };
	}

	return {
		hinweise,
		titel,
		bons: zeilen,
		summe: zeilen.reduce((s, z) => s + (z.passendCents ?? 0), 0),
		ohneBetrag: zeilen.filter((z) => z.passendCents === null).length,
		positionen: zeilen.reduce((s, z) => s + z.passende.length, 0),
		nachKategorie,
		unterkategorien,
		oberkategorie
	};
}
