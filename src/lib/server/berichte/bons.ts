import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import type { db as Db } from '$lib/server/db';
import { tagesgrenzen } from '$lib/server/zeit';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { hatFilter, UNSORTIERT, zeitraumTage, type BerichtFilter } from '$lib/berichte/filter';
import { monatVon, monateVonBis } from '$lib/berichte/kalender';
import type { FilterNamen } from '$lib/berichte/merkmale';
import { bonsImFenster, positionenZu } from './abfragen';
import { filterAufloesen, stammdatenLaden } from './aufloesen';
import { bonPasst, kriterienAktiv, positionsTreffer } from './kriterien';

export type BonZeile = {
	id: string;
	tag: string;
	haendler: string | null;
	/** Nur eigene Bons koennen privat UND sichtbar sein — der Chip sagt „nur du siehst ihn". */
	privat: boolean;
	gesamtCents: number | null;
	/** null = Bon ohne erkannte Endsumme (nur ohne Positionsmerkmal) — eine Leerstelle, keine 0. */
	passendCents: number | null;
	passende: { rawText: string; cents: number; kategorie: string | null }[];
};

export type BonsZuFilter = {
	filter: BerichtFilter;
	namen: FilterNamen;
	hinweise: string[];
	/** Name, wenn genau EIN Laden oder EINE Kategorie gewaehlt ist — sonst null („Auswahl"). */
	titel: string | null;
	bons: BonZeile[];
	summe: number;
	/** Bons ohne erkannte Endsumme: sie stehen in der Liste, aber nicht in der Summe. */
	ohneBetrag: number;
	positionen: number;
	/** Ob ein Positionsmerkmal wirkt (Kategorie, Topf, Suche). */
	nachPositionen: boolean;
	/** Bei genau einer Oberkategorie: ihre Unterkategorien mit Betrag, als Filterpillen. */
	unterkategorien: { slug: string; name: string; cents: number }[];
	/** Bei genau einer Unterkategorie: der Weg zurueck zur Oberkategorie. */
	oberkategorie: { slug: string; name: string } | null;
};

/**
 * „Bons zu …": die bestaetigten Bons eines Zeitraums, die zum Filter passen — mit den
 * passenden Positionen. Ohne Positionsmerkmal zaehlt die gedruckte Bonsumme, wie in der
 * Kopfzahl des Berichts; mit Positionsmerkmal die Summe der passenden Zeilen.
 */
export async function bonsZuFilter(db: typeof Db, k: Zugriffskontext, filterRoh: BerichtFilter): Promise<BonsZuFilter> {
	const tage = zeitraumTage(filterRoh.zeitraum);
	const grenzen = tagesgrenzen(tage.von, tage.bis);
	if (!grenzen) throw new Error(`Unbrauchbarer Zeitraum ${tage.von}–${tage.bis}`);
	const monate = monateVonBis(monatVon(tage.von), monatVon(tage.bis));

	const stamm = await stammdatenLaden(db, k);
	const { filter, namen, hinweise, kriterien } = await filterAufloesen(db, k, filterRoh, stamm, monate);
	const leer = {
		filter, namen, titel: null, bons: [], summe: 0, ohneBetrag: 0, positionen: 0,
		nachPositionen: false, unterkategorien: [], oberkategorie: null
	};
	// Blieb kein Merkmal uebrig (nichts gewaehlt, oder nur Unbekanntes aus einem alten
	// Lesezeichen), zeigte die Liste sonst ALLE Bons, als waeren sie gefiltert.
	if (!hatFilter(filter)) return { ...leer, hinweise: [...hinweise, 'Wähle im Bericht einen Filter, eine Kategorie oder einen Laden.'] };
	if (filter.betrag !== null) hinweise.push('Bons ohne erkannte Endsumme fallen bei einer Betragsspanne heraus.');

	const nachPositionen = kriterienAktiv(kriterien);
	const titel =
		filter.laden.length === 1 && filter.kategorie.length === 0
			? (namen.laden[filter.laden[0]] ?? (filter.laden[0] === 'ohne' ? 'unbekanntem Laden' : null))
			: filter.kategorie.length === 1 && filter.laden.length === 0
				? filter.kategorie[0] === UNSORTIERT
					? null
					: (namen.kategorie[filter.kategorie[0]] ?? null)
				: null;

	const bons = (await bonsImFenster(db, k, filter, grenzen))
		.filter((b) => bonPasst(b, filter))
		.sort((a, b) => new Date(b.zeit).getTime() - new Date(a.zeit).getTime() || a.id.localeCompare(b.id));
	const positionen = await positionenZu(db, bons.map((b) => b.id));
	const monatVonBon = new Map(bons.map((b) => [b.id, b.tag.slice(0, 7)]));
	const treffer = nachPositionen
		? positionsTreffer(positionen, kriterien, monatVonBon)
		: positionen.filter((p) => MONETAER.includes(p.lineType as LineType));
	const jeBon = new Map<string, typeof treffer>();
	for (const p of treffer) jeBon.set(p.receiptId, [...(jeBon.get(p.receiptId) ?? []), p]);
	const kategorieName = new Map(stamm.kategorien.map((c) => [c.id, c.name]));

	const zeilen: BonZeile[] = [];
	for (const b of bons) {
		const passende = jeBon.get(b.id) ?? [];
		if (nachPositionen && passende.length === 0) continue;
		zeilen.push({
			id: b.id,
			tag: b.tag,
			haendler: b.haendler,
			privat: b.sichtbarkeit === 'privat',
			gesamtCents: b.cents,
			passendCents: nachPositionen ? passende.reduce((s, p) => s + p.totalPriceCents, 0) : b.cents,
			passende: passende.map((p) => ({
				rawText: p.rawText,
				cents: p.totalPriceCents,
				kategorie: p.categoryId === null ? null : (kategorieName.get(p.categoryId) ?? null)
			}))
		});
	}

	let unterkategorien: BonsZuFilter['unterkategorien'] = [];
	let oberkategorie: BonsZuFilter['oberkategorie'] = null;
	const gewaehlt = filter.kategorie.length === 1 ? stamm.kategorien.find((c) => c.slug === filter.kategorie[0]) : undefined;
	if (gewaehlt && gewaehlt.parentId === null) {
		const behalten = new Set(zeilen.map((z) => z.id));
		const summen = new Map<string, number>();
		for (const p of treffer) {
			if (behalten.has(p.receiptId) && p.categoryId !== null && p.categoryId !== gewaehlt.id) {
				summen.set(p.categoryId, (summen.get(p.categoryId) ?? 0) + p.totalPriceCents);
			}
		}
		unterkategorien = stamm.kategorien
			.filter((c) => c.parentId === gewaehlt.id && summen.has(c.id))
			.map((c) => ({ slug: c.slug, name: c.name, cents: summen.get(c.id)! }))
			.sort((a, b) => b.cents - a.cents);
	} else if (gewaehlt && gewaehlt.parentId !== null) {
		const eltern = stamm.kategorien.find((c) => c.id === gewaehlt.parentId);
		if (eltern) oberkategorie = { slug: eltern.slug, name: eltern.name };
	}

	return {
		filter,
		namen,
		hinweise,
		titel,
		bons: zeilen,
		summe: zeilen.reduce((s, z) => s + (z.passendCents ?? 0), 0),
		ohneBetrag: zeilen.filter((z) => z.passendCents === null).length,
		positionen: zeilen.reduce((s, z) => s + z.passende.length, 0),
		nachPositionen,
		unterkategorien,
		oberkategorie
	};
}
