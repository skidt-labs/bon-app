import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import type { db as Db } from '$lib/server/db';
import { tagesgrenzen } from '$lib/server/zeit';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { LADEN_UNBEKANNT, UNSORTIERT, ohneMerkmal, zeitraumTage, type BerichtFilter, type Merkmal } from '$lib/berichte/filter';
import { monatVon, monateVonBis } from '$lib/berichte/kalender';
import type { FilterOption } from '$lib/berichte/merkmale';
import { bonsImFenster, positionenZu, type BerichtsBon } from './abfragen';
import { filterAufloesen, stammdatenLaden } from './aufloesen';
import { bonPasst, kriterienAktiv, positionsTreffer, topfKategorienJeMonat, type PositionFuerFilter } from './kriterien';

/** Die Merkmale mit einer Auswahlliste; Betrag, Suche und geteilt/privat sind Formulare. */
export type Wahlmerkmal = 'laden' | 'kategorie' | 'person' | 'topf';
export function istWahlmerkmal(m: Merkmal): m is Wahlmerkmal {
	return m === 'laden' || m === 'kategorie' || m === 'person' || m === 'topf';
}

type Summe = { cents: number; bons: Set<string> };
const neu = (): Summe => ({ cents: 0, bons: new Set() });

/**
 * Die Eintraege der Filterauswahl mit Vorschau: Betrag und Bonzahl IM GEWAEHLTEN ZEITRAUM,
 * gerechnet mit allen UEBRIGEN Filtern — also genau das, was dazukommt, wenn man den
 * Eintrag anhakt. Grundlage ist dieselbe Abfrage wie im Bericht (sichtbareBons), damit
 * die Zahl neben einer Person nie deren private Bons verraet.
 */
export async function filterOptionen(
	db: typeof Db,
	k: Zugriffskontext,
	filterRoh: BerichtFilter,
	merkmal: Wahlmerkmal
): Promise<FilterOption[]> {
	const tage = zeitraumTage(filterRoh.zeitraum);
	const grenzen = tagesgrenzen(tage.von, tage.bis);
	if (!grenzen) throw new Error(`Unbrauchbarer Zeitraum ${tage.von}–${tage.bis}`);
	const monate = monateVonBis(monatVon(tage.von), monatVon(tage.bis));
	const gewaehlt = new Set<string>(filterRoh[merkmal]);

	const stamm = await stammdatenLaden(db, k);
	const { filter: rest, kriterien } = await filterAufloesen(db, k, ohneMerkmal(filterRoh, merkmal), stamm, monate);
	const bons = (await bonsImFenster(db, k, rest, grenzen)).filter((b) => bonPasst(b, rest));
	const monatVonBon = new Map(bons.map((b) => [b.id, b.tag.slice(0, 7)]));
	const positionen = await positionenZu(db, bons.map((b) => b.id));
	const basis: PositionFuerFilter[] = kriterienAktiv(kriterien)
		? positionsTreffer(positionen, kriterien, monatVonBon)
		: positionen.filter((p) => MONETAER.includes(p.lineType as LineType));
	const jeBon = new Map<string, number>();
	for (const p of basis) jeBon.set(p.receiptId, (jeBon.get(p.receiptId) ?? 0) + p.totalPriceCents);
	// Mit Positionsmerkmal zaehlen nur Bons mit passender Position, mit deren Summe.
	const gezaehlt = kriterienAktiv(kriterien) ? bons.filter((b) => jeBon.has(b.id)) : bons;
	const wert = (b: BerichtsBon) => (kriterienAktiv(kriterien) ? (jeBon.get(b.id) ?? 0) : (b.cents ?? 0));
	const gezaehltIds = new Set(gezaehlt.map((b) => b.id));

	const option = (wert_: string, name: string, s: Summe, ebene: 0 | 1 = 0): FilterOption => ({
		wert: wert_, name, ebene, cents: s.cents, bons: s.bons.size, gewaehlt: gewaehlt.has(wert_)
	});
	const nachSumme = (a: FilterOption, b: FilterOption) => b.cents - a.cents || a.name.localeCompare(b.name, 'de');

	if (merkmal === 'laden') {
		const je = new Map<string, Summe & { name: string }>();
		for (const b of gezaehlt) {
			const id = b.merchantId ?? LADEN_UNBEKANNT;
			const s = je.get(id) ?? { ...neu(), name: id === LADEN_UNBEKANNT ? 'Laden unbekannt' : (b.ladenName ?? 'Laden') };
			s.cents += wert(b);
			s.bons.add(b.id);
			je.set(id, s);
		}
		const liste = [...je.entries()].map(([id, s]) => option(id, s.name, s));
		// Gewaehlte, die im Zeitraum nichts haben, bleiben abwaehlbar.
		for (const id of gewaehlt) {
			if (!je.has(id)) liste.push(option(id, id === LADEN_UNBEKANNT ? 'Laden unbekannt' : 'Gewählter Laden', neu()));
		}
		return liste.sort((a, b) => (a.wert === LADEN_UNBEKANNT ? 1 : b.wert === LADEN_UNBEKANNT ? -1 : nachSumme(a, b)));
	}

	if (merkmal === 'person') {
		return stamm.mitglieder.map((m) => {
			const s = neu();
			for (const b of gezaehlt) if (b.uploadedBy === m.id) {
				s.cents += wert(b);
				s.bons.add(b.id);
			}
			return option(m.id, m.name, s);
		});
	}

	const zeilen = basis.filter((p) => gezaehltIds.has(p.receiptId));

	if (merkmal === 'kategorie') {
		const je = new Map<string, Summe>();
		const buche = (schluessel: string, p: PositionFuerFilter) => {
			const s = je.get(schluessel) ?? neu();
			s.cents += p.totalPriceCents;
			s.bons.add(p.receiptId);
			je.set(schluessel, s);
		};
		const knoten = new Map(stamm.kategorien.map((c) => [c.id, c]));
		for (const p of zeilen) {
			const c = p.categoryId === null ? undefined : knoten.get(p.categoryId);
			if (!c) {
				buche(UNSORTIERT, p);
				continue;
			}
			buche(c.slug, p);
			if (c.parentId) {
				const eltern = knoten.get(c.parentId);
				if (eltern) buche(eltern.slug, p);
			}
		}
		const liste: FilterOption[] = [];
		for (const ober of stamm.kategorien.filter((c) => c.parentId === null)) {
			if (!je.has(ober.slug) && !gewaehlt.has(ober.slug)) continue;
			liste.push(option(ober.slug, ober.name, je.get(ober.slug) ?? neu(), 0));
			for (const kind of stamm.kategorien.filter((c) => c.parentId === ober.id)) {
				if (je.has(kind.slug) || gewaehlt.has(kind.slug)) liste.push(option(kind.slug, kind.name, je.get(kind.slug) ?? neu(), 1));
			}
		}
		if (je.has(UNSORTIERT) || gewaehlt.has(UNSORTIERT)) // „Ohne Kategorie", nicht „Unsortiert": so heisst eine echte Kategorie unter Sonstiges,
		// und zwei gleichnamige Eintraege mit verschiedener Bedeutung laden zum Verwechseln ein.
		liste.push(option(UNSORTIERT, 'Ohne Kategorie', je.get(UNSORTIERT) ?? neu()));
		return liste;
	}

	// Topf: je Topf die Positionen in seinen Kategorien des jeweiligen Kaufmonats.
	return stamm.toepfe
		.filter((t) => t.geloeschtAb === null || gewaehlt.has(t.id))
		.map((t) => {
			const jeMonat = topfKategorienJeMonat([t.id], stamm.toepfe, stamm.betraege, stamm.zuordnungen, stamm.kategorien, monate);
			const s = neu();
			for (const p of zeilen) {
				if (p.categoryId !== null && jeMonat.get(monatVonBon.get(p.receiptId) ?? '')?.has(p.categoryId)) {
					s.cents += p.totalPriceCents;
					s.bons.add(p.receiptId);
				}
			}
			return option(t.id, t.name, s);
		})
		.sort(nachSumme);
}
