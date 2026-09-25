import { ART_TEXT, type LineType } from '$lib/bons/zeilenarten';

/**
 * Die Monatsausfuhr als CSV — eine Zeile je Position.
 *
 * Deutsches Excel erwartet SEMIKOLON als Trennzeichen und Komma als Dezimalzeichen;
 * mit Komma getrennt und Punkt als Dezimalzeichen landet alles in einer Spalte. Und
 * Zeilenenden als CRLF, so steht es in RFC 4180.
 */
export type CsvZeile = {
	datum: string;
	haendler: string | null;
	bonId: string;
	lineNo: number;
	rawText: string;
	lineType: string;
	quantity: string | null;
	unit: string | null;
	unitPriceCents: number | null;
	totalPriceCents: number;
	kategorie: string | null;
	oberkategorie: string | null;
};

const KOPF = [
	'Datum',
	'Händler',
	'Zeile',
	'Bezeichnung',
	'Art',
	'Menge',
	'Einheit',
	'Einzelpreis',
	'Betrag',
	'Betrag in Cent',
	'Kategorie',
	'Oberkategorie',
	'Bon'
];

/** Ein Feld, bei Bedarf in Anfuehrungszeichen — sonst verrutscht die Zeile. */
export function csvFeld(wert: string | number | null): string {
	if (wert === null) return '';
	const s = String(wert);
	if (!/[;"\n\r]/.test(s)) return s;
	return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Ein TEXTfeld, zusaetzlich gegen Formeln abgesichert: beginnt es mit =, +, -, @,
 * Tabulator oder Wagenruecklauf, liest ein Tabellenprogramm es als Formel und fuehrt sie
 * beim Oeffnen aus. Ein vorangestelltes Hochkomma macht daraus sichtbaren Text.
 *
 * Nur fuer Textspalten — ein Betrag wie „-0,50" muss eine Zahl bleiben, mit der die
 * Tabelle rechnen kann. Aus demselben Grund bleibt auch in einer Textspalte eine reine
 * Zahl („-1" als Menge beim Pfand) unangetastet: sie ist keine Formel.
 */
export function csvText(wert: string | null): string {
	if (wert === null) return '';
	const reineZahl = /^[+-]?\d+(?:[.,]\d+)?$/.test(wert);
	return csvFeld(!reineZahl && /^[=+\-@\t\r]/.test(wert) ? `'${wert}` : wert);
}

/** Cent als deutsche Dezimalzahl: 109 → „1,09", −50 → „−0,50" (mit normalem Minus). */
function alsBetrag(cents: number): string {
	return (cents / 100).toFixed(2).replace('.', ',');
}

export function alsCsv(zeilen: CsvZeile[]): string {
	const reihen = zeilen.map((z) =>
		[
			csvFeld(z.datum),
			csvText(z.haendler),
			csvFeld(z.lineNo),
			csvText(z.rawText),
			csvFeld(ART_TEXT[z.lineType as LineType] ?? z.lineType),
			csvText(z.quantity),
			csvText(z.unit),
			csvFeld(z.unitPriceCents === null ? null : alsBetrag(z.unitPriceCents)),
			csvFeld(alsBetrag(z.totalPriceCents)),
			// Der Betrag ZUSAETZLICH in ganzen Cent: wer nur die Dezimalspalte hat,
			// addiert Gleitkommazahlen — genau die Fehlerquelle, die dieses Projekt an
			// jeder anderen Stelle vermeidet.
			csvFeld(z.totalPriceCents),
			csvText(z.kategorie),
			csvText(z.oberkategorie),
			csvFeld(z.bonId)
		].join(';')
	);
	return [KOPF.join(';'), ...reihen].join('\r\n');
}
