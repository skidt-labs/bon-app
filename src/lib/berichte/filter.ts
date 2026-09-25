import {
	istMonat, istTag, monatVon, jahrVon, ersterTag, letzterTag, jahrePlus, tagPlus, monatsName, tagName
} from './kalender';

/**
 * Was ein Bericht zeigt — vollstaendig in der Adresse, damit Zurueck-Knopf, Lesezeichen
 * und geteilte Links ohne eigenen Speicher funktionieren. Ein gespeicherter Bericht
 * (Stufe 2) ist im Kern eine benannte Adresse.
 */
export type Zeitraum =
	| { art: 'monat'; monat: string } // 'YYYY-MM'
	| { art: 'jahr'; jahr: number }
	| { art: 'spanne'; von: string; bis: string }; // 'YYYY-MM-DD', bis einschliesslich

export type BerichtFilter = {
	zeitraum: Zeitraum;
	umfang: 'haushalt' | 'meine';
	/** merchant-Ids */
	laden: string[];
	/** Kategorie-Slugs; eine Oberkategorie schliesst ihre Kinder ein. */
	kategorie: string[];
	// Stufe 2 — im Typ schon da, in Stufe 1 immer leer.
	person: string[];
	betrag: { ab?: number; bis?: number } | null;
	topf: string[];
	suche: string | null;
	sicht: 'geteilt' | 'privat' | null;
};

export const HOECHSTENS_JAHRE = 3;
/**
 * Frueher gibt es in dieser App keine Kassenbons. Die Grenze haelt absurde Jahre wie 0500
 * aus der Rechnung: sie liefen sonst bis in die Abfrage und endeten in einem Fehler 500
 * statt in einem Hinweis (Abschlusspruefung Stufe 1).
 */
export const FRUEHESTES_JAHR = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** Parameter, die erst Stufe 2 versteht. Sie werden gemeldet, nicht still uebergangen. */
const STUFE_ZWEI = ['person', 'betrag', 'topf', 'suche', 'sicht', 'bericht'];

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

function listeAus(
	p: URLSearchParams,
	name: string,
	gueltig: (w: string) => boolean,
	was: string,
	hinweise: string[]
): string[] {
	const roh = p.get(name);
	if (roh === null) return [];
	const teile = roh.split(',').map((t) => t.trim()).filter(Boolean);
	for (const t of teile.filter((t) => !gueltig(t))) hinweise.push(`„${t}" ist ${was} — ignoriert.`);
	return [...new Set(teile.filter(gueltig))];
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

	const laden = listeAus(p, 'laden', (w) => UUID.test(w), 'kein Laden', hinweise).map((w) => w.toLowerCase());
	const kategorie = listeAus(p, 'kategorie', (w) => SLUG.test(w), 'keine Kategorie', hinweise);

	for (const n of STUFE_ZWEI) {
		if (p.has(n)) hinweise.push(`Der Filter „${n}" kommt erst noch — er wurde nicht angewendet.`);
	}

	// Jeder Hinweis nur einmal: „laden=x,x" meldete sonst zweimal dasselbe, und die Seite
	// schluesselt die Hinweise nach ihrem Text.
	return { filter: { ...leererFilter(zeitraum), umfang, laden: [...new Set(laden)], kategorie }, hinweise: [...new Set(hinweise)] };
}

/**
 * Die kanonische Adresse (ohne „?"). Kommata bleiben lesbar stehen: Ids, Slugs und Tage
 * enthalten keine Zeichen, die kodiert werden muessten.
 */
export function filterAlsAdresse(f: BerichtFilter): string {
	const teile: string[] = [`zeitraum=${f.zeitraum.art}`];
	const z = f.zeitraum;
	if (z.art === 'monat') teile.push(`monat=${z.monat}`);
	else if (z.art === 'jahr') teile.push(`jahr=${z.jahr}`);
	else teile.push(`von=${z.von}`, `bis=${z.bis}`);
	if (f.umfang === 'meine') teile.push('umfang=meine');
	if (f.laden.length > 0) teile.push(`laden=${f.laden.join(',')}`);
	if (f.kategorie.length > 0) teile.push(`kategorie=${f.kategorie.join(',')}`);
	return teile.join('&');
}

/** Filter, die einzelne POSITIONEN auswaehlen statt ganzer Bons. */
export function wirktAufPositionen(f: BerichtFilter): boolean {
	return f.kategorie.length > 0 || f.suche !== null || f.topf.length > 0;
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
	if (f.laden.length > 0 || wirktAufPositionen(f)) return 'Budgets erscheinen nur im ungefilterten Bericht.';
	return null;
}
