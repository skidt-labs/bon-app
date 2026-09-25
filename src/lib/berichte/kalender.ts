/**
 * Reine Kalenderrechnung auf Zeichenketten — 'YYYY-MM' fuer Monate, 'YYYY-MM-DD' fuer Tage.
 *
 * Bewusst ohne Zeitzone: welcher Tag auf welchen folgt, ist keine Frage der Sommerzeit.
 * Gerechnet wird ueber UTC-Mittag, dort gibt es keine Umstellung. Die Zuordnung eines
 * ZEITPUNKTS zu einem Berliner Tag macht der Server (zeit.ts, Postgres), nicht diese Datei.
 *
 * Gemeinsam fuer Server und Oberflaeche — deshalb nicht unter $lib/server.
 */
const MONAT = /^(\d{4})-(0[1-9]|1[0-2])$/;
const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_MS = 86_400_000;

export function istMonat(s: string): boolean {
	return MONAT.test(s);
}

export function tageImMonat(jahr: number, monat: number): number {
	return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

export function istTag(s: string): boolean {
	const m = TAG.exec(s);
	if (!m) return false;
	const monat = Number(m[2]);
	const tag = Number(m[3]);
	return monat >= 1 && monat <= 12 && tag >= 1 && tag <= tageImMonat(Number(m[1]), monat);
}

function alsMs(tag: string): number {
	const [j, m, t] = tag.split('-').map(Number);
	return Date.UTC(j, m - 1, t, 12);
}

function ausMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function tagPlus(tag: string, n: number): string {
	return ausMs(alsMs(tag) + n * TAG_MS);
}

/** Wie viele Tage `bis` nach `von` liegt (gleicher Tag = 0). */
export function tageZwischen(von: string, bis: string): number {
	return Math.round((alsMs(bis) - alsMs(von)) / TAG_MS);
}

export function monatPlus(monat: string, n: number): string {
	const [j, m] = monat.split('-').map(Number);
	const index = j * 12 + (m - 1) + n;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function ersterTag(monat: string): string {
	return `${monat}-01`;
}

export function letzterTag(monat: string): string {
	const [j, m] = monat.split('-').map(Number);
	return `${monat}-${String(tageImMonat(j, m)).padStart(2, '0')}`;
}

export function monatVon(tag: string): string {
	return tag.slice(0, 7);
}

export function jahrVon(tag: string): number {
	return Number(tag.slice(0, 4));
}

/** Derselbe Kalendertag `n` Jahre verschoben; ein 29. Februar wird im Gemeinjahr zum 28. */
export function jahrePlus(tag: string, n: number): string {
	const [j, m, t] = tag.split('-').map(Number);
	const jahr = j + n;
	const neuerTag = Math.min(t, tageImMonat(jahr, m));
	return `${jahr}-${String(m).padStart(2, '0')}-${String(neuerTag).padStart(2, '0')}`;
}

const LANGER_MONAT = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const KURZER_MONAT = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });
const TAG_OHNE_JAHR = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const TAG_MIT_JAHR = new Intl.DateTimeFormat('de-DE', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

const mittag = (tag: string) => new Date(alsMs(tag));

/** „September 2026" */
export function monatsName(monat: string): string {
	return LANGER_MONAT.format(mittag(ersterTag(monat)));
}

/** „Sep" — fuer Verlaufsachse und Kacheln. */
export function monatsKurz(monat: string): string {
	return KURZER_MONAT.format(mittag(ersterTag(monat)));
}

/** „25. Sept. 2026" bzw. ohne Jahr „25. Sept." */
export function tagName(tag: string, mitJahr = true): string {
	return (mitJahr ? TAG_MIT_JAHR : TAG_OHNE_JAHR).format(mittag(tag));
}
