/**
 * Doppel vergleichen (Entwurf 2026-11-06-doppel-vergleich) — rein, fuer Seite und Server.
 *
 * `unterschiede` sagt, welche Werte der Gegenueberstellung hervorgehoben werden; ein fehlender
 * Wert zaehlt immer als Unterschied (auch wenn er bei beiden fehlt — dann fehlt er eben).
 * `rueckfrageSatz` ist der Satz der Rueckfrage vor „Diesen behalten" / „Nur das Bild uebernehmen".
 */
import { formatCents } from '$lib/money';
import { PAPIERKORB_TAGE } from '$lib/bons/papierkorb';

export type Unterschied = 'laden' | 'kaufzeit' | 'summe' | 'positionen';

type Vergleichbar = {
	merchantNameRaw: string | null;
	purchasedAt: Date | string | null;
	totalGrossCents: number | null;
	anzahlPositionen: number | null;
};

const zeit = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

export function unterschiede(a: Vergleichbar, b: Vergleichbar): Set<Unterschied> {
	const u = new Set<Unterschied>();
	const ladenA = a.merchantNameRaw?.trim().toLocaleLowerCase('de-DE') || null;
	const ladenB = b.merchantNameRaw?.trim().toLocaleLowerCase('de-DE') || null;
	if (ladenA === null || ladenB === null || ladenA !== ladenB) u.add('laden');
	if (a.purchasedAt === null || b.purchasedAt === null || zeit(a.purchasedAt) !== zeit(b.purchasedAt)) u.add('kaufzeit');
	if (a.totalGrossCents === null || b.totalGrossCents === null || a.totalGrossCents !== b.totalGrossCents) u.add('summe');
	if (a.anzahlPositionen === null || b.anzahlPositionen === null || a.anzahlPositionen !== b.anzahlPositionen) u.add('positionen');
	return u;
}

/** „TT.MM." nach Berliner Zeit — so steht das Datum auf dem Bon. */
function tagMonat(d: Date | string): string {
	return (d instanceof Date ? d : new Date(d)).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' });
}

export function rueckfrageSatz(
	bon: { purchasedAt: Date | string | null; totalGrossCents: number | null; status?: string },
	nummer?: 1 | 2
): string {
	const datum = bon.purchasedAt === null ? 'ohne Datum' : `vom ${tagMonat(bon.purchasedAt)}`;
	const summe = bon.totalGrossCents === null ? 'ohne Summe' : `${formatCents(bon.totalGrossCents)} €`;
	// Bei echten Doppeln sind Datum und Summe gleich — die Nummer der Spalte sagt, welcher gemeint
	// ist; ein bestaetigter faellt aus Berichten und Budgets (Abschlusspruefung 0.12.0).
	const wer = nummer === undefined ? 'Der Bon' : `Bon ${nummer}`;
	const bestaetigt = bon.status === 'confirmed' ? ' Er ist bestätigt und zählt dann nicht mehr in Berichten und Budgets.' : '';
	return `${wer} ${datum} (${summe}) kommt in den Papierkorb.${bestaetigt} ${PAPIERKORB_TAGE} Tage lang kannst du ihn wiederherstellen.`;
}
