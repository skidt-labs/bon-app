// pg-boss 12 exportiert `Job<T>` als eigenen benannten Typ, nicht als `PgBoss.Job<T>`
// (dieselbe Fußangel wie beim `PgBoss`-Klassenimport selbst, siehe queue/boss.ts).
import type { Job } from 'pg-boss';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { receipts, receiptItems, extractionRuns } from '$lib/server/db/schema';
import { receiptPathFor } from '$lib/server/storage/images';
import { parseBonZeit } from '$lib/server/zeit';
import { ExtractionSchemaError, ExtractionHttpError, ExtractionTruncatedError } from '$lib/server/extraction/types';
import { BonUnlesbarError, OcrWerkzeugKaputtError } from '$lib/server/extraction/ocr-text-provider';
import { checkPlausibility } from '$lib/server/validation/plausibility';
import type { ExtractionProvider, ExtractionUsage } from '$lib/server/extraction';
import type { ExtractedReceipt } from '$lib/server/extraction/schema';
import { KiKonfigurationFehler } from '$lib/server/ki/fehler';
import { preiseAusEnv, type Preise } from '$lib/server/ki/preise';
export { preiseAusEnv, type Preise };
import type { OcrLaufDaten, OcrZeileKurz } from '$lib/server/ocr/anbieter';
import { ordneZeilenZu } from '$lib/server/ocr/zuordnung';
import { getBoss, QUEUE_EXTRACT, type ExtractJob } from '$lib/server/queue/boss';
import { readFile } from 'node:fs/promises';
import { haendlerAufloesen } from '$lib/server/merchants';
import { bonEinsortieren } from '$lib/server/kategorien/einsortieren';
import { echteModellDeps } from '$lib/server/kategorien/modell';
import { notifyMatrix } from '$lib/server/notify';
import { DOPPEL_GRUND, originalFuerNeuenBon } from '$lib/server/bons/doppelt';

/**
 * Entwurf E7a: unterscheidet einen VORÜBERGEHENDEN Fehler (der Mac ist gerade
 * beschäftigt oder kurz nicht erreichbar) von einem DAUERHAFTEN (die Antwort taugt
 * nichts, das Bild ist unlesbar, das Werkzeug ist kaputt). Nur die zweite Gruppe darf
 * den Bon auf 'failed' setzen — die erste gehört zurück in die Warteschlange.
 *
 * Gemessen am 2026-09-15 (Entwurf E7a): zwei Anfragen kurz hintereinander an den Mac
 * lieferten HTTP 503; mit einer Pause dazwischen liefen dieselben beiden Bons
 * fehlerfrei durch. Das ist KEIN kaputter Bon, sondern ein überlasteter/kurz
 * abwesender Server — der Betreiber nennt 2-3 gleichzeitige Anfragen als realistische
 * Grenze.
 *
 *  - HTTP 503/429       → vorübergehend (`ExtractionHttpError.status`, siehe
 *                          extraction/types.ts — beide Anbieter werfen diesen Typ)
 *  - Verbindungsabbruch → vorübergehend: Node/undici wirft bei einem echten
 *                          Netzwerkfehler (Mac nicht erreichbar, DNS, Reset, ...)
 *                          einen `TypeError('fetch failed')`. NIE bei einer
 *                          tatsächlich empfangenen Antwort, gleich welchen Status sie
 *                          trägt — die Unterscheidung ist also robust.
 *  - Zeitüberschreitung/
 *    externer Abbruch  → vorübergehend: `AbortSignal.timeout()` wirft eine
 *                          `DOMException` namens 'TimeoutError'; ein von aussen
 *                          abgebrochener Job (pg-boss, Worker-Shutdown) wirft
 *                          'AbortError'. Beides ist "später nochmal", keine Aussage
 *                          über den Bon selbst.
 *  - alles andere       → dauerhaft (Schema-Fehler, `BonUnlesbarError`,
 *                          `OcrWerkzeugKaputtError`, jeder sonstige Programmfehler)
 *
 * Bewusst über den FEHLERTYP entschieden, nicht über den Nachrichtentext: ein reiner
 * String-Vergleich (z. B. auf "fetch failed") wäre fragil UND hätte einen
 * bestehenden Test (extract-receipt.test.ts, "reicht undefined durch, wenn es gar
 * keine Antwort gab", der absichtlich einen gewöhnlichen `Error('fetch failed')`
 * konstruiert) versehentlich umklassifiziert.
 */
export function istVoruebergehenderFehler(err: unknown): boolean {
  // Fehler der KI-KONFIGURATION (Bildweg nicht freigegeben, Schluessel nicht lesbar):
  // der Bon ist nicht schuld. Repariert der Betreiber die Einstellung, laeuft er beim
  // naechsten Versuch durch.
  if (err instanceof KiKonfigurationFehler) return true;
  // Etappe 3: ein OCR-WERKZEUG kann voruebergehend ausfallen, seit eines davon ein
  // eigener Container ist. Tesseract meldet hier weiterhin nie `voruebergehend` — sein
  // Verhalten bleibt unveraendert dauerhaft.
  if (err instanceof OcrWerkzeugKaputtError) return err.voruebergehend;
  if (err instanceof ExtractionHttpError) return err.status === 503 || err.status === 429;
  if (err instanceof TypeError && err.message === 'fetch failed') return true;
  if (err instanceof DOMException) return err.name === 'TimeoutError' || err.name === 'AbortError';
  return false;
}

/** pg-bosses Wiederholungsstand eines Jobs — siehe RetryInfo/getRetryInfo unten. */
export type RetryInfo = { retryCount: number; retryLimit: number };

/**
 * Aufgabe 4, Teil B: pg-bosses eigener Zaehler erhoeht `retryCount` bei JEDEM erneuten
 * Antritt (fetch-Zeitpunkt, siehe node_modules/pg-boss/dist/plans.js,
 * "retry_count = CASE WHEN started_on IS NOT NULL THEN retry_count + 1 ELSE
 * retry_count END") und vergleicht ihn beim NAECHSTEN Fehlschlag mit `retryLimit`: ist
 * `retryCount = retryLimit` bereits ERREICHT, legt pg-boss den Job NICHT noch einmal
 * an (siehe plans.js, failJobsBody: "CASE WHEN retry_count < retry_limit THEN
 * 'retry' ELSE 'failed' END"). Genau DIESER Antritt ist also der letzte, den pg-boss
 * ueberhaupt gewaehrt — misslingt er, kommt handleExtractJobs fuer diesen Bon nie
 * wieder ins Spiel, und ohne diese Pruefung bliebe er fuer immer auf 'extracting'
 * stehen (das Kernproblem aus der Aufgabenstellung, Teil B Punkt 2).
 */
export function istLetzterErlaubterVersuch(info: RetryInfo): boolean {
  return info.retryCount >= info.retryLimit;
}

export type SaveArgs = {
  receiptId: string;
  result: ExtractedReceipt;
  problems: string[];
  provider: string;
  model: string;
  durationMs: number;
  usage: ExtractionUsage;
  /** Die unveränderte Modellantwort — siehe ExtractionResult.raw. */
  raw: unknown;
  /** Das Modell, das laut Antwort geantwortet hat — siehe ExtractionResult.servedModel. */
  servedModel: string | null;
  /**
   * Der OCR-Text, aus dem das Ergebnis entstand — null beim Bildweg. Entwurf E5:
   * einziger Beleg, was tatsächlich gelesen wurde.
   */
  ocrText: string | null;
  /** Womit gelesen wurde — siehe ExtractionResult.ocr. null beim Bildweg. */
  ocr: OcrLaufDaten | null;
  /** Die OCR-Zeilen des Laufs — siehe ExtractionResult.ocrZeilen. null ohne Boxen. */
  ocrZeilen: OcrZeileKurz[] | null;
};

export type ExtractDeps = {
  loadImage: (receiptId: string) => Promise<Buffer>;
  provider: ExtractionProvider;
  saveResult: (args: SaveArgs) => Promise<void>;
  /**
   * `raw` ist die Modellantwort, sofern es überhaupt eine gab. Ohne sie hinterlässt
   * ein abgelehnter Bon nur einen abgeschnittenen Fehlertext — und genau daran ist
   * diese Fehlerklasse siebenmal fast unbemerkt vorbeigelaufen.
   *
   * `ocrText` (Entwurf E5): der OCR-Text, falls es einen gab — insbesondere bei
   * `BonUnlesbarError` (die Qualitätsprüfung ist durchgefallen, aber Tesseract HAT
   * etwas geliefert). Ohne ihn wäre bei einem als unlesbar markierten Bon nicht mehr
   * nachvollziehbar, WAS genau die Prüfung durchfallen liess.
   *
   * Warum die drei seit Etappe 2 in EINEM Objekt stecken statt als drei nachgestellte
   * Parameter: mit `ocr` waeren es vier gewesen, drei davon optional und zwei mit
   * verwandten Namen (`ocrText`/`ocr`). Ein an falscher Position uebergebener Wert
   * faellt dort niemandem auf — die Aufrufstelle zeigt nur `undefined, undefined, x`.
   * Benannte Felder sagen an der Aufrufstelle selbst, was gemeint ist.
   */
  markFailed: (receiptId: string, reason: string, belege?: FehlerBelege) => Promise<void>;
  now: () => Date;
  /**
   * Aufgabe 4, Teil B: liefert `retryCount`/`retryLimit` des GERADE laufenden Jobs.
   * pg-bosses `work()`-Handler bekommt diese Felder NICHT mitgeliefert (der Job
   * traegt nur `id`/`name`/`data`/... — siehe node_modules/pg-boss/dist/plans.js,
   * JOB_COLUMNS_MIN), nur `boss.getJobById()` liefert sie. Gebraucht, um bei einem
   * VORÜBERGEHENDEN Fehler zu erkennen, ob dies der letzte von pg-boss erlaubte
   * Antritt ist (siehe istLetzterErlaubterVersuch) — sonst bliebe ein Bon, dessen
   * Wiederholungsbudget ausgeschöpft ist, für immer auf 'extracting' stehen.
   */
  getRetryInfo: (jobId: string) => Promise<RetryInfo>;
};

export async function handleExtractJobs(
  jobs: Job<ExtractJob>[],
  deps: ExtractDeps
): Promise<void> {
  const failures: unknown[] = [];

  for (const job of jobs) {
    const { receiptId } = job.data;
    const startedAt = Date.now();
    try {
      const image = await deps.loadImage(receiptId);
      const { receipt: result, usage, raw, servedModel, warnings, ocrText, ocr, ocrZeilen } = await deps.provider.extract(
        image,
        job.signal
      );
      // Aufgabenstellung Punkt 3: `warnings` (Entwurf E7, Aufgabe 2) war bisher nur
      // Transportweg — niemand sah sie. `needsReviewReason` ist der bestehende,
      // tatsächlich sichtbare Weg (Review-Ansicht, Posteingang); checkPlausibility
      // deckt Punkt 5 (fehlende Endsumme) bereits selbst über 'missing_total' ab.
      const problems = [...checkPlausibility(result, deps.now()), ...warnings];
      await deps.saveResult({
        receiptId,
        result,
        problems,
        provider: deps.provider.id,
        model: deps.provider.model,
        durationMs: Date.now() - startedAt,
        usage,
        raw,
        servedModel,
        ocrText,
        ocr,
        ocrZeilen
      });
    } catch (err) {
      if (istVoruebergehenderFehler(err)) {
        // Aufgabe 4, Teil B: erst prüfen, ob pg-boss diesen Bon überhaupt noch
        // einmal anfassen WIRD, bevor entschieden wird, ob der Stapel wirft. Das
        // Wiederholungsbudget (queue/boss.ts) ist jetzt so bemessen, dass es einen
        // über Nacht ausgeschalteten Mac übersteht — aber irgendwann IST es
        // ausgeschöpft, und dann darf der Bon nicht für immer "wird ausgelesen"
        // (Status 'extracting') behaupten.
        const retryInfo = await deps.getRetryInfo(job.id);
        if (!istLetzterErlaubterVersuch(retryInfo)) {
          // Entwurf E7a: 503/429/Zeitüberlauf/Verbindungsabbruch heissen "später
          // nochmal", nicht "kaputt" — KEIN markFailed, receipts.status bleibt auf
          // 'extracting' stehen (von loadImage gesetzt). Der Bon bleibt damit
          // faktisch in der Warteschlange: pg-boss sieht denselben Job als
          // fehlgeschlagen (der throw unten) und legt ihn gemäss
          // retryLimit/retryDelay (queue/boss.ts) automatisch erneut auf.
          console.error(
            `[worker] Bon ${receiptId}: vorübergehender Fehler, bleibt in der Warteschlange ` +
              `(Versuch ${retryInfo.retryCount + 1}/${retryInfo.retryLimit + 1}, pg-boss versucht erneut)`,
            err
          );
          failures.push(err);
          continue;
        }

        // Letzter erlaubter Antritt UND immer noch (nur) vorübergehend: pg-boss
        // wird diesen Job NICHT noch einmal anlegen (siehe istLetzterErlaubterVersuch).
        // Bliebe der Bon jetzt einfach auf 'extracting' stehen, wäre er GENAU der
        // Defekt, den Aufgabe 4 beheben soll — "wird ausgelesen" für immer, ohne
        // dass jemand es bemerken kann. Reason bewusst ANDERS formuliert als
        // BonUnlesbarError ("der Bon ist unlesbar") — hier ist der BON nicht das
        // Problem, sondern die ERREICHBARKEIT des Modells.
        const reason =
          `Konnte nicht ausgelesen werden: das Modell war auch nach ${retryInfo.retryLimit + 1} ` +
          `Versuchen nicht erreichbar. Letzter Fehler: ${err instanceof Error ? err.message : String(err)}`;
        console.error(
          `[worker] Bon ${receiptId}: Wiederholungsbudget ausgeschöpft, wird als gescheitert markiert (weiterhin vorübergehende Ursache)`,
          err
        );
        try {
          await deps.markFailed(receiptId, reason);
          // KEIN failures.push(err): markFailed hat den Bon terminal markiert (er
          // steht jetzt sichtbar auf 'failed', nicht mehr auf 'extracting') — pg-boss
          // braucht diesen Job nicht noch einmal zu sehen, es gäbe ohnehin keinen
          // weiteren Antritt mehr (siehe istLetzterErlaubterVersuch oben).
        } catch (markErr) {
          console.error(`[worker] markFailed für Bon ${receiptId} fehlgeschlagen`, markErr);
          failures.push(markErr);
        }
        continue;
      }

      const reason = err instanceof Error ? err.message : String(err);
      // Hat das Modell geantwortet und nur das Schema abgelehnt (oder die Antwort
      // wurde abgeschnitten), liegt sie dem Fehler bei. Sie ist der einzige Beleg
      // dafür, WAS es geschrieben hat — ohne sie bleibt nur "passt nicht zum Schema"
      // und die Suche beginnt bei null.
      const belege: FehlerBelege = {
        raw:
          err instanceof ExtractionSchemaError || err instanceof ExtractionTruncatedError
            ? err.raw
            : undefined,
        // Entwurf E5: bei einem als unlesbar markierten Bon (Qualitätsprüfung
        // durchgefallen) ist der OCR-Text der einzige Beleg, WAS Tesseract geliefert hat.
        ocrText: err instanceof BonUnlesbarError ? err.ocrText : undefined,
        // Etappe 2: beide OCR-Fehler tragen ihre Laufdaten mit. Sie sind DAUERHAFT
        // (siehe istVoruebergehenderFehler), landen also hier und nirgends sonst —
        // ohne diese Zeile fehlte die Engine-Angabe ausgerechnet bei den Bons, die an
        // der OCR gescheitert sind.
        ocr:
          err instanceof BonUnlesbarError || err instanceof OcrWerkzeugKaputtError
            ? err.ocr
            : undefined,
        // Etappe 2 der Oberflaeche: auch ein unlesbarer Bon traegt seine Zeilen.
        ocrZeilen: err instanceof BonUnlesbarError ? err.ocrZeilen : undefined
      };
      try {
        await deps.markFailed(receiptId, reason, belege);
        // KEIN failures.push(err): ein DAUERHAFTER Fehler ist mit dieser
        // erfolgreichen Schreibung bereits vollständig und terminal behandelt (Bon
        // steht sichtbar auf 'failed') — pg-boss soll ihn NICHT noch einmal
        // anfassen. Andernfalls würde ein erhöhtes Wiederholungsbudget (Teil B,
        // Punkt 1) genau den dauerhaften Fehler unnötig oft wiederholen, den die
        // Aufgabenstellung ausdrücklich ausschliesst — derselbe Bon würde bei
        // jedem Versuch erneut (und erfolglos) ans Modell geschickt.
      } catch (markErr) {
        // Die kompensierende Schreibung darf den Stapel nicht mitreißen: schlägt sie
        // aus demselben Grund fehl wie die Extraktion selbst (z. B. DB nicht
        // erreichbar), sollen die übrigen Jobs im Stapel trotzdem versucht werden.
        // Sie geht ins Log und zusätzlich in `failures`, damit SIE (nicht der
        // ursprüngliche, bereits geloggte Fehler) den Stapel als fehlgeschlagen
        // markiert — ohne sie hätte der Bon nämlich WEDER eine terminale
        // Markierung NOCH einen weiteren pg-boss-Antritt bekommen.
        console.error(`[worker] markFailed für Bon ${receiptId} fehlgeschlagen`, markErr);
        failures.push(markErr);
      }
    }
  }

  // Erst nach dem Stapel werfen: ein kaputter Bon darf die übrigen nicht mitreißen,
  // pg-boss soll den Stapel aber trotzdem als fehlgeschlagen sehen und erneut anlaufen
  // — nur wenn tatsächlich noch etwas offen ist (ein noch nicht ausgeschöpfter
  // vorübergehender Fehler, oder eine fehlgeschlagene markFailed-Kompensation).
  if (failures.length > 0) throw failures[0];
}

/**
 * Welches Modell in die Zeile kommt — und wann die Abweichung festgehalten wird.
 *
 * `model` beschreibt, was die Zahlen ERZEUGT hat, also das gelieferte Modell. Meldet
 * der Anbieter keines, bleibt es beim konfigurierten Wert; etwas Besseres wissen wir
 * dann nicht, und eine erfundene Angabe waere schlimmer als gar keine.
 * `requestedModel` wird NUR bei Abweichung gefuellt: null heisst "wir haben bekommen,
 * was wir wollten". Eine stille Umleitung wird damit in den Daten sichtbar, ohne in
 * jeder Zeile denselben Wert zu wiederholen.
 */
/**
 * Was ein dauerhaft gescheiterter Bon an Belegen hinterlaesst. Jedes Feld darf
 * fehlen: ein Netzwerkfehler hat keine Modellantwort, ein Schema-Fehler keine
 * OCR-Laufdaten. `undefined` heisst hier durchgaengig "es gab nie eines" — in der
 * Datenbank wird daraus ein ausdrueckliches null (siehe `markFailed`).
 */
export type FehlerBelege = {
  /** Die unveraenderte Modellantwort, sofern es ueberhaupt eine gab. */
  raw?: unknown;
  /** Der OCR-Text, sofern OCR lief (Entwurf E5). */
  ocrText?: string | null;
  /** Womit gelesen wurde, sofern OCR lief (Etappe 2). */
  ocr?: OcrLaufDaten | null;
  /** Die OCR-Zeilen, sofern OCR mit Boxen lief (Etappe 2 der Oberflaeche). */
  ocrZeilen?: OcrZeileKurz[] | null;
};

/**
 * Die vier OCR-Spalten aus den Laufdaten — an einer Stelle, weil beide Schreibwege
 * (`saveResult` und `markFailed`) sie befuellen muessen und zwei getrennte
 * Abbildungen genau die Art Drift ergaeben, bei der der Vergleich spaeter auf einer
 * Seite Luecken hat.
 *
 * Ohne OCR bleiben alle vier null — nicht 0 und nicht 'keine': eine 0 in
 * `ocr_duration_ms` waere eine Behauptung ueber einen Lauf, den es nie gab.
 * `engineVersion` meldet Tesseract heute nicht; auch das ist eine Leerstelle und
 * keine leere Zeichenkette.
 */
export function ocrFelder(ocr: OcrLaufDaten | null | undefined): {
  ocrEngine: string | null;
  ocrEngineVersion: string | null;
  ocrDurationMs: number | null;
  ocrOptions: Record<string, unknown> | null;
} {
  if (!ocr) {
    return { ocrEngine: null, ocrEngineVersion: null, ocrDurationMs: null, ocrOptions: null };
  }
  return {
    ocrEngine: ocr.engine,
    ocrEngineVersion: ocr.engineVersion ?? null,
    ocrDurationMs: ocr.durationMs,
    ocrOptions: ocr.options
  };
}

export function modellFelder(
  servedModel: string | null,
  konfiguriert: string
): { model: string; requestedModel: string | null } {
  if (servedModel === null) return { model: konfiguriert, requestedModel: null };
  return {
    model: servedModel,
    requestedModel: servedModel === konfiguriert ? null : konfiguriert
  };
}

/**
 * Kosten in Millionstel Euro. Die Preise stehen in der Env als Mikro-Euro je
 * MILLION Token. Fehlen sie, bleibt die Spalte null — eine erfundene 0 würde
 * behaupten, der Aufruf sei kostenlos gewesen.
 *
 * Die Zahl ist eine NÄHERUNG: die Preise sind in Dollar ausgewiesen und mit einem
 * Kurs von 0,92 USD/EUR (Stand 2026-09-14) umgerechnet, der schwankt. Sie taugt zum
 * relativen Vergleich zweier Anbieter — Cloud gegen Mac mini in Phase 7 — und
 * ausdrücklich NICHT als Buchhaltungsgrösse.
 *
 * Ohne `preise` wie bisher aus der .env; ein Anbieter aus der Oberflaeche bringt eigene mit.
 */
export function kostenAusTokens(usage: ExtractionUsage, preise: Preise = preiseAusEnv()): number | null {
  if (!usage) return null;
  const { einMicro: ein, ausMicro: aus } = preise;
  if (ein === null || aus === null) return null;
  return Math.round((usage.inputTokens * ein + usage.outputTokens * aus) / 1_000_000);
}

type SanitizedItem = ExtractedReceipt['items'][number] & { lineNo: number; appliesToLine: number | null };

/**
 * Bereitet die Positionen VOR dem Insert auf, damit ein kaputtes Feld nie den
 * ganzen Bon mitreißt:
 *  - Doppelte lineNo-Werte (Task 10s duplicate_line_no) verletzen den
 *    Unique-Constraint (receipt_items_line_unique) und würfen sonst den
 *    kompletten INSERT — der Bon stürbe, obwohl nur eine Zeilennummer kaputt
 *    ist. Die erste Zeile mit einer Nummer behält sie; jede weitere bekommt die
 *    nächste freie Nummer oberhalb der größten ORIGINAL-lineNo (garantiert
 *    keine Kollision mit einer noch unverarbeiteten Original-Nummer weiter
 *    hinten in der Liste). rawText bleibt unangetastet — nur die Nummer wird
 *    korrigiert, checkPlausibility hat "duplicate_line_no" bereits auf den
 *    Rohdaten gemeldet, das bleibt für den Menschen im Review sichtbar.
 *  - appliesToLine-Bezüge werden entsprechend mitgeführt (zeigt ein Rabatt auf
 *    die umnummerierte Zeile, muss er nach der Umnummerierung weiter auf
 *    dieselbe Position zeigen). War die referenzierte lineNo im Original
 *    aber selbst mehrfach vergeben, ist nicht mehr feststellbar, WELCHE der
 *    beiden Zeilen gemeint war — der Bezug wird dann auf null gesetzt, genau
 *    wie ein unauflösbarer Bezug (sichtbar über discount_unlinked, das schon
 *    auf den Rohdaten berechnet wurde, unabhängig von dieser Funktion).
 */
export function sanitizeItemsForInsert(items: ExtractedReceipt['items']): SanitizedItem[] {
  if (items.length === 0) return [];

  const countByOriginal = new Map<number, number>();
  for (const i of items) countByOriginal.set(i.lineNo, (countByOriginal.get(i.lineNo) ?? 0) + 1);

  const seenOriginal = new Set<number>();
  const usedFinal = new Set<number>();
  let nextCandidate = Math.max(...items.map((i) => i.lineNo)) + 1;
  const finalLineNoByIndex: number[] = [];

  for (const i of items) {
    if (!seenOriginal.has(i.lineNo)) {
      seenOriginal.add(i.lineNo);
      usedFinal.add(i.lineNo);
      finalLineNoByIndex.push(i.lineNo);
    } else {
      while (usedFinal.has(nextCandidate)) nextCandidate++;
      usedFinal.add(nextCandidate);
      finalLineNoByIndex.push(nextCandidate);
      nextCandidate++;
    }
  }

  // Bezüge nur für lineNo-Werte auflösen, die im Original GENAU EINMAL vorkamen.
  const unambiguous = new Map<number, number>();
  items.forEach((i, idx) => {
    if (countByOriginal.get(i.lineNo) === 1) unambiguous.set(i.lineNo, finalLineNoByIndex[idx]);
  });

  return items.map((i, idx) => ({
    ...i,
    lineNo: finalLineNoByIndex[idx],
    appliesToLine: i.appliesToLine !== null ? (unambiguous.get(i.appliesToLine) ?? null) : null
  }));
}

/**
 * pg-boss kennt keinen Teilerfolg innerhalb eines Batches: wirft handleExtractJobs
 * (weil mindestens ein Job im Stapel gescheitert ist), markiert pg-bosses
 * boss.fail(name, jobIds, err) JEDE Job-ID im Stapel als fehlgeschlagen und
 * retried sie alle — auch die, deren saveResult bereits erfolgreich committet
 * hat. Bei batchSize > 1 würde ein bereits gespeicherter Bon erneut beim
 * Provider abgerechnet und liefe erneut durch extracting -> review, womöglich
 * über einen inzwischen confirmed-Status hinweg. Deshalb eine harte
 * Startup-Assertion statt eines stillen Bugs: ein Worker, der mit batchSize > 1
 * gestartet würde, soll gar nicht erst hochkommen. Für echtes Batching gäbe es
 * in pg-boss 12 den `perJobResults`-Modus (individuelle Erfolg/Fehlschlag-
 * Rückmeldung pro Job im Batch) — das ist hier bewusst NICHT implementiert,
 * weil es aktuell (batchSize 1) keinen Nutzen hätte.
 */
export function assertBatchSizeOne(batchSize: number): void {
  if (batchSize !== 1) {
    throw new Error(
      `bon-app worker: batchSize muss 1 sein, ist aber ${batchSize} — siehe Kommentar bei assertBatchSizeOne in src/worker/extract-receipt.ts`
    );
  }
}

/**
 * `kiAnbieterId`/`preise` kommen vom wechselnden Anbieter (ki/aktiv.ts) und werden ERST
 * NACH `extract` gelesen — dann zeigen sie auf den Anbieter, der diesen Bon gelesen hat.
 * Fehlen sie (Tests, alter Aufruf), gilt: .env-Weg, Preise aus der .env.
 */
export function productionDeps(
  provider: ExtractionProvider & { readonly kiAnbieterId?: string | null; readonly preise?: Preise }
): ExtractDeps {
  return {
    async loadImage(receiptId) {
      const [row] = await db
        .select({ imagePath: receipts.imagePath })
        .from(receipts)
        .where(eq(receipts.id, receiptId));
      if (!row) throw new Error(`Bon ${receiptId} nicht gefunden`);
      await db.update(receipts).set({ status: 'extracting' }).where(eq(receipts.id, receiptId));
      return readFile(receiptPathFor(row.imagePath));
    },

    provider,

    async saveResult({
      receiptId, result, problems, provider: pid, model, durationMs, usage, raw, servedModel, ocrText, ocr, ocrZeilen
    }) {
      const purchasedAt = parseBonZeit(result.purchasedAt);
      // Doppel-Erkennung (bons/doppelt.ts) VOR der Transaktion, nicht darin: scheitert die
      // Suche, waere eine Postgres-Transaktion danach abgebrochen und naehme den ganzen Bon
      // mit. So faellt nur der Hinweis weg — ein Bon wird nie wegen einer Nebenpruefung
      // verworfen, derselbe Grundsatz wie bei der Haendler-Aufloesung weiter unten.
      let vermutetesOriginalId: string | null = null;
      try {
        vermutetesOriginalId = await originalFuerNeuenBon(db, receiptId, purchasedAt, result.totalGrossCents);
      } catch (fehler) {
        const meldung = fehler instanceof Error ? fehler.message : String(fehler);
        console.error(`[worker] Doppel-Suche für Bon ${receiptId} fehlgeschlagen, Bon läuft ohne Hinweis weiter: ${meldung}`);
      }
      const gruende = vermutetesOriginalId ? [...problems, DOPPEL_GRUND] : problems;

      await db.transaction(async (tx) => {
        await tx.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
        const sanitized = sanitizeItemsForInsert(result.items);
        // Auf den BEREINIGTEN Positionen, nicht auf result.items: sanitizeItemsForInsert
        // vergibt bei doppelter lineNo neue Nummern, und die Zuordnung muss zu den
        // Nummern passen, die gleich in der Datenbank stehen.
        const zuordnung = ocrZeilen
          ? ordneZeilenZu(
              sanitized.map((i) => ({ lineNo: i.lineNo, rawText: i.rawText, totalPriceCents: i.totalPriceCents })),
              ocrZeilen
            )
          : null;
        if (sanitized.length > 0) {
          await tx.insert(receiptItems).values(
            sanitized.map((i) => ({
              receiptId,
              lineNo: i.lineNo,
              rawText: i.rawText,
              lineType: i.lineType,
              quantity: i.quantity,
              unit: i.unit,
              unitPriceCents: i.unitPriceCents,
              totalPriceCents: i.totalPriceCents,
              vatClass: i.vatClass,
              appliesToLine: i.appliesToLine,
              // null, wenn es keine Zeilen gab oder keine eindeutig passte — nie 0.
              ocrZeile: zuordnung?.get(i.lineNo) ?? null
            }))
          );
        }
        // Der Haendler ist die halbe Haelfte des Alias-Schluessels. Ohne ihn kann die
        // erste Stufe der Kategorie-Kaskade nie greifen.
        //
        // Bewusst NICHT ungeschuetzt (Review Task 1, Befund 1): oberstes Prinzip ist,
        // dass ein Bon niemals wegen eines einzelnen schlechten Feldes verworfen wird.
        // Wirft haendlerAufloesen (DB-Verbindungsaussetzer, Timeout, ...), wuerde das
        // ansonsten die GANZE Transaktion zurueckrollen — die bereits aufbereiteten
        // receiptItems, das receipts-Update und der extractionRuns-Insert waeren weg,
        // der Bon liefe als "failed" statt "review". Stattdessen faellt merchantId auf
        // null zurueck — denselben Wert, den "kein Name gelesen" ohnehin liefert; Stufe
        // 2 der Kategorie-Kaskade kommt ohne Haendler aus.
        let merchantId: string | null;
        try {
          merchantId = await haendlerAufloesen(result.merchantName);
        } catch (fehler) {
          merchantId = null;
          // Nur die sanitierte message, NIE das rohe Fehlerobjekt: ein Postgres-Fehler
          // kann Verbindungsdaten mitschleppen, und in dieses Projekt darf kein
          // Geheimnis in ein Log geraten. Die Meldung ist bewusst von "kein Name
          // gelesen" unterscheidbar — dort gibt es gar keinen Log-Eintrag.
          const meldung = fehler instanceof Error ? fehler.message : String(fehler);
          console.error(
            `[worker] Haendler-Aufloesung für Bon ${receiptId} fehlgeschlagen, merchantId bleibt null (Bon läuft trotzdem als "review" weiter): ${meldung}`
          );
        }

        await tx.update(receipts).set({
          merchantId,
          merchantNameRaw: result.merchantName,
          purchasedAt,
          totalGrossCents: result.totalGrossCents,
          currency: result.currency,
          paymentMethod: result.paymentMethod,
          needsReviewReason: gruende,
          vermutetesOriginalId,
          status: 'review',
          failureReason: null
        }).where(eq(receipts.id, receiptId));

        await tx.insert(extractionRuns).values({
          receiptId,
          provider: pid,
          kiAnbieterId: provider.kiAnbieterId ?? null,
          ...modellFelder(servedModel, model),
          // Die ROHE Antwort, nicht `result`: das Schema faltet Adressobjekte zu
          // Strings, schreibt Einheiten klein und ersetzt Unbekanntes durch
          // Rückfallwerte. Genau die Abweichung, die man später untersuchen will,
          // wäre in `result` schon wegnormalisiert — und Phase 7 vergliche Modelle
          // anhand einer bereits geglätteten Ausgabe.
          rawJson: raw,
          // Entwurf E5: der OCR-Text, aus dem `raw` entstand — null beim Bildweg
          // (openai-compat.ts hat keinen OCR-Schritt).
          ocrText,
          // Etappe 2: Engine, Version, Dauer und uebergebene Optionen des OCR-Laufs.
          // Bewusst getrennt von `durationMs` darunter — das ist die Dauer des
          // MODELLAUFRUFS. Beide in einer Spalte zu summieren machte den Vergleich
          // "welche Engine ist schneller" unmoeglich.
          ...ocrFelder(ocr),
          // Etappe 2 der Oberflaeche: die Zeilen mit Rahmen, aus denen ocrText besteht.
          ocrZeilen,
          durationMs,
          itemCount: result.items.length,
          sumMatch: !problems.includes('sum_mismatch'),
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          costMicroEuros: kostenAusTokens(usage, provider.preise ?? preiseAusEnv())
        });
      });
      // Kategorien NACH der Transaktion, nicht darin: der Modellaufruf dauert Sekunden,
      // und eine Transaktion, die so lange offen steht, haelt Verbindung und Sperren
      // fest. Der Bon ist hier bereits gespeichert und steht auf `review` — die
      // Kategorien kommen danach dazu.
      //
      // bonEinsortieren wirft nie: eine Kategorie ist wuenschenswert, ein Bon ist
      // unverzichtbar. Was schiefging, wird protokolliert, nicht geworfen.
      const eingeordnet = await bonEinsortieren(receiptId, echteModellDeps());
      if (eingeordnet.fehler) {
        console.error(`[worker] Kategorien für Bon ${receiptId}: ${eingeordnet.fehler}`);
      }
      if (eingeordnet.verworfen.length > 0) {
        // Erfundene Kategorien verschwinden nicht still — schlaegt das Modell dieselbe
        // immer wieder vor, gehoert sie vermutlich in den Baum (baum.ts).
        console.warn(
          `[worker] Bon ${receiptId}: Modell schlug unbekannte Kategorien vor: ${eingeordnet.verworfen.map((v) => v.slug).join(', ')}`
        );
      }
    },

    async markFailed(receiptId, reason, belege) {
      await db.update(receipts)
        .set({ status: 'failed', failureReason: reason.slice(0, 500) })
        .where(eq(receipts.id, receiptId));
      // provider.id/model aus dem Closure, nicht 'unknown': extraction_runs ist die
      // Grundlage für den Provider-Vergleich in Phase 7, und ein Fehlschlag ist
      // genau die Zeile, deren Provider-Zuordnung am meisten zählt — "welcher
      // Provider scheitert häufiger" ist die halbe Fragestellung.
      await db.insert(extractionRuns).values({
        receiptId,
        provider: provider.id,
        model: provider.model,
        kiAnbieterId: provider.kiAnbieterId ?? null,
        error: reason.slice(0, 500),
        // undefined würde Drizzle die Spalte weglassen lassen; null sagt ausdrücklich
        // "es gab keine Antwort" (Netzfehler, Zeitüberschreitung) und ist damit vom
        // Fall "Antwort da, aber unbrauchbar" unterscheidbar.
        rawJson: belege?.raw ?? null,
        // Entwurf E5: bei BonUnlesbarError (Bon als unlesbar markiert) ist dies der
        // einzige Beleg, was Tesseract geliefert hat — undefined/null gleichermassen
        // "es gab keinen (oder wir kennen ihn nicht)".
        ocrText: belege?.ocrText ?? null,
        // Etappe 2: bei BonUnlesbarError/OcrWerkzeugKaputtError steht hier, WELCHE
        // Engine den Bon nicht lesen konnte. Fehlt sie, bleiben alle vier Spalten
        // null (Bildweg oder ein Fehler vor/ohne OCR-Schritt).
        ...ocrFelder(belege?.ocr),
        ocrZeilen: belege?.ocrZeilen ?? null
      });
      // Aufgabe 4, Teil B: handleExtractJobs reicht einen dauerhaften (oder
      // erschöpften vorübergehenden) Fehler seit dieser Aufgabe NICHT mehr an
      // pg-boss durch (kein Retry mehr nötig, der Bon ist bereits terminal
      // markiert) — der bisherige Alarm in worker/index.ts feuert nur noch, wenn
      // handleExtractJobs tatsächlich wirft. Ohne einen eigenen Alarm HIER würde
      // genau der Fall verstummen, in dem er am wichtigsten ist: der Betreiber soll
      // erfahren, dass ein Bon soeben endgültig aufgegeben wurde, nicht nur, dass
      // irgendwo ein Zwischenversuch scheiterte.
      await notifyMatrix(
        `Bon-App: Bon ${receiptId} konnte nicht ausgelesen werden — ${reason.slice(0, 300)}`
      );
    },

    now: () => new Date(),

    async getRetryInfo(jobId) {
      const boss = await getBoss();
      const job = await boss.getJobById<ExtractJob>(QUEUE_EXTRACT, jobId);
      if (!job) {
        // Sollte praktisch nie vorkommen (der Job, der handleExtractJobs gerade
        // aufgerufen hat, existiert per Definition) — konservativ NICHT als letzten
        // Versuch werten: lieber ein Bon, der eine Runde länger auf 'extracting'
        // steht, als einer, der vorschnell (und womöglich fälschlich) aufgegeben wird,
        // nur weil diese Abfrage aus irgendeinem Grund leer zurückkam.
        console.error(
          `[worker] getJobById(${jobId}) lieferte keinen Job zurück — werte konservativ als "nicht letzter Versuch"`
        );
        return { retryCount: 0, retryLimit: Number.POSITIVE_INFINITY };
      }
      return { retryCount: job.retryCount, retryLimit: job.retryLimit };
    }
  };
}
