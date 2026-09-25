import { MONETAER, type LineType } from '$lib/bons/zeilenarten';

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

export type Kennzahlen = {
	summe: number;
	bons: number;
	/** Durchschnitt je Bon, auf ganze Cent gerundet. */
	schnitt: number;
	/** null = im Vormonat liegt nichts Bestaetigtes, also kein Vergleich. */
	vormonatCents: number | null;
	veraenderungProzent: number | null;
};

export function kennzahlen(
	bons: { cents: number }[],
	vormonat: { cents: number }[]
): Kennzahlen {
	const summe = bons.reduce((s, b) => s + b.cents, 0);
	const vorher = vormonat.reduce((s, b) => s + b.cents, 0);
	return {
		summe,
		bons: bons.length,
		schnitt: bons.length === 0 ? 0 : Math.round(summe / bons.length),
		vormonatCents: vormonat.length === 0 ? null : vorher,
		veraenderungProzent:
			vormonat.length === 0 || vorher === 0 ? null : Math.round(((summe - vorher) / vorher) * 100)
	};
}

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

export function nachHaendler(bons: { haendler: string | null; cents: number }[]): Posten[] {
	const summen = new Map<string, number>();
	for (const b of bons) {
		const name = b.haendler ?? 'Unbekannter Händler';
		summen.set(name, (summen.get(name) ?? 0) + b.cents);
	}
	const gesamt = [...summen.values()].reduce((s, c) => s + c, 0);
	return [...summen.entries()]
		.map(([name, cents]) => ({ name, cents, anteil: gesamt === 0 ? 0 : cents / gesamt }))
		.sort((a, b) => b.cents - a.cents);
}

/**
 * Der Verlauf ueber mehrere Monate. `monate` gibt die Achse vor — ein Monat ohne
 * Ausgaben erscheint mit 0 und faellt nicht heraus, sonst zeigte die Kurve eine
 * Luecke als waere dort nichts gemessen worden.
 */
export function verlauf(
	bons: { monat: string; cents: number }[],
	monate: string[]
): { monat: string; cents: number }[] {
	const summen = new Map<string, number>();
	for (const b of bons) summen.set(b.monat, (summen.get(b.monat) ?? 0) + b.cents);
	return monate.map((m) => ({ monat: m, cents: summen.get(m) ?? 0 }));
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
