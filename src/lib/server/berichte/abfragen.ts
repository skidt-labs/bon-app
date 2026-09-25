import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { db as Db } from '$lib/server/db';
import {
	budgets,
	budgetBetraege,
	budgetKategorien,
	categories,
	merchants,
	receipts,
	receiptItems
} from '$lib/server/db/schema';
import { budgetsFuerMonat } from '$lib/server/budgets/aufloesung';
import { monatszahlenLaden } from './monatszahlen';
import {
	nachHaendler,
	nachKategorie,
	budgetstand,
	direkteCentsJeKategorie,
	passendePositionen,
	kategorienAufloesen,
	summeJeBon,
	vergleichMit,
	verlaufRechnen,
	budgetImJahr,
	type BudgetJahr,
	type BudgetStand,
	type KategorieKnoten,
	type PostenZeile
} from './rechnung';
import { tagesgrenzen } from '$lib/server/zeit';
import { sichtbareBons, sichtbareToepfe } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { budgetsNichtZeigbar, zeitraumTage, type BerichtFilter } from '$lib/berichte/filter';
import { ladeFenster, vergleichsZeitraeume, verlaufsAchse } from '$lib/berichte/zeitleiste';
import { monatVon } from '$lib/berichte/kalender';
import type { CsvZeile } from './csv';

/** Kaufzeit, ersatzweise Eingang — dieselbe Regel wie in bons/liste.ts. */
export const wann = sql<Date>`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`;
/** Der Berliner Kalendertag des Bons, 'YYYY-MM-DD'. */
export const alsTag = sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`;
const alsMonat = sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM')`;

/**
 * Welche Bons ein Bericht ueberhaupt betrachtet: was dieser Mensch sehen darf, darin
 * eingeschraenkt auf Umfang und Laden. Der Filter schraenkt nur EIN — sichtbareBons steht
 * immer vorn, und nichts hier kann es erweitern.
 */
export function bonBedingung(k: Zugriffskontext, f: Pick<BerichtFilter, 'umfang' | 'laden'>): SQL {
	return and(
		sichtbareBons(k),
		f.umfang === 'meine' ? eq(receipts.uploadedBy, k.nutzerId) : undefined,
		f.laden.length > 0 ? inArray(receipts.merchantId, f.laden) : undefined
	)!;
}

type BerichtsBon = {
	id: string;
	tag: string;
	cents: number | null;
	sichtbarkeit: 'geteilt' | 'privat';
	haendlerId: string | null;
	haendler: string | null;
};
type Position = PostenZeile & { receiptId: string };

/**
 * Ausgaben je EINZELNER Kategorie, getrennt nach geteilt/privat — daraus summiert der
 * Budgetstand seine Toepfe (siehe direkteCentsJeKategorie und budgetstand).
 */
function centsJeSicht(positionen: Position[], bons: BerichtsBon[], kategorien: KategorieKnoten[]) {
	const geteilt = new Set(bons.filter((b) => b.sichtbarkeit === 'geteilt').map((b) => b.id));
	return {
		geteilt: direkteCentsJeKategorie(nachKategorie(positionen.filter((p) => geteilt.has(p.receiptId)), kategorien)),
		privat: direkteCentsJeKategorie(nachKategorie(positionen.filter((p) => !geteilt.has(p.receiptId)), kategorien))
	};
}

export type BudgetAnzeige =
	| { art: 'monat'; liste: BudgetStand[] }
	| { art: 'jahr'; liste: BudgetJahr[] }
	| { art: 'keine'; grund: string };

/**
 * Alles, was ein Bericht braucht — aus EINEM Zeitfenster geladen (Zeitraum, Vergleiche,
 * Verlauf) und mit den reinen Funktionen aus rechnung.ts gerechnet.
 *
 * Die KOPFZAHL: ohne Positionsfilter die gedruckten Bonsummen (`total_gross_cents`), mit
 * Kategoriefilter die Summe der passenden Positionen. Weicht die Positionssumme von den
 * gedruckten Summen ab, steht das als `differenzCents` im Ergebnis — ein Befund, keine
 * Ungenauigkeit.
 *
 * Das Fenster hat eine obere UND eine untere Grenze aus festen Zeitpunkten (Bewertung
 * 25.09.2026: vorher nur eine untere, ueber to_char verglichen).
 */
export async function berichtLaden(db: typeof Db, k: Zugriffskontext, filter: BerichtFilter, heute: string) {
	const z = filter.zeitraum;
	const tage = zeitraumTage(z);
	const fenster = ladeFenster(z, heute);
	const grenzen = tagesgrenzen(fenster.von, fenster.bis);
	if (!grenzen) throw new Error(`Unbrauchbares Ladefenster ${fenster.von}–${fenster.bis}`);
	const hinweise: string[] = [];

	const [kategorien, laeden] = await Promise.all([
		db
			.select({ id: categories.id, name: categories.name, parentId: categories.parentId, slug: categories.slug })
			.from(categories)
			.orderBy(asc(categories.sort), asc(categories.name)),
		filter.laden.length === 0
			? Promise.resolve([] as { id: string; name: string }[])
			: db.select({ id: merchants.id, name: merchants.name }).from(merchants).where(inArray(merchants.id, filter.laden))
	]);
	if (laeden.length < filter.laden.length) hinweise.push('Einen der gewählten Läden gibt es nicht (mehr).');
	const aufgeloest = kategorienAufloesen(filter.kategorie, kategorien);
	for (const s of aufgeloest.unbekannt) hinweise.push(`Die Kategorie „${s}" gibt es nicht — ignoriert.`);
	const positionsfilter = aufgeloest.ids.size > 0;

	const [bons, toepfe, betraege, zuordnungen, zahlen, summenJeMonat] = await Promise.all([
		db
			.select({
				id: receipts.id,
				tag: alsTag,
				cents: receipts.totalGrossCents,
				sichtbarkeit: receipts.sichtbarkeit,
				haendlerId: receipts.merchantId,
				haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`
			})
			.from(receipts)
			.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
			.where(and(bonBedingung(k, filter), eq(receipts.status, 'confirmed'), gte(wann, grenzen.von), lt(wann, grenzen.bis))),
		db
			.select({ id: budgets.id, name: budgets.name, sichtbarkeit: budgets.sichtbarkeit, geloeschtAb: budgets.geloeschtAb })
			.from(budgets)
			.where(sichtbareToepfe(k)),
		db
			.select({ budgetId: budgetBetraege.budgetId, giltAb: budgetBetraege.giltAb, amountCents: budgetBetraege.amountCents })
			.from(budgetBetraege)
			.innerJoin(budgets, eq(budgets.id, budgetBetraege.budgetId))
			.where(sichtbareToepfe(k)),
		db
			// Nur die Zuordnungen SICHTBARER Toepfe (Befund R20), mit Eigentuemer.
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
		// Der Vorbehalt: was noch ungeprueft danebenliegt — ueber alle Monate.
		monatszahlenLaden(db, k, monatVon(heute)),
		// Betraege je Monat fuer die Kacheln der Zeitwahl: nur Umfang, ohne weitere Filter.
		db
			.select({ monat: alsMonat, cents: sql<number>`coalesce(sum(${receipts.totalGrossCents}), 0)::int` })
			.from(receipts)
			.where(and(bonBedingung(k, { umfang: filter.umfang, laden: [] }), eq(receipts.status, 'confirmed')))
			.groupBy(alsMonat)
	]);

	const imZeitraum = (b: { tag: string }, r: { von: string; bis: string }) => b.tag >= r.von && b.tag <= r.bis;
	// Positionen: fuer die Aufschluesselung nur die Bons des Zeitraums; mit Kategoriefilter
	// alle geladenen, weil dann auch Vergleiche und Verlauf aus Positionen rechnen. Ohne
	// Bons keine Abfrage — ein leeres inArray() ist in SQL ein Syntaxfehler.
	const positionsBons = positionsfilter ? bons : bons.filter((b) => imZeitraum(b, tage));
	const positionen: Position[] =
		positionsBons.length === 0
			? []
			: await db
					.select({
						receiptId: receiptItems.receiptId,
						categoryId: receiptItems.categoryId,
						lineType: sql<string>`${receiptItems.lineType}`,
						totalPriceCents: receiptItems.totalPriceCents
					})
					.from(receiptItems)
					.where(inArray(receiptItems.receiptId, positionsBons.map((b) => b.id)));

	const treffer = positionsfilter ? passendePositionen(positionen, aufgeloest.ids) : null;
	const jeBon = treffer ? summeJeBon(treffer) : null;
	// Mit Kategoriefilter zaehlt ein Bon nur, wenn er mindestens eine passende Position hat.
	const gezaehlt = jeBon ? bons.filter((b) => jeBon.has(b.id)) : bons;
	const wert = (b: BerichtsBon) => (jeBon ? (jeBon.get(b.id) ?? 0) : (b.cents ?? 0));

	const haupt = gezaehlt.filter((b) => imZeitraum(b, tage));
	const hauptIds = new Set(haupt.map((b) => b.id));
	const hauptPositionen = (treffer ?? positionen).filter((p) => hauptIds.has(p.receiptId));
	const summe = haupt.reduce((s, b) => s + wert(b), 0);
	const kategorienPosten = nachKategorie(hauptPositionen, kategorien);
	const ausPositionen = kategorienPosten.reduce((s, p) => s + p.cents, 0);
	const achse = verlaufsAchse(z, heute);

	const grund = budgetsNichtZeigbar(filter);
	let budgetAnzeige: BudgetAnzeige;
	if (grund !== null) {
		budgetAnzeige = { art: 'keine', grund };
	} else {
		const standIm = (monat: string): BudgetStand[] => {
			const bonsDesMonats = haupt.filter((b) => b.tag.startsWith(monat));
			const ids = new Set(bonsDesMonats.map((b) => b.id));
			const erster = `${monat}-01`;
			// Ein geloeschter Topf verschwindet erst ab dem Monat seiner Loeschung.
			const gueltig = toepfe.filter((t) => t.geloeschtAb === null || t.geloeschtAb > erster);
			const aufl = budgetsFuerMonat(gueltig, betraege, zuordnungen, kategorien, monat);
			return budgetstand(aufl.budgets, centsJeSicht(hauptPositionen.filter((p) => ids.has(p.receiptId)), bonsDesMonats, kategorien));
		};
		budgetAnzeige =
			z.art === 'monat'
				? { art: 'monat', liste: standIm(z.monat) }
				: { art: 'jahr', liste: budgetImJahr(achse.filter((a) => !a.offen).map((a) => standIm(a.monat))) };
	}

	const slugVon = new Map(kategorien.map((c) => [c.id, c.slug]));
	return {
		hinweise,
		kennzahlen: { summe, bons: haupt.length, schnitt: haupt.length === 0 ? 0 : Math.round(summe / haupt.length) },
		vergleiche: vergleichsZeitraeume(z, heute).map((r) =>
			vergleichMit(summe, r.bezeichnung, gezaehlt.filter((b) => imZeitraum(b, r)).map(wert))
		),
		kategorien: kategorienPosten.map((p) => ({
			...p,
			slug: p.id === null ? null : (slugVon.get(p.id) ?? null),
			kinder: p.kinder.map((kind) => ({ ...kind, slug: slugVon.get(kind.id) ?? null }))
		})),
		haendler: nachHaendler(haupt.map((b) => ({ haendlerId: b.haendlerId, haendler: b.haendler, cents: wert(b) }))),
		verlauf: verlaufRechnen(gezaehlt.map((b) => ({ monat: b.tag.slice(0, 7), cents: wert(b) })), achse, z.art === 'jahr'),
		budgets: budgetAnzeige,
		/** Positionssumme minus gedruckte Endsummen. 0 = einig (mit Kategoriefilter nicht sinnvoll: 0). */
		differenzCents: positionsfilter ? 0 : ausPositionen - summe,
		/** Bons ohne gelesene Endsumme — sie zaehlen als Bon, aber nicht als Betrag. */
		ohneBetrag: positionsfilter ? 0 : haupt.filter((b) => b.cents === null).length,
		rueckstand: zahlen.rueckstand,
		monatsSummen: Object.fromEntries(summenJeMonat.map((s) => [s.monat, s.cents])) as Record<string, number>
	};
}

/**
 * Eine Zeile je Position, fuer den CSV-Export eines Monats — nur bestaetigte Bons, wie
 * im Bericht: was noch niemand geprueft hat, ist keine Zahl, mit der man rechnen sollte.
 *
 * `grenzen.bis` ist AUSSCHLIESSLICH (so liefert es monatsgrenzen): Bis 0.3.2 stand hier
 * `<=`, und ein Bon um genau 00:00 Uhr am Ersten landete in zwei Monatsexporten.
 */
export async function exportZeilenLaden(
	db: typeof Db,
	k: Zugriffskontext,
	grenzen: { von: Date; bis: Date }
): Promise<CsvZeile[]> {
	const ober = alias(categories, 'ober');
	const wann = sql<Date>`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`;

	return db
		.select({
			datum: sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`,
			haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`,
			bonId: receipts.id,
			lineNo: receiptItems.lineNo,
			rawText: receiptItems.rawText,
			lineType: sql<string>`${receiptItems.lineType}`,
			quantity: receiptItems.quantity,
			unit: receiptItems.unit,
			unitPriceCents: receiptItems.unitPriceCents,
			totalPriceCents: receiptItems.totalPriceCents,
			kategorie: categories.name,
			oberkategorie: ober.name
		})
		.from(receiptItems)
		.innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
		.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
		.leftJoin(categories, eq(categories.id, receiptItems.categoryId))
		.leftJoin(ober, eq(ober.id, categories.parentId))
		.where(and(sichtbareBons(k), eq(receipts.status, 'confirmed'), gte(wann, grenzen.von), lt(wann, grenzen.bis)))
		.orderBy(asc(wann), asc(receipts.id), asc(receiptItems.lineNo));
}
