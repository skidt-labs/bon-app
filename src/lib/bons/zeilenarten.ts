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

/**
 * Zeilenarten, deren Betrag immer negativ ist. Die Ziffern-Tastatur am iPhone hat kein
 * Minus — wer bei einem Rabatt „1,50“ tippt, meint −1,50. Das Auslesen liefert sie ohnehin
 * negativ; hier steht die Regel fuer Hand-Eingabe, Server und Nachbesserung im Worker.
 */
export const IMMER_NEGATIV: readonly LineType[] = ['discount', 'deposit_return'];

/** Bei Rabatt und Pfandrueckgabe `-|cents|`, sonst unveraendert. 0 bleibt 0 (nicht -0). */
export function mitVorzeichen(lineType: LineType, cents: number): number {
	if (!IMMER_NEGATIV.includes(lineType) || cents === 0) return cents;
	return -Math.abs(cents);
}

export const ART_TEXT: Record<LineType, string> = {
	article: 'Artikel',
	deposit: 'Pfand',
	deposit_return: 'Pfandrückgabe',
	discount: 'Rabatt',
	loyalty: 'Treue',
	info: 'Info'
};

/**
 * `mitVorzeichen` fuer eine ganze Zeilenliste — Gesamt- und Einzelpreis. Angewandt, wo Zeilen
 * herkommen (Worker nach dem Lesen, Entwurf in der Pruefansicht), damit die Ansicht zeigt, was
 * gespeichert wird; der Server gleicht beim Speichern zusaetzlich an (Abschlusspruefung 0.12.0).
 */
export function vorzeichenAngleichen<T extends { lineType: LineType; totalPriceCents: number; unitPriceCents: number | null }>(
	zeilen: T[]
): T[] {
	return zeilen.map((z) => ({
		...z,
		totalPriceCents: mitVorzeichen(z.lineType, z.totalPriceCents),
		unitPriceCents: z.unitPriceCents === null ? null : mitVorzeichen(z.lineType, z.unitPriceCents)
	}));
}
