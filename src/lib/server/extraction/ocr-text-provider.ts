import { erzeugeTesseractAnbieter, laufDatenAus, kurz } from '../ocr/anbieter';
import type { OcrAnbieter, OcrLaufDaten, OcrZeileKurz } from '../ocr/anbieter';
import type { ExecFileImpl } from '../ocr/lesen';
import { pruefeOcrQualitaet } from '../ocr/qualitaet';
import type { OcrQualitaet } from '../ocr/qualitaet';
import { ExtractionSchemaError, ExtractionHttpError, ExtractionTruncatedError } from './types';
import { extractedReceiptSchema, bonResponseJsonSchema } from './schema';
import type { ExtractedReceipt } from './schema';
import { SYSTEM_PROMPT } from './prompt';
import { OCR_PROMPT_ZUSATZ, OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR } from './ocr-prompt-zusatz';
import { stripCodeFence, redactSecret, parseUsage, STANDARD_ZEITLIMIT_MS } from './openai-compat';
import type { ExtractionProvider } from './types';

/**
 * Aufgabe 4, Teil A: der Mac-Server (mlx_vlm, Port 8082) unterstützt ECHT erzwungene
 * JSON-Ausgabe über `response_format.json_schema` (llguidance-Grammatik, kein
 * Prompt-Hinweis). Gemessen über fünf Bons: ohne Schema ~980 Ausgabe-Token/26,9s,
 * mit Schema ~330 Token/17,8-19,0s — UND es beseitigt die reproduzierbar
 * auftretenden deutschen Kommas in JSON-Zahlen ("summe": 13,61), weil die Grammatik
 * an dieser Stelle schlicht kein Komma zulässt.
 *
 * `max_tokens` ist laut Messung PFLICHT: ohne sie greift serverseitig ein
 * Standardwert von 2048, und ein entgleistes Modell verbrennt die vollständig
 * (~68s für nichts).
 *
 * HERLEITUNG von MAX_TOKENS_STRUKTURIERT — NICHT die vom Mac-Betreiber gemessenen
 * 1200 übernommen, weil dessen Messung an SEINEN (kürzeren) Bons entstand: ein
 * 24-Positionen-Bon brach bei 1200 nachweislich mitten im JSON ab
 * (`finish_reason: "length"`, Korrektur des Koordinators am 2026-09-15). Stattdessen
 * aus unserem EIGENEN Schema hergeleitet (9 Felder je Position in
 * extractedItemSchema, deren Feldnamen bei JSON-Ausgabe mitzählen):
 *
 *   - Gemessen (2026-09-15, erzwungenes Schema, unser Schema): ein 24-Positionen-Bon
 *     brauchte in einer früheren Messung 2624 Ausgabe-Token. Das ergibt rund
 *     2624 / 24 ≈ 109 Token je Position.
 *   - Auslegungsfall bewusst über den gemessenen 24 hinaus: ein Wocheneinkauf kann
 *     40-50 Zeilen haben — mit Marge nach oben (60 statt 50) gerechnet, damit ein
 *     ungewöhnlich langer Bon nicht knapp wird: 109 × 60 ≈ 6558 Token.
 *   - Kopf (merchantName/-Address/purchasedAt/totalGrossCents/currency/
 *     paymentMethod) plus bis zu einigen vatSummary-Gruppen: geschätzt (nicht
 *     gemessen) mit 300 Token — deutlich kleiner als der Positionsanteil und nur
 *     EINMAL vorhanden, daher großzügig statt exakt hergeleitet.
 *   - macht 6558 + 300 ≈ 6860 Token roh.
 *   - +30% Marge: Artikelnamen/Rabattbezüge können in der Praxis länger ausfallen
 *     als im einen gemessenen Bon, und das ist eine Hochrechnung aus EINEM
 *     Messpunkt, keine Serie. 6860 × 1,3 ≈ 8918, aufgerundet auf 9000.
 *
 * Ein zu GROSSES max_tokens kostet praktisch nichts: die Grammatik beendet die
 * Ausgabe selbst, sobald ein vollständiges, schemakonformes JSON-Objekt steht — die
 * Obergrenze ist eine Notbremse für den Fall, dass ein Bon tatsächlich mehr
 * Positionen hat, nicht ein Ziel, auf das ständig hingearbeitet wird.
 *
 * UNVERIFIZIERT gegen den echten Mac mit einem tatsächlichen 40-60-Positionen-Bon
 * (siehe Task-4-Bericht) — der Betreiber sollte das nachmessen, sobald ein
 * entsprechend langer Bon vorliegt.
 */
export const MAX_TOKENS_STRUKTURIERT = 9000;

/**
 * Die Qualitätsprüfung (siehe `ocr/qualitaet.ts`) ist durchgefallen: der OCR-Text taugt
 * nicht als Bon. Genau der Fall, den Entwurf E3 verlangt — KEIN Modellaufruf, sondern
 * ein klar unterscheidbares Ergebnis nach oben, damit der Bon markiert statt geraten
 * wird. Trägt den OCR-Text und das Qualitätsurteil, damit ein Aufrufer (Task 3) beides
 * ohne zweiten OCR-Lauf ablegen kann (Entwurf E5).
 */
/**
 * Welches Kriterium den Bon durchfallen liess — im Klartext, nicht als Zahlenreihe.
 *
 * Anlass (2026-09-17, echter Bon): die Meldung lautete „24 Beträge, Summenzeile ja,
 * Datum nein" — und genau die beiden genannten Werte hätten BESTANDEN. Gegriffen hat
 * ein drittes Kriterium, das gar nicht in der Meldung vorkam (der Überhang des größten
 * Betrags). Wer das liest, muss zwangsläufig glauben, die Prüfung sei kaputt.
 *
 * Eine Fehlermeldung, die ihre eigene Entscheidung nicht erklären kann, ist derselbe
 * Defekt wie ein Rückfallwert, den niemand bemerken kann — sie sieht nach Auskunft aus
 * und ist keine.
 */
export function gruendeFuer(q: OcrQualitaet): string {
  const gruende: string[] = [];
  if (q.anzahlBetraege < 2) gruende.push('zu wenige erkennbare Beträge');
  if (!q.hatSummenzeile && !q.hatDatum) gruende.push('weder Summenzeile noch Datum gefunden');
  if (q.ueberhangGroessterBetrag !== null && q.ueberhangGroessterBetrag > 2) {
    gruende.push(
      'ein einzelner Betrag überragt alle übrigen zusammen um mehr als das Doppelte — ' +
        'das sieht nach einer Zahl aus, die gar kein Preis ist (Prozentsatz, ' +
        'Belegnummer, zwei zusammengelaufene Spalten)'
    );
  }
  return gruende.length > 0
    ? gruende.join('; ')
    : 'OCR-Text erfüllt die Qualitätsprüfung nicht';
}

export class BonUnlesbarError extends Error {
  constructor(
    readonly ocrText: string,
    readonly qualitaet: OcrQualitaet,
    /**
     * Etappe 2: WOMIT dieser unbrauchbare Text gelesen wurde. Genau die Zeile, in der
     * die Engine-Angabe am meisten zaehlt — "welche Engine faellt haeufiger durch die
     * Qualitaetspruefung" ist die halbe Fragestellung des Tesseract/PaddleOCR-
     * Vergleichs. Voreinstellung null, damit ein Test den Fehler weiter mit zwei
     * Argumenten bauen kann; der Anbieter selbst uebergibt sie immer.
     */
    readonly ocr: OcrLaufDaten | null = null,
    /** Die OCR-Zeilen, sofern Boxen angefordert waren — siehe ExtractionResult.ocrZeilen. */
    readonly ocrZeilen: OcrZeileKurz[] | null = null
  ) {
    super(
      `Bon unlesbar: ${gruendeFuer(qualitaet)} (${qualitaet.anzahlBetraege} Beträge, ` +
        `Summenzeile ${qualitaet.hatSummenzeile ? 'ja' : 'nein'}, Datum ` +
        `${qualitaet.hatDatum ? 'ja' : 'nein'}, Überhang größter Betrag ` +
        `${qualitaet.ueberhangGroessterBetrag === null ? '—' : qualitaet.ueberhangGroessterBetrag.toFixed(2)}).`
    );
    this.name = 'BonUnlesbarError';
  }
}

/**
 * Tesseract SELBST ist nicht einsatzbereit (fehlt, abgestürzt, Zeitlimit) — bewusst
 * unterschieden von `BonUnlesbarError`: dort hat Tesseract sauber gearbeitet und nur
 * Kauderwelsch geliefert, hier hat das WERKZEUG versagt. Ein Aufrufer (Task 3) muss
 * das trennen können, um dem Betreiber die richtige Ursache zu nennen ("Bild nachlegen"
 * vs. "Server-Problem").
 */
export class OcrWerkzeugKaputtError extends Error {
  constructor(
    readonly grund: string,
    /** Wie lange es lief, BEVOR es schieflief — siehe `OcrLaufDaten`. */
    readonly ocr: OcrLaufDaten | null = null,
    /**
     * Ob ein spaeterer Versuch Aussicht hat (Etappe 3). Voreinstellung `false` haelt
     * das bisherige Verhalten fuer Tesseract unveraendert: ein fehlendes Programm
     * repariert sich nicht von selbst.
     */
    readonly voruebergehend: boolean = false
  ) {
    super(`Tesseract ist nicht einsatzbereit: ${grund}`);
    this.name = 'OcrWerkzeugKaputtError';
  }
}

/**
 * Prüft, ob der Betrag `cents` (z. B. 100 für "1,00") im OCR-Text als POSITIVER Beleg
 * auftaucht — also mindestens einmal vorkommt, OHNE dass unmittelbar davor ein "-"
 * steht. Toleriert denselben OCR-Leerraum um das Trennzeichen wie `qualitaet.ts`
 * ("1 ,00").
 *
 * Der Grund für "ohne Minus davor" statt eines einfachen Substring-Tests: der bekannte
 * Restfehler (siehe `ocr-prompt-zusatz.ts`) erfindet eine `deposit`-Zeile über +1,00 EUR
 * genau dann, wenn der OCR-Text eine ECHTE Pfandrückgabe über -1,00 EUR enthält — "1,00"
 * kommt also im Text vor, aber NUR als Teil eines negativen Betrags. Ein Substring-Test
 * allein hätte diesen Fall als "belegt" durchgewunken, obwohl der Beleg in Wahrheit für
 * das GEGENTEIL (eine Rückgabe) spricht.
 */
function positivBelegt(cents: number, ocrText: string): boolean {
  const betrag = Math.abs(cents);
  const euro = Math.trunc(betrag / 100);
  const rest = String(betrag % 100).padStart(2, '0');
  // `(?<!\d)` VOR der optionalen Minus-Gruppe verhindert, dass z. B. "0,25" innerhalb
  // von "10,25" als eigener Treffer zählt (derselbe Betrag könnte sonst als Teil einer
  // grösseren, unabhängigen Zahl fälschlich als "belegt" durchgehen).
  const muster = new RegExp(`(?<!\\d)(-\\s*)?${euro}\\s*[.,]\\s*${rest}\\b`, 'g');
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(ocrText)) !== null) {
    if (!treffer[1]) return true;
  }
  return false;
}

/**
 * Der Restfehler aus Entwurf E7: eine `deposit`-Position, für die es im OCR-Text
 * keinen (positiven) Beleg gibt, fliegt raus — NICHT stillschweigend (siehe
 * `ExtractionResult.warnings`), sondern mit einer Meldung, die Betrag und Zeile
 * benennt. Betrifft ausdrücklich nur `deposit` (Pfand-AUFSCHLAG); `deposit_return`
 * (Pfand-RÜCKGABE, negativer Betrag) wird hier nie angefasst — der bekannte Fehler
 * betrifft nur die erfundene, gespiegelte POSITIVE Zeile.
 */
function entferneUnbelegtePfandzeilen(
  items: ExtractedReceipt['items'],
  ocrText: string
): { items: ExtractedReceipt['items']; warnings: string[] } {
  const warnings: string[] = [];
  const bereinigt = items.filter((item) => {
    if (item.lineType !== 'deposit') return true;
    if (positivBelegt(item.totalPriceCents, ocrText)) return true;
    const betragText = (item.totalPriceCents / 100).toFixed(2).replace('.', ',');
    warnings.push(
      `Position ${item.lineNo} ("${item.rawText || 'ohne Namen'}", Pfand ${betragText} EUR, ` +
        `lineType "deposit") entfernt: kein positiver Beleg im OCR-Text. Bekannter ` +
        `Restfehler (Entwurf E7) — das Modell leitet diese Art Zeile vermutlich aus einer ` +
        `echten Pfandrückgabe ab. Bitte von Hand gegen das Originalbild prüfen.`
    );
    return false;
  });
  return { items: bereinigt, warnings };
}

/**
 * Der Textweg-Anbieter (Entwurf E1-E7): Bild → Tesseract auf DIESEM Server →
 * NUR der OCR-Text geht an ein Modell auf der Hardware des Betreibers. Das Bild
 * selbst verlässt den Server nie — das ist der ganze Zweck von Aufgabe 2.
 *
 * Ablauf je Bon (siehe Aufgabenstellung):
 *  1. Puffer durch die gewaehlte OCR-Engine (`OcrAnbieter`, Standard Tesseract).
 *  2. Qualitätsprüfung über den Text (`pruefeOcrQualitaet`, Aufgabe 1).
 *  3. Besteht sie: Text ans Modell, Antwort durch DASSELBE Zod-Schema wie der Bildweg.
 *  4. Besteht sie NICHT: kein Modellaufruf — `BonUnlesbarError` nach oben (Entwurf E3).
 *
 * Tesseract selbst kaputt (fehlt/abgestürzt/Zeitlimit) ist ein DRITTER, eigener Fall
 * (`OcrWerkzeugKaputtError`) — auch hier kein Modellaufruf.
 *
 * HTTP-Mechanik (Timeout-Kombination, Header, Fehlerbehandlung, JSON-Parsing+Schema,
 * Usage/servedModel) bewusst WORTGLEICH zum Bildweg (`openai-compat.ts`) nachgebaut,
 * inklusive derselben Sicherheitsregeln (Secret-Redaction, Rohantwort im Fehlerfall) —
 * nur der Inhalt der Nachricht ist Text statt Bild, und der System-Prompt trägt den
 * Zusatz aus `ocr-prompt-zusatz.ts`.
 */
export function createOcrTextProvider(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  id?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  execFileImpl?: ExecFileImpl;
  ocrTimeoutMs?: number;
  /**
   * Welche OCR-Engine liest. Fehlt sie, wird Tesseract genommen — damit bleibt jeder
   * bestehende Aufruf (der nur `execFileImpl` uebergibt) unveraendert gueltig.
   */
  ocrAnbieter?: OcrAnbieter;
  /** Koordinaten und Confidence einsammeln. Gehen heute NICHT an das Modell. */
  mitBoxen?: boolean;
}): ExtractionProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const anbieterId = opts.id ?? 'ocr-text';
  const ocr = opts.ocrAnbieter ?? erzeugeTesseractAnbieter({ execFileImpl: opts.execFileImpl });

  return {
    id: anbieterId,
    model: opts.model,
    async extract(image, signal) {
      const ocrErgebnis = await ocr.lies(image, {
        timeoutMs: opts.ocrTimeoutMs,
        mitBoxen: opts.mitBoxen
      });

      // Die Laufdaten stehen auf ALLEN drei Zustaenden — deshalb hier, VOR der
      // Fallunterscheidung, und auch an beide Fehler weitergereicht: ein Bon, der an
      // der OCR scheitert, ist der Fall, in dem die Frage "welche Engine war das?"
      // am dringendsten ist.
      const lauf = laufDatenAus(ocrErgebnis);
      // Die Zeilen gibt es nur bei mitBoxen UND wenn die Engine sie lieferte; sonst
      // null — nicht [], siehe ExtractionResult.ocrZeilen.
      const zeilen = ocrErgebnis.status === 'gelesen' && ocrErgebnis.zeilen ? kurz(ocrErgebnis.zeilen) : null;

      if (ocrErgebnis.status === 'werkzeugKaputt') {
        throw new OcrWerkzeugKaputtError(
          ocrErgebnis.grund,
          lauf,
          ocrErgebnis.voruebergehend ?? false
        );
      }

      // "nichtsGefunden" (sauberer Lauf, aber nur Leerraum) fällt bei der
      // Qualitätsprüfung ohnehin durch (0 Beträge) — als leerer Text durch dieselbe
      // Prüfung geschickt, statt einen vierten Fall extra zu behandeln.
      const text = ocrErgebnis.status === 'gelesen' ? ocrErgebnis.text : '';
      const qualitaet = pruefeOcrQualitaet(text);
      if (!qualitaet.brauchbar) {
        throw new BonUnlesbarError(text, qualitaet, lauf, zeilen);
      }

      const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? STANDARD_ZEITLIMIT_MS);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      const response = await doFetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: combinedSignal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
          // Dieselbe Abacus-Edge-WAF-Umgehung wie beim Bildweg — schadet auch gegen
          // einen anderen Endpunkt nicht.
          'user-agent': 'bon-app/1.0'
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          // Aufgabe 4, Teil A: PFLICHT laut Messung — ohne sie greift serverseitig
          // 2048, ein entgleistes Modell verbrennt die vollständig. Herleitung siehe
          // Kommentar bei MAX_TOKENS_STRUKTURIERT oben.
          max_tokens: MAX_TOKENS_STRUKTURIERT,
          // ECHT erzwungene Ausgabe (llguidance-Grammatik auf dem Mac), nicht nur ein
          // Prompt-Hinweis — abgeleitet aus unserem Zod-Schema (schema.ts), nicht von
          // Hand danebengeschrieben. `strict: true` laut Bericht des Mac-Betreibers.
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'bon', schema: bonResponseJsonSchema, strict: true }
          },
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_PROMPT}\n\n${OCR_PROMPT_ZUSATZ}\n\n${OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR}`
            },
            {
              role: 'user',
              content: `Lies diesen Kassenbon. Der folgende Text stammt aus einer Texterkennung (OCR), nicht aus einem Bild:\n\n${text}`
            }
          ]
        })
      });

      if (!response.ok) {
        // Derselbe Grund wie beim Bildweg: der rohe Body geht NIE in die geworfene
        // Fehlermeldung (potenzielle Echo-Antworten/WAF-Seiten mit Header-Daten) —
        // nur redigiert und gekürzt ins Server-Log.
        const body = await response.text().catch(() => '');
        const safeBody = redactSecret(body, opts.apiKey).slice(0, 500);
        console.error(
          `[extraction] ${anbieterId}: HTTP ${response.status} von ${opts.baseUrl}/chat/completions`,
          safeBody
        );
        // ExtractionHttpError statt eines schlichten Error — derselbe Grund wie beim
        // Bildweg (openai-compat.ts): Task 3 (Entwurf E7a) muss 503/429 (der Mac ist
        // gerade beschäftigt, 2-3 gleichzeitige Anfragen sind die gemessene Grenze)
        // von einem dauerhaften Fehler unterscheiden können.
        throw new ExtractionHttpError(
          response.status,
          `Extraktion fehlgeschlagen: LLM antwortete mit HTTP ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        model?: unknown;
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content;

      // Korrektur des Koordinators (2026-09-15): mit max_tokens: 1200 brach ein
      // 24-Positionen-Bon nachweislich mitten im JSON ab. `finish_reason: "length"`
      // ist der maschinenlesbare Beleg GENAU dafür — VOR dem Content-Check und VOR
      // JSON.parse abgefangen, sonst liefe das als undurchsichtiger SyntaxError oder
      // (schlimmer) als ExtractionSchemaError durch und sähe wie ein Modell-/
      // Bonproblem aus, obwohl ein Retry bei gleichem max_tokens deterministisch
      // wieder an derselben Stelle abbricht (siehe ExtractionTruncatedError).
      if (payload.choices?.[0]?.finish_reason === 'length') {
        throw new ExtractionTruncatedError(
          `Extraktion abgebrochen: die Modellantwort wurde bei max_tokens=${MAX_TOKENS_STRUKTURIERT} ` +
            `abgeschnitten (finish_reason "length"), bevor das JSON vollständig war. Vermutlich hat ` +
            `dieser Bon mehr Positionen, als die aktuelle Tokenobergrenze vorsieht — bitte melden ` +
            `(MAX_TOKENS_STRUKTURIERT anheben), ein erneuter Versuch bricht bei gleicher Eingabe ` +
            `deterministisch wieder ab.`,
          content ?? null
        );
      }
      if (!content) throw new Error('Extraktion fehlgeschlagen: LLM-Antwort ohne Inhalt');

      // Erst parsen, DANN validieren — mit der Rohantwort in der Hand (siehe
      // openai-compat.ts, derselbe Grund: eine abgelehnte Extraktion braucht die
      // Rohantwort, sonst bleibt nur ein abgeschnittener Fehlertext).
      const raw: unknown = JSON.parse(stripCodeFence(content));
      const geprueft = extractedReceiptSchema.safeParse(raw);
      if (!geprueft.success) {
        const stellen = geprueft.error.issues
          .map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
          .join('; ');
        throw new ExtractionSchemaError(
          `Extraktion fehlgeschlagen: Antwort passt nicht zum Schema — ${stellen}`,
          raw
        );
      }

      const { items, warnings } = entferneUnbelegtePfandzeilen(geprueft.data.items, text);
      const receipt: ExtractedReceipt = { ...geprueft.data, items };

      const servedModel =
        typeof payload.model === 'string' && payload.model.trim() !== ''
          ? payload.model.trim()
          : null;

      // ocrText: der Text, der tatsaechlich an das Modell ging (Entwurf E5) — der
      // einzige Beleg, was gelesen wurde, unabhaengig davon, ob das Modell ihn richtig
      // gedeutet hat.
      return {
        receipt,
        usage: parseUsage(payload.usage),
        raw,
        servedModel,
        warnings,
        ocrText: text,
        ocr: lauf,
        ocrZeilen: zeilen
      };
    }
  };
}
