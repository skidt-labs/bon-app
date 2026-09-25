import type { ExtractedReceipt } from './schema';
import type { OcrLaufDaten, OcrZeileKurz } from '../ocr/anbieter';

// null statt einer erfundenen 0: ein Provider, der keine Token-Zahlen meldet (oder sie in
// einer Form meldet, der wir nicht trauen), darf nicht so aussehen, als wäre der Aufruf
// kostenlos gewesen. Dieselbe "kein Wert ist keine Null" -Regel wie im Schema (Task 8).
export type ExtractionUsage = { inputTokens: number; outputTokens: number } | null;

export type ExtractionResult = {
  receipt: ExtractedReceipt;
  usage: ExtractionUsage;
  /**
   * Das Modell, das laut Antwort TATSAECHLICH geantwortet hat — null, wenn der
   * Anbieter keines meldet. Der Abacus-Proxy laeuft auf RouteLLM und koennte eine
   * Anfrage grundsaetzlich umleiten. Am 2026-09-14 nachgemessen: er tut es nicht.
   * Aber `extraction_runs.model` speicherte bisher den KONFIGURIERTEN Wert — wuerde
   * der Proxy je still wechseln, aenderte sich die Erkennungsqualitaet ohne jede
   * Spur in den Daten, und der Cloud-gegen-Mac-Vergleich in Phase 7 verglich Aepfel
   * mit Birnen, ohne dass es jemand merkt.
   */
  servedModel: string | null;
  /**
   * Die geparste, aber NICHT validierte und NICHT normalisierte Modellantwort.
   * Sie ist der einzige Beleg dafür, was das Modell wirklich geschrieben hat.
   * `receipt` taugt dafür nicht: das Schema faltet Adressobjekte zu Strings,
   * schreibt Einheiten klein, ersetzt Unbekanntes durch Rückfallwerte — die
   * Abweichung, die man untersuchen will, ist darin schon wegnormalisiert.
   */
  raw: unknown;
  /**
   * Vom ANBIETER SELBST entfernte oder korrigierte Positionen — leer, wenn nichts
   * korrigiert wurde. Eingeführt in Aufgabe 2 (Textweg-Anbieter, `ocr-text-provider.ts`)
   * für genau einen Fall: eine erfundene `deposit`-Zeile ohne Beleg im OCR-Text wird
   * dort entfernt, BEVOR der Bon zurückkommt — und genau das darf niemals unbemerkt
   * bleiben. `checkPlausibility` (Task 10) prüft nur das FINALE `receipt` und würde
   * eine bereits entfernte Zeile nie sehen; ohne dieses Feld wäre die Korrektur die
   * Art von stillem Rückfallwert, die dieses Projekt laut Aufgabenstellung schon
   * fünfmal teuer bezahlt hat. Ein Aufrufer (Task 3) MUSS diese Meldungen an einer
   * Stelle sichtbar machen, die ein Mensch tatsächlich sieht (z. B. zusammen mit
   * `needsReviewReason` in der Review-Ansicht) — hier ist nur der Transportweg dafür.
   * Der Cloud-/Bildweg-Anbieter (`openai-compat.ts`) korrigiert nichts und liefert
   * deshalb immer `[]`.
   */
  warnings: string[];
  /**
   * Der OCR-Text, aus dem `receipt` entstand — null beim Bildweg (`openai-compat.ts`,
   * kein OCR-Schritt, das Modell sieht das Bild direkt). Entwurf E5: der OCR-Text ist
   * der einzige Beleg dafür, was tatsächlich gelesen wurde. Ohne ihn ist bei einem
   * falschen Bon nicht mehr feststellbar, ob die Texterkennung oder das Modell
   * schuld war. Task 3 legt ihn in `extraction_runs.ocr_text` ab.
   */
  ocrText: string | null;
  /**
   * Was die OCR-Engine ueber ihren EIGENEN Lauf meldet — Engine, Version, Dauer und
   * die tatsaechlich uebergebenen Optionen. null beim Bildweg (`openai-compat.ts`):
   * dort lief gar keine OCR.
   *
   * Etappe 2 der PaddleOCR-Anbindung. Ohne diese Angabe laesst sich spaeter nicht
   * sagen, WELCHE Engine einen Bon gelesen hat — und damit auch kein Vergleich
   * zwischen Tesseract und PaddleOCR fuehren, was der ganze Zweck der Abstraktion
   * ist. `ocrText` allein reicht nicht: zwei Engines koennen denselben Text liefern
   * und tun es bei kurzen Bons auch.
   *
   * Bewusst PFLICHTFELD mit `null` statt `ocr?:` — dieselbe Regel wie beim
   * `ocrText` darueber. Ein kuenftiger Anbieter, der OCR betreibt und dieses Feld
   * stillschweigend weglaesst, waere in der Messreihe unsichtbar, und der Betreiber
   * haelt eine lueckenhafte Reihe fuer vollstaendig. Ein `?` kann man vergessen,
   * ein `| null` muss man hinschreiben.
   */
  ocr: OcrLaufDaten | null;
  /**
   * Die OCR-Zeilen, aus denen `ocrText` besteht — mit Rahmen im gespeicherten Bild und
   * Confidence. null beim Bildweg (keine OCR) und wenn keine Boxen angefordert waren
   * (`OCR_INCLUDE_BOXES` nicht gesetzt). Etappe 2 der Oberflaechen-Umstellung: die
   * Grundlage fuer "Zeile im Bild". Pflichtfeld mit null aus demselben Grund wie
   * `ocrText` und `ocr`.
   */
  ocrZeilen: OcrZeileKurz[] | null;
};

/**
 * Der Anbieter hat GEANTWORTET, aber mit einem Fehlerstatus — kein Netzwerkfehler,
 * keine Zeitüberschreitung. `status` trägt den rohen HTTP-Code, damit ein Aufrufer
 * (Task 3, `src/worker/extract-receipt.ts`) 503/429 ("der Mac ist gerade beschäftigt")
 * von jedem anderen Status unterscheiden kann, OHNE den für Menschen gedachten
 * Fehlertext zu parsen — ein Nachrichtentext ist die falsche Stelle für eine
 * Programm-Weiche (Entwurf E7a).
 */
export class ExtractionHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ExtractionHttpError';
  }
}

/**
 * Trägt die Modellantwort durch den Fehlerpfad. Ohne sie hinterlässt eine
 * abgelehnte Extraktion nur einen abgeschnittenen Fehlertext — genau die Blindheit,
 * die diese Fehlerklasse siebenmal teuer zu finden gemacht hat: dass das Modell
 * `lines` statt `items` schrieb, kam nur durch eine Handprobe ans Licht, nicht
 * aus den Daten.
 */
export class ExtractionSchemaError extends Error {
  constructor(
    message: string,
    readonly raw: unknown
  ) {
    super(message);
    this.name = 'ExtractionSchemaError';
  }
}

/**
 * Die Modellantwort wurde von der Tokenobergrenze abgeschnitten (`finish_reason ===
 * 'length'`), BEVOR das JSON vollständig war — kein kaputtes Modell, keine unlesbare
 * Antwort, sondern ein zu klein bemessenes `max_tokens` für DIESEN Bon (typischerweise:
 * ungewöhnlich viele Positionen). Ohne diese eigene Klasse liefe das entweder als
 * rohe `SyntaxError` aus `JSON.parse` (abgeschnittene Zeichenkette) oder — träfe der
 * Abbruch zufällig eine syntaktisch noch gültige Teilmenge — als
 * `ExtractionSchemaError` ("Antwort passt nicht zum Schema") durch. Beides verschleiert
 * die eigentliche Ursache und legt nahe, es sei ein Bon-/Modellproblem, das ein
 * blinder Wiederholungsversuch beheben könnte — tut es nicht: bei gleichem `max_tokens`
 * und `temperature: 0` bricht derselbe Bon deterministisch wieder an derselben Stelle
 * ab. Deshalb bewusst DAUERHAFT (siehe `istVoruebergehenderFehler` in
 * `src/worker/extract-receipt.ts`, das diese Klasse nicht kennt und darum per
 * Voreinstellung als dauerhaft einstuft) — jemand muss `max_tokens` nachziehen, kein
 * Retry löst das.
 *
 * Korrektur des Koordinators am 2026-09-15: ein 24-Positionen-Bon mit erzwungenem
 * Schema brach bei `max_tokens: 1200` reproduzierbar mitten im JSON ab
 * (`finish_reason: "length"`) — siehe `ocr-text-provider.ts`,
 * `MAX_TOKENS_STRUKTURIERT`, für die daraus abgeleitete Obergrenze.
 */
export class ExtractionTruncatedError extends Error {
  constructor(
    message: string,
    readonly raw: unknown
  ) {
    super(message);
    this.name = 'ExtractionTruncatedError';
  }
}

export interface ExtractionProvider {
  readonly id: string;
  readonly model: string;
  extract(image: Buffer, signal?: AbortSignal): Promise<ExtractionResult>;
}
