export type ReviewItem = {
	id: string;
	lineNo: number;
	rawText: string;
	lineType: string;
	totalPriceCents: number;
	corrected: boolean;
	// Optional, weil der Vertrag von groupForReview (Task 13 Step 1-4) das Feld nicht
	// kennt und Fixtures ohne appliesToLine erwartet. Echte DB-Zeilen liefern es immer
	// mit (auch als null). Siehe hasBrokenReference weiter unten.
	appliesToLine?: number | null;
};

/** Artikelzeilen ohne Preis sind fast immer Lesefehler und gehören nach oben. */
export function groupForReview(items: ReviewItem[]) {
	const problems = items.filter((i) => i.lineType === 'article' && i.totalPriceCents === 0);
	const problemIds = new Set(problems.map((i) => i.id));
	const rest = items.filter((i) => !problemIds.has(i.id));
	return { problems, rest };
}

/**
 * Ruling 58 — warum hier nicht einfach nach lineNo sortiert und fertig ist:
 *
 * Task 11 (sanitizeItemsForInsert, src/worker/extract-receipt.ts) nummeriert doppelt
 * vergebene lineNo-Werte um, damit der Unique-Constraint receipt_items_line_unique
 * nicht den ganzen Bon mit in den Abgrund reisst. Die zweite (dritte, ...) Zeile mit
 * derselben Nummer bekommt die nächste freie Zahl OBERHALB der grössten ORIGINAL-
 * lineNo. Die ursprüngliche Nummer wird dabei nirgends gespeichert — nach dem Insert
 * gibt es nur noch die neue, künstliche Zahl.
 *
 * Das macht die wahre Position auf dem Papier UNWIEDERHERSTELLBAR, nicht nur schwer
 * zu erraten: Liefert das Modell z. B. 18 Zeilen, von denen zwei dieselbe Nummer
 * tragen (17 verschiedene Werte, einer davon doppelt), wird die zweite Instanz auf 18
 * umnummeriert — und die fertige Tabelle zeigt danach die Werte 1..18, LÜCKENLOS.
 * Eine Lücke in der Zahlenfolge, an der man die Umnummerierung erkennen könnte, gibt
 * es im Regelfall NICHT: der Bon "sieht" nach der Reparatur wie ein sauberer
 * 18-Positionen-Bon aus — nur dass Position 18 in Wahrheit eine Kopie von (sagen wir)
 * Position 5 ist und dort auf dem Papier auch wirklich steht. Naiv nach lineNo
 * sortiert landet sie trotzdem ganz unten, ohne jede Kennzeichnung.
 *
 * Was sich dennoch beweisen lässt, ganz ohne Rätselraten: Umnummerierte Zeilen
 * bekommen IMMER einen Wert oberhalb der grössten ORIGINAL-Nummer, und jede Zeile,
 * die ihre Original-Nummer behalten durfte, liegt per Definition nie über diesem
 * Maximum. Die Zeile mit der höchsten lineNo eines Bons, dessen needsReviewReason
 * 'duplicate_line_no' enthält, ist deshalb GARANTIERT eine umnummerierte Zeile —
 * unabhängig davon, wie viele Duplikate es insgesamt gab. Gab es mehr als eines,
 * bleiben die übrigen unerkennbar; das wird hier bewusst NICHT geraten (das Projekt
 * verlangt bewiesene Markierungen, keine erfundenen — "eine 0 ist eine Behauptung,
 * null ist eine Leerstelle").
 *
 * Der saubere Fix wäre, die Umnummerierung selbst in der DB sichtbar abzulegen
 * (Originalwert oder ein eigenes Flag) — das würde aber Task 11s Schema und
 * Worker-Code wieder aufreissen (Migration auf dem Produktivsystem) und steht nicht
 * auf der Dateiliste von Task 13. Siehe task-13-report.md: als Abweichung
 * dokumentiert, hier bewusst nicht gelöst.
 */
export function findRenumberedItemId(
	items: ReviewItem[],
	needsReviewReason: string[] | null | undefined
): string | null {
	if (!needsReviewReason?.includes('duplicate_line_no') || items.length === 0) return null;
	const maxLineNo = Math.max(...items.map((i) => i.lineNo));
	// Wegen receipt_items_line_unique eigentlich immer genau ein Treffer — find()
	// trotzdem statt einer ungeprüften Annahme.
	return items.find((i) => i.lineNo === maxLineNo)?.id ?? null;
}

/**
 * appliesToLine sichtbar machen — siehe plausibility.ts: "Diese Fälle fängt ein
 * Mensch im Review-Bildschirm ab, der appliesToLine sichtbar anzeigt (Task 13)".
 * Liefert true, wenn eine Rabatt- oder Pfandzeile auf eine lineNo verweist, die unter
 * den geladenen Positionen dieses Bons gar nicht existiert. Deckt sich inhaltlich mit
 * discount_unlinked (Bon-Ebene), wird hier aber pro Zeile berechnet, damit die
 * betroffene Zeile selbst markiert werden kann statt nur der ganze Bon.
 */
export function hasBrokenReference(item: ReviewItem, items: ReviewItem[]): boolean {
	if (item.appliesToLine == null) return false;
	return !items.some((i) => i.lineNo === item.appliesToLine);
}

/**
 * Zeilentypen, die zur Bonsumme beitragen — muss deckungsgleich bleiben mit MONETARY
 * in src/lib/server/validation/plausibility.ts. Dort steht die massgebliche Fassung
 * (dort lebt auch sum_mismatch); diese Datei liegt aber bewusst ausserhalb von
 * $lib/server, damit sowohl +page.server.ts als auch +page.svelte sie importieren
 * können (SvelteKit verbietet den Import von $lib/server/* in Client-Code). Diese
 * Zeile ist deshalb eine Abschrift, kein Import — bei einer Änderung an einer Seite
 * die andere mitziehen.
 */
// Umgezogen nach $lib/bons/zeilenarten (2026-09-17, Oberflaeche 3.3) — die Abschrift,
// vor der der Absatz oben warnt, gibt es nicht mehr. Hier weiter exportiert, damit
// bestehende Importe und Tests unveraendert bleiben.
export { MONETAER as MONETARY_LINE_TYPES } from '$lib/bons/zeilenarten';

// Umgezogen nach $lib/bons/beanstandungen (2026-09-17, Oberflaeche 1.4). Hier weiter
// exportiert, damit bestehende Importe und Tests unveraendert bleiben.
export { PROBLEM_LABELS, describeProblem } from '$lib/bons/beanstandungen';
