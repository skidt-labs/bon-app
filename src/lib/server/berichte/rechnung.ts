import { MONETAER, type LineType } from '$lib/bons/zeilenarten';
import { monatPlus } from '$lib/berichte/kalender';
import type { Vergleich } from '$lib/berichte/zeitleiste';

/**
 * Die Rechnung hinter den Monatsberichten — rein, ohne Datenbank.
 *
 * Drei Regeln ziehen sich durch alles:
 *
 * 1. **Nur Geldzeilen zaehlen.** Eine Infozeile steht auf dem Bon, aber nicht im
 *    Einkauf; zaehlte man sie mit, waere jeder Bericht um die Gewichts- und
 *    Hinweiszeilen zu hoch. Rabatt und Pfandrueckgabe tragen ihr Vorzeichen und werden
 *    dadurch abgezogen — zurueckgebrachtes Leergut ist keine Ausgabe.
 * 2. **Unsortiertes verschwindet nicht.** Es steht als eigener Posten da, am Ende. Ein
 *    Bericht, der unterschlaegt, was er nicht einordnen kann, stimmt nicht — er sieht
 *    nur ordentlicher aus.
 * 3. **Was es nicht gibt, wird nicht behauptet.** Kein Vormonat heisst `null`, nicht
 *    „0 Prozent"; kein festgelegtes Budget heisst `null`, nicht „0 Prozent verbraucht".
 */

export type PostenZeile = {
	categoryId: string | null;
	lineType: LineType | string;
	totalPriceCents: number;
};
export type KategorieKnoten = { id: string; name: string; parentId: string | null };

export type KategoriePosten = {
	/** null = der Sammelposten fuer alles ohne (bekannte) Kategorie. */
	id: string | null;
	name: string;
	cents: number;
	/** Anteil an der Gesamtsumme, 0..1. */
	anteil: number;
	kinder: { id: string; name: string; cents: number }[];
};

const UNSORTIERT = 'Unsortiert';

export function nachKategorie(
	zeilen: PostenZeile[],
	kategorien: KategorieKnoten[]
): KategoriePosten[] {
	const knoten = new Map(kategorien.map((k) => [k.id, k]));
	/** Oberkategorie-Id (oder null fuer Unsortiert) → Summe und Kinder. */
	const gruppen = new Map<string | null, { cents: number; kinder: Map<string, number> }>();

	for (const z of zeilen) {
		if (!MONETAER.includes(z.lineType as LineType)) continue;
		const k = z.categoryId === null ? undefined : knoten.get(z.categoryId);
		// Eine Kategorie, die es nicht (mehr) gibt, faellt nach Unsortiert statt zu
		// verschwinden — ihr Geld wurde ja ausgegeben.
		const oberId = k ? (k.parentId ?? k.id) : null;
		const gruppe = gruppen.get(oberId) ?? { cents: 0, kinder: new Map<string, number>() };
		gruppe.cents += z.totalPriceCents;
		// Nur echte Unterkategorien werden einzeln ausgewiesen; eine direkt getroffene
		// Oberkategorie ist ihre eigene Summe und braucht kein Kind.
		if (k?.parentId) gruppe.kinder.set(k.id, (gruppe.kinder.get(k.id) ?? 0) + z.totalPriceCents);
		gruppen.set(oberId, gruppe);
	}

	const gesamt = [...gruppen.values()].reduce((s, g) => s + g.cents, 0);
	const posten: KategoriePosten[] = [...gruppen.entries()].map(([id, g]) => ({
		id,
		name: id === null ? UNSORTIERT : (knoten.get(id)?.name ?? UNSORTIERT),
		cents: g.cents,
		anteil: gesamt === 0 ? 0 : g.cents / gesamt,
		kinder: [...g.kinder.entries()]
			.map(([kid, cents]) => ({ id: kid, name: knoten.get(kid)?.name ?? kid, cents }))
			.sort((a, b) => b.cents - a.cents)
	}));

	// Groesster zuerst — aber Unsortiert immer ans Ende: es ist kein Posten, auf den man
	// stolz ist, sondern einer, den man abarbeitet.
	return posten.sort((a, b) => {
		if (a.id === null) return 1;
		if (b.id === null) return -1;
		// Bei gleicher Summe der Name, nicht die Einfuegereihenfolge: sonst steht derselbe
		// Monat je nach Reihenfolge der Zeilen anders da, und zwei Blicke auf denselben
		// Bericht widersprechen sich.
		return b.cents - a.cents || a.name.localeCompare(b.name, 'de');
	});
}

export type Posten = { name: string; cents: number; anteil: number };
/** id = merchant-Id; null, wenn nur der gelesene Name bekannt ist (dann kein „Bons ›"). */
export type HaendlerPosten = Posten & { id: string | null };

export function nachHaendler(
	bons: { haendlerId?: string | null; haendler: string | null; cents: number }[]
): HaendlerPosten[] {
	// Schluessel ist die Id, wo es eine gibt: zwei Filialen derselben Kette mit gleichem
	// Namen sind derselbe Haendler, ein nur gelesener Name ist ein eigener Posten.
	const summen = new Map<string, { id: string | null; name: string; cents: number }>();
	for (const b of bons) {
		const name = b.haendler ?? 'Unbekannter Händler';
		const id = b.haendlerId ?? null;
		const schluessel = id ?? `name:${name}`;
		const bisher = summen.get(schluessel) ?? { id, name, cents: 0 };
		bisher.cents += b.cents;
		summen.set(schluessel, bisher);
	}
	const gesamt = [...summen.values()].reduce((s, p) => s + p.cents, 0);
	return [...summen.values()]
		.map((p) => ({ id: p.id, name: p.name, cents: p.cents, anteil: gesamt === 0 ? 0 : p.cents / gesamt }))
		.sort((a, b) => b.cents - a.cents);
}

export type BudgetStand = {
	budgetId: string;
	name: string;
	betragCents: number | null;
	ausgabeCents: number;
	/** Verbrauchsanteil 0..n, oder null, wenn kein Betrag festgelegt ist. */
	anteil: number | null;
};

/**
 * Die Betraege je Kategorie, die ein Budget aufsummieren darf — DIREKT gebucht, ohne die
 * Kinder.
 *
 * `nachKategorie` legt auf die Oberkategorie die Summe ALLER ihrer Zeilen, Kinder
 * eingeschlossen; das ist fuer die Anzeige richtig ("Lebensmittel: 120 EUR"). Fuer einen
 * Topf ist es falsch: Deckt er eine Oberkategorie ab, loest `budgetsFuerMonat` sie zu
 * Oberkategorie UND Kindern auf, und `budgetstand` addiert danach beide Ebenen — eine
 * Ausgabe von 10 EUR unter "Brot" ergab so 20 EUR Verbrauch im Topf "Lebensmittel"
 * (Befund R06, 18.09.2026).
 *
 * Die Regel dahinter: JEDE POSITION ZAEHLT IN GENAU EINEM TOPF. Dafuer braucht der
 * Budgetstand die direkten Betraege, und die aggregierten Elternsummen bleiben der
 * Anzeige vorbehalten.
 *
 * Der direkte Betrag einer Oberkategorie ist ihre Summe minus der ihrer Kinder. Das ist
 * kein Kniff, sondern die Umkehrung dessen, was nachKategorie aufaddiert hat.
 */
export function direkteCentsJeKategorie(posten: KategoriePosten[]): Map<string, number> {
	const je = new Map<string, number>();
	for (const p of posten) {
		const kinderSumme = p.kinder.reduce((s, k) => s + k.cents, 0);
		if (p.id !== null) je.set(p.id, p.cents - kinderSumme);
		for (const k of p.kinder) je.set(k.id, k.cents);
	}
	return je;
}

/**
 * Scope zu Scope: ein GETEILTER Topf zaehlt die geteilten Ausgaben, ein PRIVATER die, die
 * nur seinem Eigentuemer gehoeren.
 *
 * Die Alternative waere gewesen, jeden Topf ueber alles rechnen zu lassen, was der
 * Anfragende sehen darf. Dann stuenden in Erikas privatem Topf "Geschenke" auch die
 * geteilten Einkaeufe des Haushalts — und in einem geteilten Topf saehe jeder eine Summe,
 * die er aus den sichtbaren Bons nicht nachrechnen kann, weil fremde private Bons darin
 * steckten. Ein Betrag, den niemand nachrechnen kann, ist eine Behauptung.
 */
export function budgetstand(
	budgets: {
		budgetId: string;
		name: string;
		sichtbarkeit: 'geteilt' | 'privat';
		betragCents: number | null;
		kategorieIds: string[];
	}[],
	centsJeKategorie: { geteilt: Map<string, number>; privat: Map<string, number> }
): BudgetStand[] {
	return budgets.map((b) => {
		const quelle = centsJeKategorie[b.sichtbarkeit];
		const ausgabeCents = b.kategorieIds.reduce((s, id) => s + (quelle.get(id) ?? 0), 0);
		return {
			budgetId: b.budgetId,
			name: b.name,
			betragCents: b.betragCents,
			ausgabeCents,
			// Ohne festgelegten Betrag gibt es keinen Anteil — ein Balken bei 0 Prozent
			// waere eine Behauptung ueber ein Budget, das niemand gesetzt hat.
			anteil: b.betragCents === null || b.betragCents === 0 ? null : ausgabeCents / b.betragCents
		};
	});
}

/**
 * Welche Positionen ein Kategoriefilter trifft: Geldzeilen, deren EIGENE Kategorie
 * gewaehlt ist. Rabatt und Pfand zaehlen damit dort, wo sie selbst stehen — dieselbe
 * Regel wie in nachKategorie, damit Filter und Aufschluesselung dieselbe Zahl zeigen.
 */
export function passendePositionen<T extends PostenZeile>(zeilen: T[], kategorieIds: Set<string>): T[] {
	return zeilen.filter(
		(z) => MONETAER.includes(z.lineType as LineType) && z.categoryId !== null && kategorieIds.has(z.categoryId)
	);
}

/** Slugs → Ids; eine Oberkategorie schliesst ihre Kinder ein. Unbekanntes kommt getrennt zurueck. */
export function kategorienAufloesen(
	slugs: string[],
	kategorien: { id: string; slug: string; parentId: string | null }[]
): { ids: Set<string>; unbekannt: string[] } {
	const ids = new Set<string>();
	const unbekannt: string[] = [];
	for (const slug of slugs) {
		const k = kategorien.find((x) => x.slug === slug);
		if (!k) {
			unbekannt.push(slug);
			continue;
		}
		ids.add(k.id);
		if (k.parentId === null) for (const kind of kategorien.filter((x) => x.parentId === k.id)) ids.add(kind.id);
	}
	return { ids, unbekannt };
}

/** Summe der Geldzeilen je Bon. Ein Bon ohne Geldzeile fehlt in der Map. */
export function summeJeBon(zeilen: (PostenZeile & { receiptId: string })[]): Map<string, number> {
	const je = new Map<string, number>();
	for (const z of zeilen) {
		if (!MONETAER.includes(z.lineType as LineType)) continue;
		je.set(z.receiptId, (je.get(z.receiptId) ?? 0) + z.totalPriceCents);
	}
	return je;
}

/**
 * Die Summe gegen einen Vergleichszeitraum. `basis` sind die Werte der dort gezaehlten
 * Bons; keine Bons heisst kein Vergleich (null), nicht „0 %".
 */
export function vergleichMit(summe: number, bezeichnung: string, basis: number[]): Vergleich {
	if (basis.length === 0) return { bezeichnung, cents: null, prozent: null };
	const cents = basis.reduce((s, c) => s + c, 0);
	return { bezeichnung, cents, prozent: cents === 0 ? null : Math.round(((summe - cents) / cents) * 100) };
}

export type VerlaufPunkt = { monat: string; cents: number; offen: boolean; vorjahrCents: number | null };

/**
 * Der Verlauf auf einer vorgegebenen Achse. Ein Monat ohne Ausgaben erscheint mit 0 und
 * faellt nicht heraus. Der Vorjahreswert dagegen ist null, wo im Vorjahresmonat nichts
 * lag — ein Punkt bei 0 behauptete eine Messung, die es nicht gibt.
 */
export function verlaufRechnen(
	werte: { monat: string; cents: number }[],
	achse: { monat: string; offen: boolean }[],
	mitVorjahr: boolean
): VerlaufPunkt[] {
	const summen = new Map<string, number>();
	for (const w of werte) summen.set(w.monat, (summen.get(w.monat) ?? 0) + w.cents);
	return achse.map((a) => ({
		monat: a.monat,
		cents: a.offen ? 0 : (summen.get(a.monat) ?? 0),
		offen: a.offen,
		vorjahrCents: mitVorjahr ? (summen.get(monatPlus(a.monat, -12)) ?? null) : null
	}));
}

export type BudgetJahr = { budgetId: string; name: string; monateImRahmen: number; monateMitBetrag: number };

/** „Im Rahmen in N von M Monaten" je Topf. Monate ohne festgelegten Betrag zaehlen nicht mit. */
export function budgetImJahr(jeMonat: BudgetStand[][]): BudgetJahr[] {
	const je = new Map<string, BudgetJahr>();
	for (const monat of jeMonat) {
		for (const b of monat) {
			const bisher = je.get(b.budgetId) ?? { budgetId: b.budgetId, name: b.name, monateImRahmen: 0, monateMitBetrag: 0 };
			bisher.name = b.name;
			if (b.anteil !== null) {
				bisher.monateMitBetrag += 1;
				if (b.anteil <= 1) bisher.monateImRahmen += 1;
			}
			je.set(b.budgetId, bisher);
		}
	}
	return [...je.values()];
}
