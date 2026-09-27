import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { merchants, receipts, receiptItems } from '$lib/server/db/schema';
import { budgetsFuerMonat } from '$lib/server/budgets/aufloesung';
import { monatszahlenLaden } from './monatszahlen';
import {
	nachHaendler,
	nachKategorie,
	budgetstand,
	direkteCentsJeKategorie,
	summeJeBon,
	vergleichMit,
	verlaufRechnen,
	budgetImJahr,
	type BudgetJahr,
	type BudgetStand,
	type KategorieKnoten,
	type PostenZeile
} from './rechnung';
import { bonPasst, kriterienAktiv, positionsTreffer, type PositionFuerFilter } from './kriterien';
import { filterAufloesen, stammdatenLaden } from './aufloesen';
import { tagesgrenzen } from '$lib/server/zeit';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { budgetsNichtZeigbar, zeitraumTage, type BerichtFilter } from '$lib/berichte/filter';
import { ladeFenster, vergleichsZeitraeume, verlaufsAchse } from '$lib/berichte/zeitleiste';
import { monatVon, monateVonBis } from '$lib/berichte/kalender';

/** Kaufzeit, ersatzweise Eingang — dieselbe Regel wie in bons/liste.ts. */
export const wann = sql<Date>`coalesce(${receipts.purchasedAt}, ${receipts.createdAt})`;
/** Der Berliner Kalendertag des Bons, 'YYYY-MM-DD'. */
export const alsTag = sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`;
const alsMonat = sql<string>`to_char(${wann} at time zone 'Europe/Berlin', 'YYYY-MM')`;

/**
 * Welche Bons ein Bericht ueberhaupt betrachtet: was dieser Mensch sehen darf, darin
 * eingeschraenkt auf den Umfang. sichtbareBons steht immer vorn; die Merkmale prueft
 * danach kriterien.ts und kann damit nur weiter einschraenken.
 */
export function bonBedingung(k: Zugriffskontext, f: Pick<BerichtFilter, 'umfang'>): SQL {
	return and(sichtbareBons(k), f.umfang === 'meine' ? eq(receipts.uploadedBy, k.nutzerId) : undefined)!;
}

/** Die bestaetigten, sichtbaren Bons eines festen Zeitfensters (bis ausschliesslich). */
export async function bonsImFenster(
	db: typeof Db,
	k: Zugriffskontext,
	f: Pick<BerichtFilter, 'umfang'>,
	grenzen: { von: Date; bis: Date }
) {
	return db
		.select({
			id: receipts.id,
			zeit: wann,
			tag: alsTag,
			cents: receipts.totalGrossCents,
			sichtbarkeit: receipts.sichtbarkeit,
			uploadedBy: receipts.uploadedBy,
			merchantId: receipts.merchantId,
			ladenName: merchants.name,
			haendler: sql<string | null>`coalesce(${merchants.name}, ${receipts.merchantNameRaw})`
		})
		.from(receipts)
		.leftJoin(merchants, eq(merchants.id, receipts.merchantId))
		.where(and(bonBedingung(k, f), eq(receipts.status, 'confirmed'), gte(wann, grenzen.von), lt(wann, grenzen.bis)));
}
export type BerichtsBon = Awaited<ReturnType<typeof bonsImFenster>>[number];

/** Die Positionen zu Bons, die vorher durch bonsImFenster gingen. Ohne Ids keine Abfrage. */
export async function positionenZu(db: typeof Db, bonIds: string[]): Promise<PositionFuerFilter[]> {
	if (bonIds.length === 0) return [];
	return db
		.select({
			receiptId: receiptItems.receiptId,
			lineNo: receiptItems.lineNo,
			rawText: receiptItems.rawText,
			categoryId: receiptItems.categoryId,
			lineType: sql<string>`${receiptItems.lineType}`,
			totalPriceCents: receiptItems.totalPriceCents,
			appliesToLine: receiptItems.appliesToLine
		})
		.from(receiptItems)
		.where(inArray(receiptItems.receiptId, bonIds))
		.orderBy(asc(receiptItems.receiptId), asc(receiptItems.lineNo));
}

type Position = PostenZeile & { receiptId: string };

/** Ausgaben je EINZELNER Kategorie, getrennt nach geteilt/privat (siehe budgetstand). */
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
 * Alles, was ein Bericht braucht — aus EINEM Zeitfenster geladen und mit den reinen
 * Funktionen aus rechnung.ts und kriterien.ts gerechnet.
 *
 * Die KOPFZAHL: ohne Positionsmerkmal die gedruckten Bonsummen, mit Kategorie/Topf/Suche
 * die Summe der passenden Positionen. Weicht die Positionssumme von den gedruckten Summen
 * ab, steht das als `differenzCents` im Ergebnis.
 *
 * Zurueck kommt der WIRKSAME Filter (Unbekanntes mit Hinweis entfernt) — die Seite baut
 * Chips und Links daraus, nicht aus der Adresse.
 */
export async function berichtLaden(db: typeof Db, k: Zugriffskontext, filterRoh: BerichtFilter, heute: string) {
	const z = filterRoh.zeitraum;
	const tage = zeitraumTage(z);
	const fenster = ladeFenster(z, heute);
	const grenzen = tagesgrenzen(fenster.von, fenster.bis);
	if (!grenzen) throw new Error(`Unbrauchbares Ladefenster ${fenster.von}–${fenster.bis}`);
	const monate = monateVonBis(monatVon(fenster.von), monatVon(fenster.bis));

	const stamm = await stammdatenLaden(db, k);
	const { filter, namen, hinweise, kriterien } = await filterAufloesen(db, k, filterRoh, stamm, monate);
	if (filter.betrag !== null) hinweise.push('Bons ohne erkannte Endsumme fallen bei einer Betragsspanne heraus.');
	const positionsfilter = kriterienAktiv(kriterien);

	const [bonsRoh, zahlen, summenJeMonat] = await Promise.all([
		bonsImFenster(db, k, filter, grenzen),
		// Der Vorbehalt: was noch ungeprueft danebenliegt — ueber alle Monate.
		monatszahlenLaden(db, k, monatVon(heute)),
		// Betraege je Monat fuer die Kacheln der Zeitwahl: nur Umfang, ohne weitere Filter.
		db
			.select({ monat: alsMonat, cents: sql<number>`coalesce(sum(${receipts.totalGrossCents}), 0)::int` })
			.from(receipts)
			.where(and(bonBedingung(k, filter), eq(receipts.status, 'confirmed')))
			.groupBy(alsMonat)
	]);
	const bons = bonsRoh.filter((b) => bonPasst(b, filter));

	const imZeitraum = (b: { tag: string }, r: { von: string; bis: string }) => b.tag >= r.von && b.tag <= r.bis;
	// Positionen: fuer die Aufschluesselung nur die Bons des Zeitraums; mit Positionsmerkmal
	// alle geladenen, weil dann auch Vergleiche und Verlauf aus Positionen rechnen.
	const positionsBons = positionsfilter ? bons : bons.filter((b) => imZeitraum(b, tage));
	const positionen = await positionenZu(db, positionsBons.map((b) => b.id));
	const monatVonBon = new Map(bons.map((b) => [b.id, b.tag.slice(0, 7)]));

	const treffer = positionsfilter ? positionsTreffer(positionen, kriterien, monatVonBon) : null;
	const jeBon = treffer ? summeJeBon(treffer) : null;
	// Mit Positionsmerkmal zaehlt ein Bon nur, wenn er mindestens eine passende Position hat.
	const gezaehlt = jeBon ? bons.filter((b) => jeBon.has(b.id)) : bons;
	const wert = (b: BerichtsBon) => (jeBon ? (jeBon.get(b.id) ?? 0) : (b.cents ?? 0));

	const haupt = gezaehlt.filter((b) => imZeitraum(b, tage));
	const hauptIds = new Set(haupt.map((b) => b.id));
	const hauptPositionen = (treffer ?? positionen).filter((p) => hauptIds.has(p.receiptId));
	const summe = haupt.reduce((s, b) => s + wert(b), 0);
	const kategorienPosten = nachKategorie(hauptPositionen, stamm.kategorien);
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
			const gueltig = stamm.toepfe.filter((t) => t.geloeschtAb === null || t.geloeschtAb > erster);
			const aufl = budgetsFuerMonat(gueltig, stamm.betraege, stamm.zuordnungen, stamm.kategorien, monat);
			return budgetstand(aufl.budgets, centsJeSicht(hauptPositionen.filter((p) => ids.has(p.receiptId)), bonsDesMonats, stamm.kategorien));
		};
		budgetAnzeige =
			z.art === 'monat'
				? { art: 'monat', liste: standIm(z.monat) }
				: { art: 'jahr', liste: budgetImJahr(achse.filter((a) => !a.offen).map((a) => standIm(a.monat))) };
	}

	const slugVon = new Map(stamm.kategorien.map((c) => [c.id, c.slug]));
	return {
		filter,
		namen,
		hinweise,
		kennzahlen: {
			summe,
			bons: haupt.length,
			schnitt: haupt.length === 0 ? 0 : Math.round(summe / haupt.length),
			/** Passende Positionen — nur mit Positionsmerkmal, sonst null. */
			positionen: positionsfilter ? hauptPositionen.length : null
		},
		vergleiche: vergleichsZeitraeume(z, heute).map((r) =>
			vergleichMit(summe, r.bezeichnung, gezaehlt.filter((b) => imZeitraum(b, r)).map(wert))
		),
		kategorien: kategorienPosten.map((p) => ({
			...p,
			slug: p.id === null ? null : (slugVon.get(p.id) ?? null),
			kinder: p.kinder.map((kind) => ({ ...kind, slug: slugVon.get(kind.id) ?? null }))
		})),
		haendler: nachHaendler(haupt.map((b) => ({ haendlerId: b.merchantId, haendler: b.haendler, cents: wert(b) }))),
		verlauf: verlaufRechnen(gezaehlt.map((b) => ({ monat: b.tag.slice(0, 7), cents: wert(b) })), achse, z.art === 'jahr'),
		budgets: budgetAnzeige,
		/** Positionssumme minus gedruckte Endsummen. 0 = einig (mit Positionsmerkmal nicht sinnvoll: 0). */
		differenzCents: positionsfilter ? 0 : ausPositionen - summe,
		/** Bons ohne gelesene Endsumme — sie zaehlen als Bon, aber nicht als Betrag. */
		ohneBetrag: positionsfilter ? 0 : haupt.filter((b) => b.cents === null).length,
		rueckstand: zahlen.rueckstand,
		monatsSummen: Object.fromEntries(summenJeMonat.map((s) => [s.monat, s.cents])) as Record<string, number>
	};
}
