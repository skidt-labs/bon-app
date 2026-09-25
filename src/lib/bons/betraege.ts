/**
 * Betraege in einem OCR-Text erkennen — und der Vergleich „steht im Bild etwas anderes,
 * als gelesen wurde?".
 *
 * Diese Datei liegt bewusst NICHT unter $lib/server: SvelteKit verbietet Client-Code
 * den Import von dort, und die Pruefansicht rechnet den Vergleich im Browser nach —
 * er muss sich mitaendern, waehrend ein Mensch einen Betrag korrigiert. Ein zweites
 * Mal hinschreiben kam nicht in Frage: die Regeln hier sind an echten Bons gemessen
 * und tragen ihre Messungen als Kommentar; zwei Fassungen davon driften auseinander.
 *
 * Reine Rechnung, kein Netz, keine Datenbank. `ocr/qualitaet.ts` (Torwaechter) und
 * `ocr/zuordnung.ts` (Zeilenzuordnung) lesen von hier und exportieren weiter, damit
 * bestehende Importe und Tests unveraendert bleiben.
 */

/**
 * Deutsches Geldformat, tolerant gegenüber OCR-Leerraum um das Trennzeichen
 * ("84 ,00") und gegenüber einem Punkt statt Komma.
 *
 * Nebenwirkung, am Regex nachgeprüft statt angenommen: ein deutsches Datum
 * (TT.MM.JJJJ) hat dieselbe Form wie ein Betrag (Ziffern-Trenner-zwei-Ziffern) und
 * zählt hier deshalb MIT — "01.01.2026" liefert einen Treffer ("01.01"), zusätzlich
 * zum Treffer aus `DATUM_REGEX`. Das ist unschädlich: es macht die Zählung nur
 * GROSSZÜGIGER (ein Bon mit Datum, aber ohne jeden echten Preis, käme dadurch minimal
 * näher an `MIN_BETRAEGE` heran) — nie strenger. Es OHNE dieses Nebensignal exakter zu
 * machen (z. B. Jahreszahlen ausschließen) würde die Regex nur verkomplizieren, ohne
 * die Kauderwelsch/Bon-Trennung an den echten Vorlagen zu verbessern.
 */
/*
 * Der Rueckblick `(?<!\d[.,]\s*)` kam am 2026-09-16 dazu, an einem echten Bon gemessen.
 * PaddleOCR zieht benachbarte Spalten gelegentlich in EINEN Kasten ohne Leerzeichen:
 * aus "16,80" und "67,20" wurde "16,8067,20". Ohne den Rueckblick fand die Regex darin
 * "8067,20" — einen Betrag von 8067,20 EUR, der auf einem Lebensmittelbon jede
 * Verhaeltnispruefung sprengt und den Bon faelschlich durchfallen liess.
 *
 * Es braucht BEIDE Rueckblicke. Ohne `(?<!\d)` rutschte die Regex einfach eine Ziffer
 * weiter und las "067,20", also 67,20 EUR — gemessen, nicht vermutet: der erste Anlauf
 * mit nur einem Rueckblick ergab einen Ueberhang von 9,94 statt 0,5.
 *
 * Mit beiden ergibt dieselbe Zeichenkette GAR KEINEN Betrag: jeder Ansatzpunkt in
 * "8067,20" steht hinter einer Ziffer, und "16,80" scheitert am `\b` (danach folgt eine
 * Ziffer). Das ist die
 * richtige Antwort — aus zwei zusammengelaufenen Zahlen laesst sich nicht rekonstruieren,
 * welche es waren. Eine Zahl zu verlieren ist ehrlich, eine zu erfinden nicht.
 *
 * Nebenwirkung, erwuenscht: "05.08.2026" liefert jetzt nur noch "05.08" und nicht mehr
 * zusaetzlich "08.20".
 *
 * Der Vorausblick `(?!\s*%)` kam am 2026-09-17 dazu, wieder an einem echten Bon: dort
 * stand "219,00%". Als Betrag gelesen sind das 219,00 EUR — genug, um die
 * Verhaeltnispruefung zu sprengen und einen einwandfreien Bon als unlesbar zu
 * verwerfen. Eine Zahl mit Prozentzeichen dahinter ist NIE ein Geldbetrag, weder als
 * Rabattsatz noch als Steuersatz ("19,00 %"), also kostet der Ausschluss nichts.
 */
export const BETRAG_REGEX = /(?<!\d)(?<!\d[.,]\s*)\d+\s*[.,]\s*\d{2}\b(?!\s*%)/g;

/**
 * Deutsches Datum (auch mit OCR-Rutscher auf Komma: "25,08,26"), ISO-Datum, und seit
 * dem 2026-09-16 auch die Form JAHR-zuerst ohne Tag.
 *
 * Letzteres ebenfalls an einem echten Bon gemessen: PaddleOCR zerlegt die TSE-Zeile
 * anders als Tesseract und liess das Bruchstueck "2026.08" als eigenen Kasten stehen —
 * das zaehlte als Betrag von 2026,08 EUR. Die Jahreszahl ist bewusst auf 19xx/20xx
 * eingegrenzt, damit ein echter vierstelliger Betrag ("1234,56") nicht mit
 * ausgeschlossen wird.
 */
export const DATUM_REGEX =
	/\b\d{1,2}\s*[.,]\s*\d{1,2}\s*[.,]\s*\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:19|20)\d{2}\s*[.,-]\s*\d{1,2}(?:\s*[.,-]\s*\d{1,2})?\b/;

/** "1 234,56" / "84 ,00" -> Cent. `null`, wenn sich daraus keine Zahl ergibt. */
function alsCent(text: string): number | null {
  const n = Number(text.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Betraege OHNE die, die in Wahrheit Teil eines Datums sind.
 *
 * `BETRAG_REGEX` trifft absichtlich auch auf "05.08" in "05.08.2026" — fuer die reine
 * ZAEHLUNG ist das harmlos und dort so dokumentiert. Fuer ein VERHAELTNIS ist es das
 * nicht: "31.12.2026" waere ein Betrag von 31,12 EUR und koennte einen kleinen Bon
 * allein beherrschen. Deshalb hier ausgeschlossen.
 */
export function betraegeInCent(text: string): number[] {
  const datumsStellen: Array<[number, number]> = [];
  for (const m of text.matchAll(new RegExp(DATUM_REGEX.source, 'g'))) {
    if (m.index !== undefined) datumsStellen.push([m.index, m.index + m[0].length]);
  }
  const werte: number[] = [];
  for (const m of text.matchAll(BETRAG_REGEX)) {
    if (m.index === undefined) continue;
    const ende = m.index + m[0].length;
    if (datumsStellen.some(([a, b]) => a <= m.index! && ende <= b)) continue;
    const c = alsCent(m[0]);
    if (c !== null && c > 0) werte.push(c);
  }
  return werte;
}

/** Nur Buchstaben, Umlaute aufgeloest — fuer Namensvergleiche und die Frage, ob eine
 * OCR-Zeile ueberhaupt Text traegt. */
export function buchstaben(text: string): string {
	return text
		.toUpperCase()
		.replace(/Ä/g, 'AE')
		.replace(/Ö/g, 'OE')
		.replace(/Ü/g, 'UE')
		.replace(/ß/g, 'SS')
		.replace(/[^A-Z]/g, '');
}

export function abweichungInZeile(
	zeilen: { text: string }[],
	index: number,
	totalPriceCents: number,
	unitPriceCents: number | null
): number | null {
	const zeile = zeilen[index];
	if (!zeile) return null;
	let betraege = betraegeInCent(zeile.text);
	if (betraege.length === 0) {
		const naechste = zeilen[index + 1];
		if (!naechste || buchstaben(naechste.text).length > 0) return null;
		betraege = betraegeInCent(naechste.text);
	}
	const soll = Math.abs(totalPriceCents);
	if (betraege.includes(soll)) return null;
	const ohneEinzelpreis =
		unitPriceCents !== null ? betraege.filter((b) => b !== Math.abs(unitPriceCents)) : betraege;
	/**
	 * Bleibt nach dem Filtern NICHTS uebrig, zaehlt wieder die ungefilterte Liste.
	 *
	 * Der Filter soll verhindern, dass in „1,204 kg x 1,49/kg 1,79 A" der Einzelpreis
	 * 1,49 als Endbetrag angeboten wird — dort stehen beide Zahlen in derselben Zeile.
	 * Traegt die Zeile aber nur EINE Zahl, und die ist zufaellig gleich dem Einzelpreis,
	 * warf der Filter den einzigen Beleg weg, den es gab.
	 *
	 * Gemessen am ALDI-Bon vom 17.09.: im Bild steht „KARTOFFELN.FK 2.5KG" und darunter
	 * „2,49 €". Das Modell nahm 2,49 als Kilopreis und rechnete 2,5 x 2,49 = 6,22 als
	 * Endbetrag — eine Zahl, die nirgends auf dem Bon steht. Der Hinweis „im Bild steht
	 * 2,49" waere genau dafuer da gewesen, blieb aber stumm, weil 2,49 auch als
	 * Einzelpreis gespeichert war. 3,73 EUR Fehler, unbemerkt.
	 */
	const kandidaten = ohneEinzelpreis.length > 0 ? ohneEinzelpreis : betraege;
	if (kandidaten.length !== 1) return null;
	return kandidaten[0];
}
