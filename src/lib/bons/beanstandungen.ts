/**
 * Klartext fuer die Beanstandungscodes aus checkPlausibility. Liegt in $lib/bons,
 * weil die Liste (BonListe.svelte) und die Pruefansicht ihn beide brauchen und eine
 * Komponente nicht aus einem Routen-Ordner importieren soll. Inhalt woertlich aus
 * src/routes/inbox/grouping.ts uebernommen (2026-09-17, Oberflaeche 1.4).
 */
/** Kurze deutsche Erklärungen der Beanstandungscodes aus checkPlausibility. */
export const PROBLEM_LABELS: Record<string, string> = {
	no_items: 'Keine Positionen erkannt',
	no_monetary_items: 'Keine Warenzeilen erkannt',
	missing_raw_text: 'Zeilentext fehlt',
	duplicate_line_no: 'Zeilennummern doppelt vergeben',
	sum_mismatch: 'Summe stimmt nicht mit dem Bon überein',
	vat_mismatch: 'MwSt-Summe stimmt nicht',
	vat_incomplete: 'MwSt-Angaben unvollständig',
	vat_missing: 'MwSt-Block fehlt',
	discount_unlinked: 'Rabatt oder Pfand ohne gültigen Bezug',
	date_unparsable: 'Datum nicht lesbar',
	date_in_future: 'Datum liegt in der Zukunft',
	date_too_old: 'Datum unplausibel alt',
	sign_mismatch: 'Vorzeichen passt nicht zum Zeilentyp',
	// Aufgabe 3 (Entwurf E7a): eine Antwort ohne lesbare Endsumme ist kein Erfolg,
	// auch wenn Positionen da sind — siehe plausibility.ts.
	missing_total: 'Keine Endsumme gelesen',
	// Kein Befund aus checkPlausibility, sondern aus der Doppel-Erkennung (bons/doppelt.ts).
	moeglicher_doppelbon: 'Sieht aus wie ein schon erfasster Bon'
};

/**
 * Der Code des Doppel-Hinweises. Liegt hier und nicht in $lib/server/bons/doppelt.ts,
 * weil die Pruefansicht ihn braucht (sie zeigt statt des Kurztexts ein eigenes Band mit
 * dem Original) und eine Komponente nichts aus $lib/server importieren darf.
 */
export const DOPPEL_GRUND = 'moeglicher_doppelbon';

/**
 * Fällt auf den rohen Code zurück, damit ein künftiger, hier noch unbekannter Code
 * nie stumm verschwindet, sondern sich wenigstens selbst anzeigt.
 */
export function describeProblem(code: string): string {
	return PROBLEM_LABELS[code] ?? code;
}
