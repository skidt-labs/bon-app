/**
 * Die fuenf Seiten der App und die Regeln, wie ein Pfad zu einer Seite wird.
 *
 * Reine Daten und reine Funktionen — die Komponenten (Symbolleiste, LeisteUnten)
 * lesen hier nur ab. So laesst sich "welche Seite ist aktiv" testen, ohne eine
 * Komponente zu rendern; die Suite hat keine Komponententests, und das soll so bleiben.
 */
export type SeitenId = 'start' | 'scannen' | 'posteingang' | 'bons' | 'berichte' | 'einstellungen';
export type SymbolName =
	| 'haus'
	| 'kamera'
	| 'datei'
	| 'ablage'
	| 'beleg'
	| 'balken'
	| 'zahnrad'
	| 'nutzer'
	| 'suche'
	| 'links'
	| 'rechts';

export const SEITEN: readonly { id: SeitenId; weg: string; titel: string; symbol: SymbolName }[] = [
	{ id: 'start', weg: '/dashboard', titel: 'Start', symbol: 'haus' },
	{ id: 'scannen', weg: '/scan', titel: 'Scannen', symbol: 'kamera' },
	{ id: 'posteingang', weg: '/inbox', titel: 'Posteingang', symbol: 'ablage' },
	{ id: 'bons', weg: '/receipts', titel: 'Bons', symbol: 'beleg' },
	{ id: 'berichte', weg: '/reports', titel: 'Berichte', symbol: 'balken' },
	{ id: 'einstellungen', weg: '/settings/household', titel: 'Einstellungen', symbol: 'zahnrad' }
];

/**
 * Die Plaetze der Leiste unten. Seit 0.12.0 stehen an der Stelle des einen
 * Scannen-Knopfs zwei erhoehte Knoepfe: **Kamera** oeffnet direkt die Kamera,
 * **Datei** direkt die Auswahl (mehrere Fotos) — ein Klick statt zwei (Wunsch der
 * Nutzerin, 06.11.2026). Beide sind keine Seiten, sondern Dateieingaben, die danach
 * nach /scan ins Zuschneiden fuehren. Am Rechner bleibt „Scannen" (Symbolleiste).
 * Die Kamera bleibt das auffaelligste Element (Entscheidung des Betreibers, 17.09.2026).
 */
export type LeistenPlatz = 'start' | 'posteingang' | 'kamera' | 'datei' | 'berichte';
export const HANDY_ZIELE: readonly LeistenPlatz[] = [
	'start',
	'posteingang',
	'kamera',
	'datei',
	'berichte'
];

const BON_ID = /^\/receipts\/[0-9a-f-]{8,}/i;

export function aktiveSeite(pfad: string): SeitenId | null {
	const p = pfad.split('?')[0];
	// Die Eingangstuer zeigt am Handy die Kamera, am Schreibtisch den Ueberblick — und
	// setzt die Adresse dort sofort auf /dashboard um. Fuer die Leiste unten, die es nur
	// am Handy gibt, ist „Scannen" deshalb die richtige Antwort.
	if (p === '/' || p === '/scan') return 'scannen';
	if (p === '/dashboard') return 'start';
	if (p === '/inbox' || p.startsWith('/inbox/')) return 'posteingang';
	if (p === '/receipts' || p.startsWith('/receipts/')) return 'bons';
	// Die Druckansicht ist fuers Papier: ohne Leisten, ohne Navigation.
	if (p === '/reports/druck') return null;
	if (p === '/reports' || p.startsWith('/reports/')) return 'berichte';
	if (p.startsWith('/settings')) return 'einstellungen';
	return null;
}

/**
 * Die Pruefansicht (/receipts/<id>) hat auf dem Handy einen eigenen festen Fuss mit
 * Summe und "Bestaetigen". Eine Leiste darunter deckte ihn ab. Sie bleibt dort weg,
 * bis Etappe 4 die Ansicht neu baut und den Fuss mit der Leiste zusammen denkt.
 */
export function leisteUntenSichtbar(pfad: string): boolean {
	const p = pfad.split('?')[0];
	if (aktiveSeite(p) === null) return false;
	return !BON_ID.test(p);
}
