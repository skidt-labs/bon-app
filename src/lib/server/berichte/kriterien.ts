import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import {
	budgetsFuerMonat,
	type BetragZeile,
	type BudgetZeile,
	type KategorieZeile,
	type ZuordnungZeile
} from '$lib/server/budgets/aufloesung';
import { LADEN_UNBEKANNT, type BerichtFilter } from '$lib/berichte/filter';
import type { PostenZeile } from './rechnung';

/*
 * Die Merkmale eines Berichts als reine Pruefungen: UND zwischen den Merkmalen, ODER
 * innerhalb eines Merkmals. Die Datenbank liefert vorher nur, was dieser Mensch sehen
 * darf (sichtbareBons) — hier wird darin weiter eingeschraenkt, nie erweitert.
 */

export type BonFuerFilter = {
	merchantId: string | null;
	uploadedBy: string;
	cents: number | null;
	sichtbarkeit: 'geteilt' | 'privat';
};

/** Die Bon-Merkmale: Laden, Person, Betrag, geteilt/privat. */
export function bonPasst(b: BonFuerFilter, f: BerichtFilter): boolean {
	if (f.laden.length > 0 && !f.laden.includes(b.merchantId ?? LADEN_UNBEKANNT)) return false;
	if (f.person.length > 0 && !f.person.includes(b.uploadedBy)) return false;
	if (f.betrag !== null) {
		// Ohne Endsumme kein Betrag — ein solcher Bon kann in keiner Spanne liegen.
		if (b.cents === null) return false;
		if (f.betrag.ab !== null && b.cents < f.betrag.ab) return false;
		if (f.betrag.bis !== null && b.cents > f.betrag.bis) return false;
	}
	if (f.sicht !== null && b.sichtbarkeit !== f.sicht) return false;
	return true;
}

export type PositionFuerFilter = PostenZeile & {
	receiptId: string;
	lineNo: number;
	rawText: string;
	appliesToLine: number | null;
};

export type PositionsKriterien = {
	/** null = kein Kategoriefilter; die Ids enthalten die Kinder gewaehlter Oberkategorien. */
	kategorieIds: Set<string> | null;
	/** „Unsortiert" gewaehlt: Zeilen ohne Kategorie passen. */
	unsortiert: boolean;
	/** null = kein Topf; sonst je Kaufmonat die Kategorien der gewaehlten Toepfe. */
	topfJeMonat: Map<string, Set<string>> | null;
	suche: string | null;
};

export const KEINE_KRITERIEN: PositionsKriterien = { kategorieIds: null, unsortiert: false, topfJeMonat: null, suche: null };

export function kriterienAktiv(k: PositionsKriterien): boolean {
	return k.kategorieIds !== null || k.unsortiert || k.topfJeMonat !== null || k.suche !== null;
}

/** Ohne Gross/Klein und ohne Akzente: „Café" findet „cafe", „KAFFEE" findet „kaffee". */
export function suchNormal(s: string): string {
	return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de-DE');
}

/**
 * Die Positionen, die alle Positionsmerkmale erfuellen (Kategorie, Topf, Suche). Nur
 * Geldzeilen; jede Zeile zaehlt in der Kategorie, die SIE traegt.
 *
 * Einzige Ausnahme, nur fuer die Suche: ein Rabatt, der per applies_to_line an einer
 * GEFUNDENEN Position haengt, zaehlt mit — sonst waere „Kaffee" um den Kaffee-Rabatt zu
 * hoch. Die uebrigen Merkmale muss auch der Rabatt selbst erfuellen.
 *
 * Gesucht wird woertlich (includes), nicht als Muster: „50%" oder „c++" sind Text.
 */
export function positionsTreffer<T extends PositionFuerFilter>(
	zeilen: T[],
	k: PositionsKriterien,
	monatVonBon: Map<string, string>
): T[] {
	const gesucht = k.suche === null ? null : suchNormal(k.suche);
	const erfuellt = (z: T, mitSuche: boolean): boolean => {
		if (!MONETAER.includes(z.lineType as LineType)) return false;
		if (k.kategorieIds !== null || k.unsortiert) {
			const passt = z.categoryId === null ? k.unsortiert : (k.kategorieIds?.has(z.categoryId) ?? false);
			if (!passt) return false;
		}
		if (k.topfJeMonat !== null) {
			const imTopf = k.topfJeMonat.get(monatVonBon.get(z.receiptId) ?? '');
			if (z.categoryId === null || !imTopf?.has(z.categoryId)) return false;
		}
		if (mitSuche && gesucht !== null && !suchNormal(z.rawText).includes(gesucht)) return false;
		return true;
	};
	const direkt = new Set(zeilen.filter((z) => erfuellt(z, true)));
	if (gesucht === null) return zeilen.filter((z) => direkt.has(z));
	const gefunden = new Set([...direkt].map((z) => `${z.receiptId}#${z.lineNo}`));
	return zeilen.filter(
		(z) =>
			direkt.has(z) ||
			(z.lineType === 'discount' &&
				z.appliesToLine !== null &&
				gefunden.has(`${z.receiptId}#${z.appliesToLine}`) &&
				erfuellt(z, false))
	);
}

/**
 * Welche Kategorien die gewaehlten Toepfe in jedem Monat abdecken — nach derselben Regel
 * wie der Budgetstand (budgetsFuerMonat, Stichtag Monatserster). So zaehlt ein alter Bon
 * nach der Zuordnung, die in seinem Kaufmonat galt.
 */
export function topfKategorienJeMonat(
	topfIds: string[],
	toepfe: BudgetZeile[],
	betraege: BetragZeile[],
	zuordnungen: ZuordnungZeile[],
	kategorien: KategorieZeile[],
	monate: string[]
): Map<string, Set<string>> {
	const gewaehlt = new Set(topfIds);
	const je = new Map<string, Set<string>>();
	for (const monat of monate) {
		const ids = new Set<string>();
		for (const b of budgetsFuerMonat(toepfe, betraege, zuordnungen, kategorien, monat).budgets) {
			if (gewaehlt.has(b.budgetId)) for (const id of b.kategorieIds) ids.add(id);
		}
		je.set(monat, ids);
	}
	return je;
}
