import { formatCents } from '$lib/money';
import { filterAlsAdresse, zeitraumTage, type BerichtFilter, type Zeitraum } from './filter';
import {
	ersterTag, jahrVon, jahrePlus, letzterTag, monatPlus, monatVon, monatsKurz, monatsName, tagName,
	tagPlus, tageZwischen
} from './kalender';

/** null = im Vergleichszeitraum liegt kein bestaetigter Bon; das ist KEIN 0 %. */
export type Vergleich = { bezeichnung: string; cents: number | null; prozent: number | null };
export type VergleichsRaum = { bezeichnung: string; von: string; bis: string };

const VERLAUF_MONATE = 12;

function spannenName(von: string, bis: string): string {
	if (von === bis) return tagName(von);
	if (von.slice(0, 4) === bis.slice(0, 4)) return `${tagName(von, false)} – ${tagName(bis)}`;
	return `${tagName(von)} – ${tagName(bis)}`;
}

export function zeitraumName(z: Zeitraum): string {
	if (z.art === 'monat') return monatsName(z.monat);
	if (z.art === 'jahr') return String(z.jahr);
	return spannenName(z.von, z.bis);
}

/**
 * Wohin „‹" und „›" fuehren. „‹" gibt es immer, „›" nur, solange das Ziel nicht in der
 * Zukunft beginnt — ein Bericht ueber die Zukunft ist leer.
 */
export function blaetterZiele(z: Zeitraum, heute: string): { zurueck: Zeitraum; vor: Zeitraum | null } {
	if (z.art === 'monat') {
		const vor = monatPlus(z.monat, 1);
		return {
			zurueck: { art: 'monat', monat: monatPlus(z.monat, -1) },
			vor: vor <= monatVon(heute) ? { art: 'monat', monat: vor } : null
		};
	}
	if (z.art === 'jahr') {
		return {
			zurueck: { art: 'jahr', jahr: z.jahr - 1 },
			vor: z.jahr + 1 <= jahrVon(heute) ? { art: 'jahr', jahr: z.jahr + 1 } : null
		};
	}
	const laenge = tageZwischen(z.von, z.bis) + 1;
	const vonVor = tagPlus(z.von, laenge);
	const bisVor = tagPlus(z.bis, laenge);
	return {
		zurueck: { art: 'spanne', von: tagPlus(z.von, -laenge), bis: tagPlus(z.bis, -laenge) },
		vor: vonVor <= heute ? { art: 'spanne', von: vonVor, bis: bisVor < heute ? bisVor : heute } : null
	};
}

/** Wechsel Monat | Jahr | Von–bis, mit Bezug zum gerade gezeigten Zeitraum. */
export function wechsleArt(z: Zeitraum, art: Zeitraum['art'], heute: string): Zeitraum {
	if (z.art === art) return z;
	const { von, bis } = zeitraumTage(z);
	// Der letzte Tag, der schon war — ein Jahr endet sonst im Dezember der Zukunft.
	const ende = bis < heute ? bis : heute;
	if (art === 'monat') return { art: 'monat', monat: monatVon(ende) };
	if (art === 'jahr') return { art: 'jahr', jahr: jahrVon(ende) };
	return { art: 'spanne', von, bis: ende };
}

export function vergleichsZeitraeume(z: Zeitraum, heute: string): VergleichsRaum[] {
	if (z.art === 'monat') {
		const vormonat = monatPlus(z.monat, -1);
		const vorjahr = monatPlus(z.monat, -12);
		return [
			{ bezeichnung: monatsName(vormonat), von: ersterTag(vormonat), bis: letzterTag(vormonat) },
			{ bezeichnung: monatsName(vorjahr), von: ersterTag(vorjahr), bis: letzterTag(vorjahr) }
		];
	}
	if (z.art === 'jahr') {
		const vorjahr = z.jahr - 1;
		const ganz: VergleichsRaum = { bezeichnung: String(vorjahr), von: `${vorjahr}-01-01`, bis: `${vorjahr}-12-31` };
		if (z.jahr !== jahrVon(heute)) return [ganz];
		// Ein laufendes Jahr gegen ein ganzes Vorjahr waere bis Dezember immer „billiger".
		const bisVorjahr = jahrePlus(heute, -1);
		return [
			{ bezeichnung: `${vorjahr} bis ${tagName(bisVorjahr, false)}`, von: `${vorjahr}-01-01`, bis: bisVorjahr },
			ganz
		];
	}
	const laenge = tageZwischen(z.von, z.bis) + 1;
	const von = tagPlus(z.von, -laenge);
	const bis = tagPlus(z.von, -1);
	return [{ bezeichnung: spannenName(von, bis), von, bis }];
}

/** Die Monate des Verlaufs, aeltester zuerst. Im Jahr sind kuenftige Monate „offen". */
export function verlaufsAchse(z: Zeitraum, heute: string): { monat: string; offen: boolean }[] {
	if (z.art === 'jahr') {
		const laufend = monatVon(heute);
		return Array.from({ length: 12 }, (_, i) => {
			const monat = `${z.jahr}-${String(i + 1).padStart(2, '0')}`;
			return { monat, offen: monat > laufend };
		});
	}
	const ende = z.art === 'monat' ? z.monat : monatVon(z.bis);
	return Array.from({ length: VERLAUF_MONATE }, (_, i) => ({
		monat: monatPlus(ende, i - (VERLAUF_MONATE - 1)),
		offen: false
	}));
}

/**
 * Die Tage, die EINE Abfrage laden muss, damit Zeitraum, Vergleiche und Verlauf daraus
 * gerechnet werden koennen. Im Jahr gehoert das Vorjahr dazu (Vorjahrespunkte im Verlauf).
 */
export function ladeFenster(z: Zeitraum, heute: string): { von: string; bis: string } {
	const achse = verlaufsAchse(z, heute);
	const raeume = [
		zeitraumTage(z),
		...vergleichsZeitraeume(z, heute),
		{ von: ersterTag(achse[0].monat), bis: letzterTag(achse[achse.length - 1].monat) }
	];
	return {
		von: raeume.map((r) => r.von).reduce((a, b) => (a < b ? a : b)),
		bis: raeume.map((r) => r.bis).reduce((a, b) => (a > b ? a : b))
	};
}

/** Ob ein Verlaufsmonat zum gewaehlten Zeitraum gehoert (hervorgehoben). */
export function monatImZeitraum(monat: string, z: Zeitraum): boolean {
	const { von, bis } = zeitraumTage(z);
	return ersterTag(monat) <= bis && letzterTag(monat) >= von;
}

export function zeitwahlKacheln(
	jahr: number,
	heute: string,
	summen: Record<string, number>
): { monat: string; kurz: string; cents: number | null; gesperrt: boolean }[] {
	const laufend = monatVon(heute);
	return Array.from({ length: 12 }, (_, i) => {
		const monat = `${jahr}-${String(i + 1).padStart(2, '0')}`;
		return { monat, kurz: monatsKurz(monat), cents: summen[monat] ?? null, gesperrt: monat > laufend };
	});
}

export function jahresAuswahl(heute: string, summen: Record<string, number>): number[] {
	const laufend = jahrVon(heute);
	const fruehestes = Math.min(laufend, ...Object.keys(summen).map((m) => Number(m.slice(0, 4))));
	return Array.from({ length: laufend - fruehestes + 1 }, (_, i) => laufend - i);
}

export function vergleichText(v: Vergleich): string {
	if (v.cents === null) return `Kein Vergleich zu ${v.bezeichnung} — dort liegt kein bestätigter Bon`;
	if (v.prozent === null) return `Kein Prozentwert zu ${v.bezeichnung} (${formatCents(v.cents)} €)`;
	const zeichen = v.prozent > 0 ? '+' : v.prozent < 0 ? '−' : '±';
	return `${zeichen}${Math.abs(v.prozent)} % zu ${v.bezeichnung}`;
}

/** Ein Link auf eine Berichtsseite mit diesem Filter. */
export function adresse(pfad: string, f: BerichtFilter, zusatz: Record<string, string> = {}): string {
	const extra = Object.entries(zusatz).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
	return `${pfad}?${[filterAlsAdresse(f), ...extra].join('&')}`;
}

/**
 * Was die Seite sagt, wenn im Zeitraum nichts zaehlt — passend zum Filter. „Noch kein Bon
 * bestaetigt" stimmt nur ohne Filter; unter „Nur meine" oder mit Laden/Kategorie kann der
 * Haushalt sehr wohl bestaetigte Bons haben (Abschlusspruefung Stufe 1).
 */
export function leerText(f: BerichtFilter): { text: string; zurueck: { text: string; filter: BerichtFilter } | null } {
	const name = zeitraumName(f.zeitraum);
	if (f.laden.length > 0 || f.kategorie.length > 0) {
		return {
			text: `Für ${name} gibt es keinen passenden bestätigten Bon.`,
			zurueck: { text: 'Ohne Filter zeigen', filter: { ...f, laden: [], kategorie: [] } }
		};
	}
	if (f.umfang === 'meine') {
		return {
			text: `Für ${name} hast du keinen eigenen bestätigten Bon.`,
			zurueck: { text: 'Ganzen Haushalt zeigen', filter: { ...f, umfang: 'haushalt' } }
		};
	}
	return { text: `Für ${name} ist noch kein Bon bestätigt.`, zurueck: null };
}
