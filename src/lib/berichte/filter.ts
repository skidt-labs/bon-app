import {
	istMonat, istTag, monatVon, jahrVon, ersterTag, letzterTag, jahrePlus, tagPlus, monatsName, tagName
} from './kalender';

/**
 * Was ein Bericht zeigt — vollstaendig in der Adresse, damit Zurueck-Knopf, Lesezeichen
 * und geteilte Links ohne eigenen Speicher funktionieren. Ein gespeicherter Bericht ist im
 * Kern eine benannte Adresse (gespeichert.ts liest ihn ueber dieselbe Funktion).
 */
export type Zeitraum =
	| { art: 'monat'; monat: string } // 'YYYY-MM'
	| { art: 'jahr'; jahr: number }
	| { art: 'spanne'; von: string; bis: string }; // 'YYYY-MM-DD', bis einschliesslich

export type BerichtFilter = {
	zeitraum: Zeitraum;
	umfang: 'haushalt' | 'meine';
	/** merchant-Ids; LADEN_UNBEKANNT = Bons ohne erkannten Laden */
	laden: string[];
	/** Kategorie-Slugs (Oberkategorie schliesst ihre Kinder ein); UNSORTIERT = ohne Kategorie */
	kategorie: string[];
	/** user-Ids — wer den Bon erfasst hat */
	person: string[];
	/** Bon-Betrag in Cent, beide Grenzen einschliesslich; null = kein Betragsfilter */
	betrag: { ab: number | null; bis: number | null } | null;
	/** budget-Ids; zaehlt die Kategorien des Topfs im Kaufmonat */
	topf: string[];
	/** Suchbegriff im Positionstext, ohne Gross/Klein und Akzente */
	suche: string | null;
	sicht: 'geteilt' | 'privat' | null;
};

export type Merkmal = 'laden' | 'kategorie' | 'person' | 'betrag' | 'topf' | 'suche' | 'sicht';
export const MERKMALE: Merkmal[] = ['laden', 'kategorie', 'person', 'betrag', 'topf', 'suche', 'sicht'];

export const LADEN_UNBEKANNT = 'ohne';
export const UNSORTIERT = 'unsortiert';
export const SUCHE_HOECHSTENS = 100;
export const HOECHSTENS_JAHRE = 3;
/**
 * Frueher gibt es in dieser App keine Kassenbons. Die Grenze haelt absurde Jahre wie 0500
 * aus der Rechnung: sie liefen sonst bis in die Abfrage und endeten in einem Fehler 500
 * statt in einem Hinweis (Abschlusspruefung Stufe 1).
 */
export const FRUEHESTES_JAHR = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const BETRAG = /^(?:ab:(\d+)|bis:(\d+)|(\d+)-(\d+))$/;
const EURO = /^\d+(?:[.,]\d{1,2})?$/;

export function leererFilter(zeitraum: Zeitraum): BerichtFilter {
	return {
		zeitraum,
		umfang: 'haushalt',
		laden: [],
		kategorie: [],
		person: [],
		betrag: null,
		topf: [],
		suche: null,
		sicht: null
	};
}

/** Erster und letzter Tag (einschliesslich) eines Zeitraums. */
export function zeitraumTage(z: Zeitraum): { von: string; bis: string } {
	switch (z.art) {
		case 'monat':
			return { von: ersterTag(z.monat), bis: letzterTag(z.monat) };
		case 'jahr':
			return { von: `${z.jahr}-01-01`, bis: `${z.jahr}-12-31` };
		case 'spanne':
			return { von: z.von, bis: z.bis };
	}
}

function monatAus(p: URLSearchParams, heute: string, hinweise: string[]): Zeitraum {
	const laufend = monatVon(heute);
	const roh = p.get('monat');
	if (roh === null) return { art: 'monat', monat: laufend };
	if (!istMonat(roh)) {
		hinweise.push(`„${roh}" ist kein Monat — gezeigt wird ${monatsName(laufend)}.`);
		return { art: 'monat', monat: laufend };
	}
	if (roh < `${FRUEHESTES_JAHR}-01`) {
		hinweise.push(`Vor ${FRUEHESTES_JAHR} gibt es keine Bons — gezeigt wird ${monatsName(laufend)}.`);
		return { art: 'monat', monat: laufend };
	}
	if (roh > laufend) {
		hinweise.push(`${monatsName(roh)} liegt in der Zukunft — gezeigt wird ${monatsName(laufend)}.`);
		return { art: 'monat', monat: laufend };
	}
	return { art: 'monat', monat: roh };
}

function jahrAus(p: URLSearchParams, heute: string, hinweise: string[]): Zeitraum {
	const laufend = jahrVon(heute);
	const roh = p.get('jahr');
	if (roh === null) return { art: 'jahr', jahr: laufend };
	if (!/^\d{4}$/.test(roh)) {
		hinweise.push(`„${roh}" ist kein Jahr — gezeigt wird ${laufend}.`);
		return { art: 'jahr', jahr: laufend };
	}
	const jahr = Number(roh);
	if (jahr < FRUEHESTES_JAHR) {
		hinweise.push(`Vor ${FRUEHESTES_JAHR} gibt es keine Bons — gezeigt wird ${laufend}.`);
		return { art: 'jahr', jahr: laufend };
	}
	if (jahr > laufend) {
		hinweise.push(`${jahr} liegt in der Zukunft — gezeigt wird ${laufend}.`);
		return { art: 'jahr', jahr: laufend };
	}
	return { art: 'jahr', jahr };
}

function spanneAus(p: URLSearchParams, heute: string, hinweise: string[]): Zeitraum {
	const vonRoh = p.get('von');
	const bisRoh = p.get('bis');
	const frueh = `${FRUEHESTES_JAHR}-01-01`;
	if (vonRoh === null || bisRoh === null || !istTag(vonRoh) || !istTag(bisRoh) || vonRoh < frueh || bisRoh < frueh) {
		hinweise.push('Von–bis braucht zwei gültige Tage — gezeigt wird der laufende Monat bis heute.');
		return { art: 'spanne', von: ersterTag(monatVon(heute)), bis: heute };
	}
	let von = vonRoh;
	let bis = bisRoh;
	if (von > bis) {
		[von, bis] = [bis, von];
		hinweise.push('„Von" lag nach „bis" — die beiden Tage wurden getauscht.');
	}
	if (bis > heute) {
		bis = heute;
		if (von > bis) von = bis;
		hinweise.push('„Bis" lag in der Zukunft — gezeigt wird bis heute.');
	}
	const fruehestens = tagPlus(jahrePlus(bis, -HOECHSTENS_JAHRE), 1);
	if (von < fruehestens) {
		von = fruehestens;
		hinweise.push(`Höchstens ${HOECHSTENS_JAHRE} Jahre am Stück — gezeigt wird ab ${tagName(von)}.`);
	}
	return { art: 'spanne', von, bis };
}

function zeitraumAus(p: URLSearchParams, heute: string, hinweise: string[]): Zeitraum {
	const art = p.get('zeitraum') ?? 'monat';
	if (art === 'jahr') return jahrAus(p, heute, hinweise);
	if (art === 'spanne') return spanneAus(p, heute, hinweise);
	if (art !== 'monat') {
		hinweise.push(`„${art}" ist kein Zeitraum — gezeigt wird ${monatsName(monatVon(heute))}.`);
		return { art: 'monat', monat: monatVon(heute) };
	}
	return monatAus(p, heute, hinweise);
}

/**
 * Eine Werteliste: kommagetrennt UND/ODER wiederholt (Kontrollkaestchen derselben Gruppe
 * schicken den Namen mehrfach). Unbrauchbares wird je Wert einmal gemeldet.
 */
function listeAus(
	p: URLSearchParams,
	name: string,
	gueltig: (w: string) => boolean,
	was: string,
	hinweise: string[]
): string[] {
	const teile = p
		.getAll(name)
		.flatMap((w) => w.split(','))
		.map((t) => t.trim())
		.filter(Boolean);
	for (const t of new Set(teile.filter((t) => !gueltig(t)))) hinweise.push(`„${t}" ist ${was} — ignoriert.`);
	return [...new Set(teile.filter(gueltig))];
}

const idListe = (p: URLSearchParams, name: string, was: string, hinweise: string[]) =>
	[...new Set(listeAus(p, name, (w) => UUID.test(w), was, hinweise).map((w) => w.toLowerCase()))];

function euroAlsCent(roh: string): number | null {
	const t = roh.trim();
	if (!EURO.test(t)) return null;
	return Math.round(Number(t.replace(',', '.')) * 100);
}

function betragAus(p: URLSearchParams, hinweise: string[]): BerichtFilter['betrag'] {
	let ab: number | null = null;
	let bis: number | null = null;
	const roh = p.get('betrag');
	if (roh !== null && roh !== '') {
		const m = BETRAG.exec(roh);
		if (!m) hinweise.push(`„${roh}" ist keine Betragsspanne — ignoriert.`);
		else if (m[1] !== undefined) ab = Number(m[1]);
		else if (m[2] !== undefined) bis = Number(m[2]);
		else {
			ab = Number(m[3]);
			bis = Number(m[4]);
		}
	}
	// Das Formular der Filterauswahl schickt Euro, die Adresse fuehrt Cent.
	for (const [feld, setze] of [
		['betrag_ab', (c: number) => (ab = c)],
		['betrag_bis', (c: number) => (bis = c)]
	] as const) {
		const wert = p.get(feld)?.trim();
		if (!wert) continue;
		const c = euroAlsCent(wert);
		if (c === null) hinweise.push(`„${wert}" ist kein Betrag — ignoriert.`);
		else setze(c);
	}
	if (ab === null && bis === null) return null;
	if (ab !== null && bis !== null && ab > bis) {
		[ab, bis] = [bis, ab];
		hinweise.push('Die Betragsgrenzen waren vertauscht — sie wurden getauscht.');
	}
	return { ab, bis };
}

function sucheAus(p: URLSearchParams, hinweise: string[]): string | null {
	const roh = p.get('suche');
	if (roh === null) return null;
	const t = roh.trim();
	if (t === '') return null;
	// Nach ZEICHEN kuerzen, nicht nach UTF-16-Einheiten: slice() schnitt ein Emoji an der
	// Grenze in der Mitte durch, und encodeURIComponent warf beim Bauen jedes Links (500).
	const zeichen = Array.from(t);
	if (zeichen.length > SUCHE_HOECHSTENS) {
		hinweise.push(`Der Suchbegriff ist länger als ${SUCHE_HOECHSTENS} Zeichen — gesucht wird nach dem Anfang.`);
		return zeichen.slice(0, SUCHE_HOECHSTENS).join('');
	}
	return t;
}

function sichtAus(p: URLSearchParams, hinweise: string[]): BerichtFilter['sicht'] {
	const roh = p.get('sicht');
	if (roh === null || roh === '') return null;
	if (roh === 'geteilt' || roh === 'privat') return roh;
	hinweise.push(`„${roh}" ist weder „geteilt" noch „privat" — ignoriert.`);
	return null;
}

/**
 * Liest den Filter aus der Adresse. Unbrauchbares wird ignoriert UND gemeldet — still zu
 * raten waere schlimmer als zu antworten (dieselbe Regel wie in der Bon-Liste).
 */
export function filterAusAdresse(
	p: URLSearchParams,
	heute: string
): { filter: BerichtFilter; hinweise: string[] } {
	const hinweise: string[] = [];
	const zeitraum = zeitraumAus(p, heute, hinweise);

	const umfangRoh = p.get('umfang');
	let umfang: BerichtFilter['umfang'] = 'haushalt';
	if (umfangRoh === 'meine') umfang = 'meine';
	else if (umfangRoh !== null && umfangRoh !== 'haushalt') {
		hinweise.push(`„${umfangRoh}" ist kein Umfang — gezeigt wird der ganze Haushalt.`);
	}

	const laden = [
		...new Set(
			listeAus(p, 'laden', (w) => w === LADEN_UNBEKANNT || UUID.test(w), 'kein Laden', hinweise).map((w) => w.toLowerCase())
		)
	];
	const kategorie = listeAus(p, 'kategorie', (w) => SLUG.test(w), 'keine Kategorie', hinweise);
	const person = idListe(p, 'person', 'keine Person', hinweise);
	const betrag = betragAus(p, hinweise);
	const topf = idListe(p, 'topf', 'kein Topf', hinweise);
	const suche = sucheAus(p, hinweise);
	const sicht = sichtAus(p, hinweise);

	// Jeder Hinweis nur einmal: die Seite schluesselt die Hinweise nach ihrem Text.
	return {
		filter: { zeitraum, umfang, laden, kategorie, person, betrag, topf, suche, sicht },
		hinweise: [...new Set(hinweise)]
	};
}

export function zeitraumParameter(z: Zeitraum): Record<string, string> {
	if (z.art === 'monat') return { zeitraum: 'monat', monat: z.monat };
	if (z.art === 'jahr') return { zeitraum: 'jahr', jahr: String(z.jahr) };
	return { zeitraum: 'spanne', von: z.von, bis: z.bis };
}

function betragAlsText(b: NonNullable<BerichtFilter['betrag']>): string {
	if (b.ab !== null && b.bis !== null) return `${b.ab}-${b.bis}`;
	if (b.ab !== null) return `ab:${b.ab}`;
	return `bis:${b.bis}`;
}

/** Die Merkmale (und „Nur meine") als Parameter, ohne Zeitraum — so speichert gespeichert.ts. */
export function merkmalParameter(f: BerichtFilter): Record<string, string> {
	const p: Record<string, string> = {};
	if (f.umfang === 'meine') p.umfang = 'meine';
	if (f.laden.length > 0) p.laden = f.laden.join(',');
	if (f.kategorie.length > 0) p.kategorie = f.kategorie.join(',');
	if (f.person.length > 0) p.person = f.person.join(',');
	if (f.betrag !== null) p.betrag = betragAlsText(f.betrag);
	if (f.topf.length > 0) p.topf = f.topf.join(',');
	if (f.suche !== null) p.suche = f.suche;
	if (f.sicht !== null) p.sicht = f.sicht;
	return p;
}

/**
 * Die kanonische Adresse (ohne „?"). Kommata und Doppelpunkte bleiben lesbar stehen; nur
 * die Suche wird kodiert, weil sie freien Text traegt.
 */
export function filterAlsAdresse(f: BerichtFilter): string {
	const teile = { ...zeitraumParameter(f.zeitraum), ...merkmalParameter(f) };
	return Object.entries(teile)
		.map(([k, v]) => `${k}=${k === 'suche' ? encodeURIComponent(v) : v}`)
		.join('&');
}

/** Filter, die einzelne POSITIONEN auswaehlen statt ganzer Bons. */
export function wirktAufPositionen(f: BerichtFilter): boolean {
	return f.kategorie.length > 0 || f.suche !== null || f.topf.length > 0;
}

/** Ob irgendein Merkmal gesetzt ist. Zeitraum und „Nur meine" sind keine Filter. */
export function hatFilter(f: BerichtFilter): boolean {
	return (
		f.laden.length > 0 ||
		f.kategorie.length > 0 ||
		f.person.length > 0 ||
		f.betrag !== null ||
		f.topf.length > 0 ||
		f.suche !== null ||
		f.sicht !== null
	);
}

export function ohneMerkmal(f: BerichtFilter, m: Merkmal): BerichtFilter {
	switch (m) {
		case 'betrag':
			return { ...f, betrag: null };
		case 'suche':
			return { ...f, suche: null };
		case 'sicht':
			return { ...f, sicht: null };
		default:
			return { ...f, [m]: [] };
	}
}

export function ohneFilter(f: BerichtFilter): BerichtFilter {
	return { ...leererFilter(f.zeitraum), umfang: f.umfang };
}

/**
 * Warum die Budgets in diesem Bericht nicht erscheinen — oder null, wenn sie es tun.
 *
 * Ein Topf rechnet mit dem, was ihm gehoert (geteilt: der ganze Haushalt). Unter „Nur
 * meine" oder mit einem Filter stuende daneben eine Summe, die sich aus den gezeigten
 * Bons nicht nachrechnen laesst. Ein Betrag, den niemand nachrechnen kann, ist eine
 * Behauptung — lieber keiner, mit Grund.
 */
export function budgetsNichtZeigbar(f: BerichtFilter): string | null {
	if (f.umfang === 'meine') return 'Budgets gelten für den ganzen Haushalt — sie erscheinen unter „Haushalt".';
	if (f.zeitraum.art === 'spanne') return 'Budgets gelten je Monat — sie erscheinen bei „Monat" und „Jahr".';
	if (hatFilter(f)) return 'Budgets erscheinen nur im ungefilterten Bericht.';
	return null;
}
