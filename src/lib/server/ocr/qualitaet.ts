import { BETRAG_REGEX, DATUM_REGEX, betraegeInCent } from '$lib/bons/betraege';

// Umgezogen nach $lib/bons/betraege (2026-09-17, Oberflaeche 3.4): die Pruefansicht
// braucht dieselbe Rechnung im Browser, und $lib/server ist dort verboten.
export { betraegeInCent };

/**
 * Prüft, ob ein von Tesseract gelieferter Text überhaupt als Kassenbon taugt.
 *
 * Der Anlass (Entwurf E3, 2026-09-15): an einem 297px breiten Foto lieferte Tesseract
 *
 *   L$DL / A, / AAl / 3 A / min ö eten 9 äreen / E / | Aa
 *
 * — kein Fehler, sondern Kauderwelsch. Gibt man DAS einem Sprachmodell, erfindet es
 * einen Bon, statt zu sagen "das kann ich nicht lesen". Diese Funktion steht deshalb
 * VOR dem Modell: fällt sie durch, wird der Bon markiert statt geraten (Entscheidung
 * des Betreibers: im Zweifel markieren — lieber einer zu viel zur Handprüfung als
 * einer, bei dem geraten wurde).
 *
 * ## Die drei Signale
 *
 * Ein Kassenbon ist im Kern eine Liste von Geldbeträgen mit einer Summe und einem
 * Datum. Drei Signale, jedes für sich schon aussagekräftig, aber keins allein
 * verlässlich (siehe unten, warum nicht):
 *
 *  1. `anzahlBetraege` — Zeilen im deutschen Geldformat (`1,29` oder `1.29`, auch mit
 *     OCR-Leerraum um das Trennzeichen: `84 ,00`). Das ist der eigentliche INHALT
 *     eines Bons; ohne mindestens ein paar davon gibt es nichts zu strukturieren,
 *     unabhängig davon, wie sauber der Rest aussieht.
 *  2. `hatSummenzeile` — ein Schlüsselwort der Endsumme (`zu zahlen`, `Summe`,
 *     `Gesamtbetrag`, `Endbetrag`). Steht meist groß/fett gedruckt und übersteht OCR
 *     dadurch oft besser als die kleinteiligen Artikelzeilen.
 *  3. `hatDatum` — ein Kaufdatum, deutsch (`25.08.2026`, auch mit OCR-Rutscher auf
 *     Komma: `25,08,26`) oder ISO (`2026-08-05`).
 *
 * ## Die Verknüpfung — und warum NICHT anders
 *
 * `brauchbar = anzahlBetraege >= MIN_BETRAEGE && (hatSummenzeile || hatDatum)`
 *
 * Beträge sind PFLICHT: ein Text mit Summenzeile und Datum, aber ohne erkennbare
 * Beträge, wäre für die Struktur-Extraktion trotzdem wertlos — es gäbe keine
 * Positionen zum Zuordnen. Zusätzlich muss mindestens EINES der beiden anderen
 * Signale da sein: das verhindert, dass ein Text durchrutscht, der zufällig zwei
 * Kommazahlen enthält, sonst aber gar nicht wie ein Bon aussieht (ein Bon ohne jeden
 * Hinweis auf Summe UND Datum ist kein Bon).
 *
 * Warum nicht "alle drei Pflicht"? Weil dann ein Bon durchfiele, bei dem GENAU eine
 * Zeile (die Summenzeile ODER die Datumszeile) verunglückt ist, obwohl die Artikel
 * klar lesbar sind — und genau das soll die Prüfung NICHT tun (siehe Aufgabenstellung:
 * "was passiert, wenn genau das eine fehlt oder verstümmelt ist"). Ein Bon mit vielen
 * lesbaren Beträgen und einem von zwei Kontextsignalen ist immer noch brauchbar; nur
 * wenn ZWEI der drei Signale gleichzeitig fehlen, ist die Lage zweifelhaft genug, um
 * zu markieren.
 *
 * ## Ein Signal, das GEMESSEN und wieder verworfen wurde
 *
 * Naheliegend wäre ein Anteil "wortartiger" Tokens (nur Buchstaben, Länge ≥ 3) als
 * viertes Signal — Kauderwelsch besteht ja aus Fragmenten wie "AAl" oder "min ö eten".
 * An den fünf echten Testvorlagen (siehe `tests/fixtures/ocr/`) nachgemessen, trennt
 * das aber NICHT: der Kauderwelsch-Text kam auf einen wortartigen Anteil von 0.43,
 * der klar lesbare Jack-Wolfskin-Bon nur auf 0.28 — SCHLECHTER als das Kauderwelsch.
 * Grund: der untere Beleg-Rand jedes Lidl-Bons ("Eingelöste Coupons", "Erhaltene
 * Punkte", "Einkauf getätigt in") ist immer lesbarer Fließtext, auch wenn genau die
 * Artikel- und Summenzeilen darüber komplett unlesbar sind — dieses Signal hätte also
 * regelmäßig genau den Fall verfehlt, den es fangen soll. Deshalb hier nicht
 * verwendet. Diese Notiz bleibt stehen, damit niemand das Signal ungeprüft wieder
 * einbaut.
 *
 * Diese Funktion selbst wirft nie — ein Text, der an keiner Regel andockt, ergibt
 * einfach `brauchbar: false`, nie eine Ausnahme.
 */

/** Schlüsselwörter der Endsumme. Wortgrenzen sorgen dafür, dass z. B. "Summe" nicht
 * zufällig in einem Artikelnamen mitgezählt wird. */
const SUMMENZEILE_REGEX = /(zu\s*zahlen|\bsumme\b|gesamtbetrag|gesamt\s*betrag|endbetrag)/i;

/** Ab wie vielen erkannten Beträgen ein Bon als "hat Beträge" zählt. An den vier
 * lesbaren Testvorlagen lag der Wert real zwischen 16 und 47 (siehe Aufgaben-Bericht);
 * die Grenze liegt bewusst weit darunter, damit auch ein stark beschnittener oder
 * teilweise unlesbarer Bon noch durchkommt — sie muss nur Kauderwelsch (0 Treffer in
 * der Vorlage) von echtem Bontext trennen, nicht einen kurzen von einem langen Bon. */
const MIN_BETRAEGE = 2;

/**
 * Um welchen Faktor der groesste Betrag die Summe ALLER UEBRIGEN hoechstens
 * uebersteigen darf, bevor der Text als Fragment gilt.
 *
 * Warum gegen die uebrigen und nicht gegen die Gesamtsumme: Auf einem Kassenbon
 * entspricht die Endsumme ungefaehr der Summe der Positionen — der groesste Betrag ist
 * also hoechstens etwa so gross wie alle anderen zusammen. Fehlen die Positionen, steht
 * eine grosse Zahl allein da.
 *
 * GEMESSEN am 2026-09-16 an den sieben Vorlagen in `tests/fixtures/ocr/` plus den
 * Kunstbeispielen der Testdatei:
 *
 *   die vier lesbaren Bons      0,12 - 0,17
 *   PaddleOCR mit Grenze hoch   0,16
 *   kurzer Bon OHNE Summenzeile 1,06   <- hoechster gueltiger Wert
 *   Fragment mit falscher
 *   Endsumme (48,61 statt 40,01) 3,13  <- niedrigster ungueltiger Wert
 *
 * Die Grenze liegt bei 2 und damit ungefaehr in der Mitte: fast doppelt so hoch wie der
 * hoechste gueltige Wert, gut ein Drittel unter dem Fragment. Sie ist BEWUSST nicht auf
 * 3 gesetzt — das waere nur vier Prozent unter dem gemessenen Fragment und damit kein
 * Abstand, sondern ein Zufall.
 *
 * Zwei Irrwege, die hier stehen bleiben, damit sie niemand wiederholt: Ein erster
 * Entwurf verglich den groessten Betrag gegen die GESAMTSUMME statt gegen die uebrigen
 * und haette den kurzen Bon ohne Summenzeile abgewiesen — ein Tuersteher, der einen
 * gueltigen Bon abweist, hat ein falsches Kriterium, nicht der Bon. Und der Abstand zum
 * Fragment wurde zunaechst auf 27,9 geschaetzt statt gemessen; der wirkliche Wert ist
 * 3,13, also fast zehnmal kleiner.
 */
export const MAX_UEBERHANG_GROESSTER_BETRAG = 2;

export type OcrQualitaet = {
  /** Das Gesamturteil: darf der Text an das Modell weitergereicht werden? */
  brauchbar: boolean;
  /** Enthält der Text ein Schlüsselwort der Endsumme? */
  hatSummenzeile: boolean;
  /** Wie viele Beträge im Format `1,29` (oder `1.29`) wurden gefunden? */
  anzahlBetraege: number;
  /** Enthält der Text ein Kauf- oder TSE-Datum? */
  hatDatum: boolean;
  /**
   * Der groesste Betrag geteilt durch die Summe aller uebrigen (ohne Datumstreffer).
   * `null`, wenn gar keine Betraege gefunden wurden. Ein grosser Wert heisst: ein
   * einzelner Betrag steht fast allein da — die Positionen fehlen, der Text ist ein
   * Fragment mit einer Summe obendrauf.
   */
  ueberhangGroessterBetrag: number | null;
};

export function pruefeOcrQualitaet(text: string): OcrQualitaet {
  const hatSummenzeile = SUMMENZEILE_REGEX.test(text);
  const anzahlBetraege = text.match(BETRAG_REGEX)?.length ?? 0;
  const hatDatum = DATUM_REGEX.test(text);

  const werte = betraegeInCent(text);
  const groesster = werte.length ? Math.max(...werte) : 0;
  const uebrige = werte.reduce((a, b) => a + b, 0) - groesster;
  // Ein einziger Betrag ohne jeden anderen ist der Grenzfall dieser Regel: dann gibt es
  // nichts, wogegen sich der Ueberhang messen liesse. Er gilt als beherrschend —
  // Unendlich statt einer Division durch null.
  const ueberhangGroessterBetrag =
    werte.length === 0 ? null : uebrige > 0 ? groesster / uebrige : Number.POSITIVE_INFINITY;

  const brauchbar =
    anzahlBetraege >= MIN_BETRAEGE &&
    (hatSummenzeile || hatDatum) &&
    (ueberhangGroessterBetrag === null ||
      ueberhangGroessterBetrag <= MAX_UEBERHANG_GROESSTER_BETRAG);

  return { brauchbar, hatSummenzeile, anzahlBetraege, hatDatum, ueberhangGroessterBetrag };
}
