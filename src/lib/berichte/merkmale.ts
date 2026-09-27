import { formatCents } from '$lib/money';
import { LADEN_UNBEKANNT, MERKMALE, UNSORTIERT, type BerichtFilter, type Merkmal } from './filter';

/** Anzeigenamen zu den Ids/Slugs im Filter — vom Server aufgeloest, nur fuer Gesetztes. */
export type FilterNamen = {
	laden: Record<string, string>;
	kategorie: Record<string, string>;
	person: Record<string, string>;
	topf: Record<string, string>;
};

export const LEERE_NAMEN: FilterNamen = { laden: {}, kategorie: {}, person: {}, topf: {} };

/** Ein Eintrag der Filterauswahl — Betrag und Bonzahl im gewaehlten Zeitraum. */
export type FilterOption = { wert: string; name: string; ebene: 0 | 1; cents: number; bons: number; gewaehlt: boolean };

export const MERKMAL_NAME: Record<Merkmal, string> = {
	laden: 'Laden',
	kategorie: 'Kategorie',
	person: 'Person',
	betrag: 'Betrag',
	topf: 'Topf',
	suche: 'Suche',
	sicht: 'Geteilt/privat'
};

export function aktiveMerkmale(f: BerichtFilter): Merkmal[] {
	return MERKMALE.filter((m) => {
		const w = f[m];
		return Array.isArray(w) ? w.length > 0 : w !== null;
	});
}

export function merkmalText(f: BerichtFilter, m: Merkmal, namen: FilterNamen): string {
	switch (m) {
		case 'laden':
			return `Laden: ${f.laden.map((id) => (id === LADEN_UNBEKANNT ? 'Laden unbekannt' : (namen.laden[id] ?? 'unbekannter Laden'))).join(', ')}`;
		case 'kategorie':
			return `Kategorie: ${f.kategorie.map((s) => (s === UNSORTIERT ? 'Ohne Kategorie' : (namen.kategorie[s] ?? s))).join(', ')}`;
		case 'person':
			return `Person: ${f.person.map((id) => namen.person[id] ?? 'unbekannt').join(', ')}`;
		case 'topf':
			return `Topf: ${f.topf.map((id) => namen.topf[id] ?? 'unbekannt').join(', ')}`;
		case 'betrag': {
			const b = f.betrag;
			if (!b) return 'Betrag';
			if (b.ab !== null && b.bis !== null) return `Betrag: ${formatCents(b.ab)}–${formatCents(b.bis)} €`;
			if (b.ab !== null) return `Betrag: ab ${formatCents(b.ab)} €`;
			return `Betrag: bis ${formatCents(b.bis ?? 0)} €`;
		}
		case 'suche':
			return `Suche: „${f.suche ?? ''}"`;
		case 'sicht':
			return f.sicht === 'privat' ? 'Nur eigene private' : 'Nur geteilte';
	}
}

export function filterZusammenfassung(f: BerichtFilter, namen: FilterNamen): string[] {
	return aktiveMerkmale(f).map((m) => merkmalText(f, m, namen));
}
