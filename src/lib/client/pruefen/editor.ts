/**
 * Das Zeilenmodell der Pruefansicht: einfuegen, loeschen, nummerieren, pruefen.
 *
 * Rein — die Tabelle (Positionen.svelte) ruft hier an und stellt nur dar. Der Grund ist
 * derselbe wie ueberall in diesem Projekt: was entscheidet, soll ein Test nachrechnen
 * koennen, und die Suite hat keine Komponententests.
 *
 * Bezuege (`appliesToLine`) zeigen auf eine ZEILENNUMMER, nicht auf eine ID — so steht
 * es in der Datenbank (Self-FK auf `receipt_id, line_no`). Jede Umnummerierung muss sie
 * deshalb mitziehen, sonst zeigt ein Rabatt nach dem Einfuegen auf den falschen Artikel,
 * und das sieht niemand.
 */
import { MONETAER, type LineType } from '$lib/bons/zeilenarten';

export { MONETAER, ART_TEXT, ZEILENARTEN, type LineType } from '$lib/bons/zeilenarten';

export type EditorZeile = {
	/** null = neue Zeile, die es in der Datenbank noch nicht gibt. */
	id: string | null;
	lineNo: number;
	rawText: string;
	lineType: LineType;
	quantity: string | null;
	unit: string | null;
	unitPriceCents: number | null;
	totalPriceCents: number;
	vatClass: string | null;
	appliesToLine: number | null;
	categoryId: string | null;
	/** Index der OCR-Zeile im Bild, aus Etappe 2. Nur zum Anzeigen, nie zum Speichern. */
	ocrZeile: number | null;
};

/**
 * Nummeriert 1..n durch und zieht alle Bezuege mit. Arbeitet ueber die ALTE Nummer als
 * Schluessel, nicht ueber den Index — ein Bezug auf eine Zeile, die es nicht mehr gibt,
 * wird null statt auf die naechstbeste umzubiegen.
 */
export function neuNummerieren(zeilen: EditorZeile[]): EditorZeile[] {
	const neueNummer = new Map<number, number>();
	zeilen.forEach((z, i) => neueNummer.set(z.lineNo, i + 1));
	return zeilen.map((z, i) => ({
		...z,
		lineNo: i + 1,
		appliesToLine: z.appliesToLine === null ? null : (neueNummer.get(z.appliesToLine) ?? null)
	}));
}

/**
 * Eine leere Artikelzeile nach `nachIndex` (−1 = ganz oben).
 *
 * `lineNo: 0` ist ein Platzhalter, den neuNummerieren sofort ersetzt. Er kollidiert
 * nicht mit dem Bestand: echte Nummern fangen bei 1 an.
 */
export function zeileEinfuegen(zeilen: EditorZeile[], nachIndex: number): EditorZeile[] {
	const neu: EditorZeile = {
		id: null,
		lineNo: 0,
		rawText: '',
		lineType: 'article',
		quantity: null,
		unit: null,
		unitPriceCents: null,
		totalPriceCents: 0,
		vatClass: null,
		appliesToLine: null,
		categoryId: null,
		ocrZeile: null
	};
	const kopie = [...zeilen];
	kopie.splice(nachIndex + 1, 0, neu);
	return neuNummerieren(kopie);
}

/**
 * Entfernt eine Zeile. `geloescht` traegt die IDs, die der Server loeschen muss — eine
 * nie gespeicherte Zeile (id null) gehoert nicht dazu, der Server faende sie nicht und
 * braeche mit 409 ab. Bezuege auf die entfernte Zeile werden null: der Rabatt bleibt
 * sichtbar und ohne Zuordnung, und der Mensch entscheidet, wohin er gehoert.
 */
export function zeileLoeschen(
	zeilen: EditorZeile[],
	index: number
): { zeilen: EditorZeile[]; geloescht: string[] } {
	const weg = zeilen[index];
	const uebrig = zeilen.filter((_, i) => i !== index);
	const ohneBezug = uebrig.map((z) =>
		z.appliesToLine === weg.lineNo ? { ...z, appliesToLine: null } : z
	);
	return { zeilen: neuNummerieren(ohneBezug), geloescht: weg.id === null ? [] : [weg.id] };
}

export function positionssumme(zeilen: EditorZeile[]): number {
	return zeilen
		.filter((z) => MONETAER.includes(z.lineType))
		.reduce((summe, z) => summe + z.totalPriceCents, 0);
}

/**
 * Was das Bestaetigen sperrt. Bewusst NICHT dabei: die Differenz zur Endsumme — ein Bon
 * darf mit Differenz bestaetigt werden, wenn der Mensch das entscheidet (Entwurf §2).
 * Sie steht als Hinweis in der Kopfzeile und bleibt danach als `sum_mismatch` in
 * `needs_review_reason`, damit der Bericht sie kennt.
 *
 * Die Bezugspruefungen spiegeln absichtlich, was der Server ohnehin ablehnt
 * (receipts/korrekturen.ts): faellt es erst dort auf, sieht der Mensch einen 400er
 * statt eines Hinweises an der Zeile, die er anfassen muss.
 */
export function pruefeVorBestaetigen(zeilen: EditorZeile[]): string[] {
	const hinweise: string[] = [];
	const nummern = new Set(zeilen.map((z) => z.lineNo));
	for (const z of zeilen) {
		if (MONETAER.includes(z.lineType) && z.totalPriceCents === 0) {
			hinweise.push(`Zeile ${z.lineNo} („${z.rawText || 'ohne Namen'}") hat keinen Betrag.`);
		}
		if (z.appliesToLine === z.lineNo) {
			hinweise.push(`Zeile ${z.lineNo} bezieht sich auf sich selbst.`);
		} else if (z.appliesToLine !== null && !nummern.has(z.appliesToLine)) {
			hinweise.push(`Zeile ${z.lineNo} bezieht sich auf Zeile ${z.appliesToLine}, die es nicht gibt.`);
		}
	}
	return hinweise;
}

/**
 * Tauscht eine Zeile mit ihrem Nachbarn (`richtung` −1 = nach oben, 1 = nach unten) und
 * nummeriert neu, damit Bezuege mitwandern. An den Enden passiert nichts — kein Umlauf:
 * eine Zeile, die oben herausfaellt und unten wieder auftaucht, waere eine Ueberraschung,
 * kein Werkzeug.
 *
 * Gebraucht, wenn die gelesene Reihenfolge nicht zum Bon passt — der Server nummeriert
 * NICHT um (receipts/korrekturen.ts), also muss der Mensch es koennen.
 */
export function zeileVerschieben(
	zeilen: EditorZeile[],
	index: number,
	richtung: 1 | -1
): EditorZeile[] {
	const ziel = index + richtung;
	if (index < 0 || index >= zeilen.length || ziel < 0 || ziel >= zeilen.length) return zeilen;
	const kopie = [...zeilen];
	[kopie[index], kopie[ziel]] = [kopie[ziel], kopie[index]];
	return neuNummerieren(kopie);
}
