/**
 * Die sechs Zeilenarten eines Bons — an EINER Stelle.
 *
 * Vorher stand die Liste an fuenf Stellen: im Drizzle-Enum, im Extraktions-Schema, im
 * Speicher-Vertrag, in grouping.ts und in plausibility.ts. grouping.ts trug den
 * Hinweis „Diese Zeile ist eine Abschrift, kein Import — bei einer Aenderung an einer
 * Seite die andere mitziehen". Genau so eine Abschrift zerfaellt irgendwann: eine neue
 * Art kaeme dann in der Summe vor, aber nicht in der Anzeige, und niemand saehe es.
 *
 * Diese Datei liegt bewusst NICHT unter $lib/server: SvelteKit verbietet Client-Code
 * den Import von dort, und die Pruefansicht braucht die Liste.
 *
 * Eine Ausnahme bleibt: das Drizzle-Enum in db/schema.ts schreibt die Werte weiter
 * aus. Dort sind sie die Wahrheit der DATENBANK, gegen die eine Migration gelesen
 * wird — ein Import wuerde die Werte aendern koennen, ohne dass eine Migration
 * entsteht.
 */
export const ZEILENARTEN = [
	'article',
	'deposit',
	'deposit_return',
	'discount',
	'loyalty',
	'info'
] as const;

export type LineType = (typeof ZEILENARTEN)[number];

/** Zeilenarten, die zur Bonsumme beitragen. `loyalty` und `info` tun das nicht. */
export const MONETAER: readonly LineType[] = ['article', 'deposit', 'deposit_return', 'discount'];

export const ART_TEXT: Record<LineType, string> = {
	article: 'Artikel',
	deposit: 'Pfand',
	deposit_return: 'Pfandrückgabe',
	discount: 'Rabatt',
	loyalty: 'Treue',
	info: 'Info'
};
