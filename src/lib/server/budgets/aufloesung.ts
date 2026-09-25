/**
 * Welcher Topf gilt in welchem Monat, mit welchem Betrag und welchen Kategorien?
 *
 * Rein und ohne Datenbank, damit sich die Randfaelle nachrechnen lassen — die Zeit ist
 * hier die ganze Schwierigkeit, und Zeitregeln, die man nicht pruefen kann, sind
 * Zeitregeln, die man falsch hat.
 *
 * Gerechnet wird auf Datums-ZEICHENKETTEN ('YYYY-MM-DD'). Das ist kein Sparen: ein
 * `gilt ab` ist ein Datum, kein Zeitpunkt, und sobald man es durch `new Date()` schickt,
 * haengt an ihm eine Zeitzone, die über den Monatswechsel mitentscheidet. Der 1. Oktober
 * ist in Berlin und in UTC derselbe Tag; 2026-10-01T00:00Z ist es nicht.
 */

export type BudgetZeile = { id: string; name: string; sichtbarkeit: 'geteilt' | 'privat' };
export type BetragZeile = { budgetId: string; giltAb: string; amountCents: number };
export type ZuordnungZeile = {
	budgetId: string;
	categoryId: string;
	giltAb: string;
	giltBis: string | null;
	/** null = die Zuordnung eines GETEILTEN Topfs. */
	eigentuemerId: string | null;
};

/**
 * Der Geltungsbereich einer Zuordnung: geteilt, oder das Private einer Person.
 *
 * Zwei Toepfe duerfen dieselbe Kategorie fuehren, solange sie in verschiedenen Bereichen
 * liegen — genau dafuer steht der Eigentuemer seit Aufgabe 6 im Unique-Index. Die
 * Aufloesung muss diese Trennung mitmachen, sonst gewinnt schlicht die zuletzt gelesene
 * Zeile und der jeweils andere Topf steht auf null (Befund R20).
 */
const GETEILT = '#geteilt';
const bereichVon = (eigentuemerId: string | null) => eigentuemerId ?? GETEILT;
export type KategorieZeile = { id: string; parentId: string | null };

export type BudgetImMonat = {
	budgetId: string;
	name: string;
	/** Entscheidet, AUS WELCHEM TOPF VON AUSGABEN dieser Topf sich bedient. */
	sichtbarkeit: 'geteilt' | 'privat';
	/** null = fuer diesen Monat ist kein Betrag festgelegt. Nicht 0 — das waere eine Behauptung. */
	betragCents: number | null;
	/** Alle Kategorien, die in diesem Monat in diesen Topf fallen — samt geerbter. */
	kategorieIds: string[];
};

const MONAT = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * `budgets` enthaelt ALLE Toepfe, auch solche ohne Betrag und ohne laufende Zuordnung
 * (ein geloeschter Topf hat nur beendete Zuordnungen). Diese Rechnung stellt dar, was
 * ist; was davon gezeigt wird, entscheidet der Aufrufer — fuer einen vergangenen Monat
 * traegt ein geloeschter Topf seine Kategorien weiterhin, und das ist der Punkt.
 */
export function budgetsFuerMonat(
	budgets: BudgetZeile[],
	betraege: BetragZeile[],
	zuordnungen: ZuordnungZeile[],
	kategorien: KategorieZeile[],
	monat: string
): { budgets: BudgetImMonat[]; ausserhalb: string[] } {
	const leer = {
		budgets: budgets
			.map((b) => ({
				budgetId: b.id,
				name: b.name,
				sichtbarkeit: b.sichtbarkeit,
				betragCents: null,
				kategorieIds: []
			}))
			.sort((a, b) => a.name.localeCompare(b.name, 'de')),
		ausserhalb: kategorien.map((k) => k.id)
	};
	if (!MONAT.test(monat)) return leer;
	const erster = `${monat}-01`;

	// Der letzte Betrag, der am Ersten schon galt.
	const betragJeTopf = new Map<string, { giltAb: string; amountCents: number }>();
	for (const b of betraege) {
		if (b.giltAb > erster) continue;
		const bisher = betragJeTopf.get(b.budgetId);
		if (!bisher || b.giltAb > bisher.giltAb) betragJeTopf.set(b.budgetId, b);
	}

	// Zuordnungen, die am Ersten liefen: begonnen und noch nicht beendet — GETRENNT nach
	// Geltungsbereich. Eine flache Zuordnung Kategorie→Topf liesse einen gemeinsamen und
	// einen privaten Topf derselben Kategorie einander verdraengen.
	const jeBereich = new Map<string, Map<string, string>>();
	for (const z of zuordnungen) {
		if (z.giltAb > erster) continue;
		if (z.giltBis !== null && z.giltBis < erster) continue;
		const b = bereichVon(z.eigentuemerId);
		let m = jeBereich.get(b);
		if (!m) {
			m = new Map<string, string>();
			jeBereich.set(b, m);
		}
		m.set(z.categoryId, z.budgetId);
	}

	/**
	 * Der genauere Eintrag gewinnt: hat die Kategorie selbst eine Zuordnung, gilt die;
	 * sonst die ihrer Oberkategorie. Mehr als zwei Ebenen gibt es nicht — das erzwingt
	 * ein Trigger auf `categories`.
	 */
	const nachTopf = new Map<string, string[]>();
	const abgedeckt = new Set<string>();
	for (const m of jeBereich.values()) {
		for (const k of kategorien) {
			const topf = m.get(k.id) ?? (k.parentId ? m.get(k.parentId) : undefined);
			if (topf === undefined) continue;
			abgedeckt.add(k.id);
			const liste = nachTopf.get(topf);
			if (liste) liste.push(k.id);
			else nachTopf.set(topf, [k.id]);
		}
	}
	// „Ausserhalb" heisst: in KEINEM der sichtbaren Bereiche gefuehrt. Die Aufrufer
	// laden nur Zuordnungen sichtbarer Toepfe, hier stehen also nur der gemeinsame
	// Bereich und der eigene private.
	const ausserhalb = kategorien.filter((k) => !abgedeckt.has(k.id)).map((k) => k.id);

	return {
		budgets: budgets
			.map((b) => ({
				budgetId: b.id,
				name: b.name,
				betragCents: betragJeTopf.get(b.id)?.amountCents ?? null,
				sichtbarkeit: b.sichtbarkeit,
				kategorieIds: nachTopf.get(b.id) ?? []
			}))
			.sort((a, b) => a.name.localeCompare(b.name, 'de')),
		ausserhalb
	};
}
