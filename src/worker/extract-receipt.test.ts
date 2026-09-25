import { describe, it, expect, vi } from 'vitest';
import { ExtractionSchemaError, ExtractionHttpError, ExtractionTruncatedError } from '$lib/server/extraction/types';
import { BonUnlesbarError, OcrWerkzeugKaputtError } from '$lib/server/extraction/ocr-text-provider';
import { BildwegNichtFreigegeben, KiSchluesselUnlesbar } from '$lib/server/ki/fehler';
import {
  handleExtractJobs,
  kostenAusTokens,
  sanitizeItemsForInsert,
  assertBatchSizeOne,
  istVoruebergehenderFehler,
  istLetzterErlaubterVersuch,
  type SaveArgs,
  type FehlerBelege,
  modellFelder,
  ocrFelder
} from './extract-receipt';

// vatSummary NICHT leer lassen (abweichend vom Brief-Beispiel): checkPlausibility
// (Task 10, bereits reviewed) meldet vat_missing für jeden Bon mit mindestens einer
// Artikelzeile, aber ohne MwSt-Block — das Brief-Beispiel mit `vatSummary: []` hätte
// also NIE eine leere Beanstandungsliste erzeugt, egal wie handleExtractJobs
// implementiert ist. Siehe Task-11-Report, Abschnitt "Abweichungen vom Brief".
const extracted = {
  merchantName: 'REWE', merchantAddress: null, purchasedAt: '2026-09-13T17:42:00+02:00',
  totalGrossCents: 109, currency: 'EUR', paymentMethod: null,
  vatSummary: [{ rate: 19, netCents: 92, taxCents: 17, grossCents: 109 }],
  items: [{ lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1', unit: 'stk',
            unitPriceCents: 109, totalPriceCents: 109, vatClass: 'A', appliesToLine: null }]
};

// Aufgabe 3: ExtractionResult trägt seit Aufgabe 2/3 zusätzlich `warnings` (Pflicht,
// niemals fehlend) und `ocrText`. Ein zentraler Helfer statt an jeder Stelle beide
// Felder von Hand zu ergänzen — dieselbe Lücke hätte sonst an mehreren Stellen
// einzeln gestopft werden müssen (siehe Task-2-Report zu production-deps.test.ts).
function extraktionsErgebnis(receipt: unknown, over: Record<string, unknown> = {}) {
  return { receipt, usage: null, raw: undefined, servedModel: null, warnings: [], ocrText: null, ocr: null, ocrZeilen: null, ...over };
}

function deps(over = {}) {
  return {
    loadImage: vi.fn(async () => Buffer.from('bild')),
    provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => extraktionsErgebnis(extracted)) },
    // Expliziter Typparameter (statt Inferenz aus der 0-Parameter-Arrow-Funktion): sonst
    // typisiert vi.fn() `.mock.calls[0]` als leeres Tupel, und die Auswertungen unten
    // (`saveResult.mock.calls[0][0]`) scheitern an svelte-check, obwohl vitest run grün
    // ist. Dieselbe Falle wie im openai-compat-Test (Task-9-Report).
    saveResult: vi.fn<(args: SaveArgs) => Promise<void>>(async () => {}),
    // Derselbe Grund für den expliziten Typparameter wie bei saveResult oben —
    // hier zusätzlich wichtig, weil Tests weiter unten `markFailed.mock.calls[0]`
    // per Array-Destrukturierung auf den zweiten Parameter (den Grund) zugreifen.
    markFailed: vi.fn<
      (receiptId: string, reason: string, belege?: FehlerBelege) => Promise<void>
    >(async () => {}),
    now: () => new Date('2026-09-13T20:00:00Z'),
    // Aufgabe 4, Teil B: Voreinstellung "noch nicht ausgeschöpft" (1 von 3 möglichen
    // Wiederholungen verbraucht) — das bestehende Verhalten (vorübergehender Fehler
    // bleibt in der Warteschlange) bleibt damit für alle Tests unverändert, die
    // getRetryInfo nicht selbst überschreiben. Tests zum ausgeschöpften Budget
    // (weiter unten) überschreiben das gezielt.
    getRetryInfo: vi.fn(async () => ({ retryCount: 0, retryLimit: 3 })),
    ...over
  };
}

const job = (receiptId: string) => ({
  id: 'j1', name: 'extract-receipt', data: { receiptId },
  expireInSeconds: 300, heartbeatSeconds: null, signal: new AbortController().signal
});

describe('handleExtractJobs', () => {
  it('verarbeitet jeden Job im Stapel', async () => {
    const d = deps();
    await handleExtractJobs([job('r1'), job('r2')] as never, d as never);
    expect(d.saveResult).toHaveBeenCalledTimes(2);
  });

  it('reicht das Ergebnis mit leerer Beanstandungsliste weiter', async () => {
    const d = deps();
    await handleExtractJobs([job('r1')] as never, d as never);
    const call = d.saveResult.mock.calls[0][0];
    expect(call.receiptId).toBe('r1');
    expect(call.problems).toEqual([]);
    expect(call.result.items).toHaveLength(1);
  });

  it('meldet Summenabweichungen, verbucht den Bon aber trotzdem', async () => {
    const wrong = { ...extracted, totalGrossCents: 999 };
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => extraktionsErgebnis(wrong)) }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.saveResult.mock.calls[0][0].problems).toContain('sum_mismatch');
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  // Aufgabe 4, Teil B: seit dieser Aufgabe reicht ein DAUERHAFTER Fehler, dessen
  // markFailed erfolgreich durchläuft, NICHT mehr an pg-boss durch (der Bon ist
  // bereits terminal markiert, ein weiterer Antritt wäre sinnlos verschwendet —
  // siehe Kommentar bei handleExtractJobs und queue/boss.ts). Vor dieser Aufgabe
  // (Task 3) warf handleExtractJobs hier noch, was ein vervierfachtes retryLimit
  // (Teil B, Punkt 1) dazu gebracht hätte, GENAU diesen dauerhaften Fehler
  // unnötig oft zu wiederholen — das ist der geänderte Teil dieses Tests.
  it('markiert den Bon als gescheitert, wenn der Provider wirft, OHNE pg-boss zur Wiederholung zu zwingen', async () => {
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => { throw new Error('LLM kaputt'); }) }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).resolves.toBeUndefined();
    // Die Belege: Modellantwort, OCR-Text, OCR-Laufdaten. Ein gewoehnlicher Fehler
    // (kein ExtractionSchemaError, kein BonUnlesbarError) hat keine — undefined
    // heisst "es gab nie eine".
    expect(d.markFailed).toHaveBeenCalledWith('r1', expect.stringContaining('LLM kaputt'), {
      raw: undefined,
      ocrText: undefined,
      ocr: undefined
    });
  });

  it('lässt einen fehlgeschlagenen Job den Stapel nicht abbrechen', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('erster kaputt'))
      .mockResolvedValueOnce(extraktionsErgebnis(extracted));
    const d = deps({ provider: { id: 'test', model: 'test-1', extract } });
    // Job 1 ist ein DAUERHAFTER Fehler und wird über markFailed terminal markiert —
    // der Stapel wirft deshalb nicht mehr (siehe Test oben); Job 2 muss trotzdem
    // verarbeitet worden sein.
    await expect(handleExtractJobs([job('r1'), job('r2')] as never, d as never)).resolves.toBeUndefined();
    expect(d.markFailed).toHaveBeenCalledTimes(1);
    expect(d.saveResult).toHaveBeenCalledTimes(1);
    expect(d.saveResult.mock.calls[0][0].receiptId).toBe('r2');
  });

  it('reicht job.signal an provider.extract weiter', async () => {
    const controller = new AbortController();
    const extract = vi.fn(async () => extraktionsErgebnis(extracted));
    const d = deps({ provider: { id: 'test', model: 'test-1', extract } });
    const j = { ...job('r1'), signal: controller.signal };
    await handleExtractJobs([j] as never, d as never);
    expect(extract).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });

  // F3(a) aus der Review-Runde 1: die kompensierende markFailed-Schreibung darf
  // den Stapel nicht abbrechen, wenn sie selbst wirft (z. B. dieselbe DB-Störung,
  // die schon die Extraktion hat scheitern lassen) — Job 2 muss trotzdem
  // versucht werden, und der Stapel muss am Ende trotzdem werfen, damit pg-boss
  // ihn erneut anläuft.
  //
  // Aufgabe 4, Teil B: der Stapel wirft jetzt mit der markFailed-eigenen
  // Fehlermeldung ("DB down"), NICHT mehr mit der ursprünglichen ("erster
  // kaputt") — seit dieser Aufgabe wird der ursprüngliche Fehler nur noch dann
  // an pg-boss weitergereicht, wenn die terminale Markierung (markFailed)
  // SELBST fehlschlägt; genau das ist hier der Fall, und die Meldung, die pg-boss
  // zum Wiederholen bewegt, ist jetzt ehrlich die, die den Bon tatsächlich noch
  // in der Schwebe hält (die DB-Schreibung ist nicht durchgelaufen), nicht die,
  // die bereits (erfolglos) versucht und geloggt wurde.
  it('lässt einen Job weiterlaufen, dessen markFailed selbst wirft', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('erster kaputt'))
      .mockResolvedValueOnce(extraktionsErgebnis(extracted));
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract },
      markFailed: vi.fn(async () => { throw new Error('DB down'); })
    });
    await expect(handleExtractJobs([job('r1'), job('r2')] as never, d as never)).rejects.toThrow('DB down');
    expect(d.markFailed).toHaveBeenCalledTimes(1);
    expect(d.saveResult).toHaveBeenCalledTimes(1);
    expect(d.saveResult.mock.calls[0][0].receiptId).toBe('r2');
  });

  // Aufgabenstellung Punkt 3: `warnings` (Entwurf E7, Aufgabe 2) war bisher nur
  // Transportweg — niemand sah sie. needsReviewReason (problems) ist der bestehende,
  // tatsächlich sichtbare Weg.
  it('mischt die warnings des Anbieters in die Beanstandungsliste (sichtbar machen)', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () =>
          extraktionsErgebnis(extracted, { warnings: ['Position 4 ("Pfand") entfernt: kein Beleg im OCR-Text.'] })
        )
      }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.saveResult.mock.calls[0][0].problems).toContain(
      'Position 4 ("Pfand") entfernt: kein Beleg im OCR-Text.'
    );
  });

  // Entwurf E5: der OCR-Text muss bis zu saveResult durchgereicht werden, damit Task 3
  // ihn in extraction_runs.ocr_text ablegen kann.
  it('reicht ocrText an saveResult weiter', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => extraktionsErgebnis(extracted, { ocrText: 'Milch 1,09\nZu zahlen 1,09' }))
      }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.saveResult.mock.calls[0][0].ocrText).toBe('Milch 1,09\nZu zahlen 1,09');
  });

  // Etappe 2 der Oberflaeche: die Zeilen muessen bis zu saveResult, damit sie in
  // extraction_runs.ocr_zeilen landen und jede Position ihre Zeile bekommt.
  it('reicht ocrZeilen an saveResult weiter', async () => {
    const zeilen = [{ text: 'MILCH 1,09 A', box: [10, 20, 100, 14] as [number, number, number, number], confidence: 90 }];
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => extraktionsErgebnis(extracted, { ocrZeilen: zeilen }))
      }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.saveResult.mock.calls[0][0].ocrZeilen).toEqual(zeilen);
  });

  it('reicht die Zeilen eines unlesbaren Bons an markFailed weiter', async () => {
    const zeilen = [{ text: 'L$DL', box: [0, 0, 10, 10] as [number, number, number, number], confidence: 12 }];
    const fehler = new BonUnlesbarError(
      'L$DL kauderwelsch',
      { brauchbar: false, hatSummenzeile: false, anzahlBetraege: 0, hatDatum: false, ueberhangGroessterBetrag: null },
      null,
      zeilen
    );
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => { throw fehler; }) }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.markFailed.mock.calls[0][2]?.ocrZeilen).toEqual(zeilen);
  });
});

// Entwurf E7a: 503/429/Zeitüberlauf/Verbindungsabbruch sind "später nochmal", kein
// "kaputt" — siehe die ausführliche Begründung am Code (istVoruebergehenderFehler).
describe('istVoruebergehenderFehler', () => {
  it('erkennt HTTP 503 und 429 als vorübergehend', () => {
    expect(istVoruebergehenderFehler(new ExtractionHttpError(503, 'HTTP 503'))).toBe(true);
    expect(istVoruebergehenderFehler(new ExtractionHttpError(429, 'HTTP 429'))).toBe(true);
  });

  it('behandelt jeden anderen HTTP-Status als dauerhaft', () => {
    expect(istVoruebergehenderFehler(new ExtractionHttpError(400, 'HTTP 400'))).toBe(false);
    expect(istVoruebergehenderFehler(new ExtractionHttpError(500, 'HTTP 500'))).toBe(false);
  });

  it('erkennt einen echten Netzwerkfehler (TypeError von fetch) als vorübergehend', () => {
    expect(istVoruebergehenderFehler(new TypeError('fetch failed'))).toBe(true);
  });

  // Gegenprobe: ein GEWÖHNLICHER Error mit demselben Text ist KEIN Netzwerkfehler —
  // sonst würde der bestehende Test "reicht undefined durch, wenn es gar keine
  // Antwort gab" (der genau diesen Text für einen ANDEREN Zweck nutzt) versehentlich
  // umklassifiziert.
  it('behandelt einen gewöhnlichen Error mit demselben Text als dauerhaft', () => {
    expect(istVoruebergehenderFehler(new Error('fetch failed'))).toBe(false);
  });

  it('erkennt eine Zeitüberschreitung (DOMException TimeoutError) als vorübergehend', () => {
    expect(istVoruebergehenderFehler(new DOMException('Zeit um', 'TimeoutError'))).toBe(true);
  });

  it('erkennt einen externen Abbruch (DOMException AbortError) als vorübergehend', () => {
    expect(istVoruebergehenderFehler(new DOMException('abgebrochen', 'AbortError'))).toBe(true);
  });

  it('behandelt Schema-/Unlesbar-/Werkzeugfehler als dauerhaft', () => {
    expect(istVoruebergehenderFehler(new ExtractionSchemaError('x', {}))).toBe(false);
    expect(istVoruebergehenderFehler(new Error('irgendwas'))).toBe(false);
  });
});

// Entwurf E7a: der Kern der Aufgabe — ein vorübergehender Fehler darf den Bon NICHT
// auf 'failed' setzen. Der Bon bleibt in der Warteschlange (pg-boss retryLimit/retryDelay,
// siehe queue/boss.ts); der Stapel wirft trotzdem, damit pg-boss den Job erneut anlegt.
describe('handleExtractJobs — vorübergehende vs. dauerhafte Fehler (Entwurf E7a)', () => {
  it('markiert den Bon NICHT als gescheitert, wenn der Anbieter mit HTTP 503 antwortet', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionHttpError(503, 'HTTP 503'); })
      }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).rejects.toThrow();
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  it('markiert den Bon NICHT als gescheitert bei einem Verbindungsfehler (TypeError von fetch)', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new TypeError('fetch failed'); })
      }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).rejects.toThrow();
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  it('markiert den Bon NICHT als gescheitert bei einer Zeitüberschreitung', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new DOMException('Zeit um', 'TimeoutError'); })
      }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).rejects.toThrow();
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  // Gegenprobe: ein DAUERHAFTER Fehler (z. B. HTTP 500) markiert weiterhin wie bisher
  // — seit Aufgabe 4, Teil B zwingt eine ERFOLGREICHE Markierung pg-boss aber nicht
  // mehr zu einem weiteren Antritt (siehe Kommentar bei handleExtractJobs).
  it('markiert den Bon weiterhin als gescheitert bei einem dauerhaften HTTP-Fehler (z. B. 500), OHNE einen pg-boss-Retry zu erzwingen', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionHttpError(500, 'HTTP 500'); })
      }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).resolves.toBeUndefined();
    expect(d.markFailed).toHaveBeenCalledTimes(1);
  });

  // Ein zweiter Job im selben Stapel darf durch einen vorübergehenden Fehler des
  // ersten nicht mitgerissen werden — dasselbe Prinzip wie beim dauerhaften Fehler.
  it('lässt einen zweiten Job trotz eines vorübergehenden Fehlers im ersten weiterlaufen', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new ExtractionHttpError(503, 'HTTP 503'))
      .mockResolvedValueOnce(extraktionsErgebnis(extracted));
    const d = deps({ provider: { id: 'test', model: 'test-1', extract } });
    await expect(handleExtractJobs([job('r1'), job('r2')] as never, d as never)).rejects.toThrow();
    expect(d.markFailed).not.toHaveBeenCalled();
    expect(d.saveResult).toHaveBeenCalledTimes(1);
    expect(d.saveResult.mock.calls[0][0].receiptId).toBe('r2');
  });

  // Entwurf E5: BonUnlesbarError ist ein DAUERHAFTER Fehler (Bild/Text unlesbar) —
  // der OCR-Text muss dabei trotzdem bei markFailed ankommen (einziger Beleg, WAS
  // Tesseract geliefert hat).
  it('reicht den OCR-Text an markFailed weiter, wenn der Bon als unlesbar markiert wird', async () => {
    const fehler = new BonUnlesbarError('L$DL kauderwelsch', {
      // ueberhangGroessterBetrag ist null, weil Kauderwelsch gar keinen Betrag enthaelt
      // — die Leerstelle, nicht die Zahl 0 (siehe qualitaet.ts).
      brauchbar: false, hatSummenzeile: false, anzahlBetraege: 0, hatDatum: false,
      ueberhangGroessterBetrag: null
    });
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => { throw fehler; }) }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).resolves.toBeUndefined();
    expect(d.markFailed).toHaveBeenCalledWith('r1', expect.any(String), {
      raw: undefined,
      ocrText: 'L$DL kauderwelsch',
      ocr: null,
      ocrZeilen: null
    });
  });

  // Etappe 2: bei einem unlesbaren Bon ist die Engine-Angabe am wichtigsten — genau
  // diese Zeilen beantworten spaeter "welche Engine faellt haeufiger durch die
  // Qualitaetspruefung". Sie duerfen nicht im Fehlerobjekt steckenbleiben.
  it('reicht die OCR-Laufdaten an markFailed weiter, wenn der Bon als unlesbar markiert wird', async () => {
    const lauf = {
      engine: 'tesseract' as const,
      durationMs: 812,
      options: { sprache: 'deu', psm: 6, mitBoxen: false }
    };
    const fehler = new BonUnlesbarError(
      'L$DL kauderwelsch',
      { brauchbar: false, hatSummenzeile: false, anzahlBetraege: 0, hatDatum: false,
        ueberhangGroessterBetrag: null },
      lauf
    );
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => { throw fehler; }) }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.markFailed.mock.calls[0][2]?.ocr).toEqual(lauf);
  });

  // Derselbe Grund fuer den anderen OCR-Fehler: "wie lange lief es, bevor es
  // schieflief" laesst sich nachtraeglich nicht mehr beantworten.
  it('reicht die OCR-Laufdaten an markFailed weiter, wenn das Werkzeug kaputt ist', async () => {
    const lauf = {
      engine: 'tesseract' as const,
      durationMs: 20_000,
      options: { sprache: 'deu', psm: 6, mitBoxen: false }
    };
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new OcrWerkzeugKaputtError('Zeitlimit', lauf); })
      }
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(d.markFailed.mock.calls[0][2]?.ocr).toEqual(lauf);
  });

  // Korrektur des Koordinators (2026-09-15): eine bei max_tokens abgeschnittene
  // Antwort (finish_reason "length") ist DAUERHAFT — ein Retry bricht bei
  // gleichem max_tokens deterministisch wieder ab (siehe ExtractionTruncatedError).
  // Etappe 3: seit eine OCR-Engine ein eigener Container ist, kann das WERKZEUG
  // voruebergehend ausfallen. Tesseract meldet das nie (ein fehlendes Programm
  // repariert sich nicht von selbst) — sein Verhalten bleibt unveraendert dauerhaft.
  it('folgt der Einschaetzung des OCR-Werkzeugs, ob ein neuer Versuch Aussicht hat', () => {
    expect(istVoruebergehenderFehler(new OcrWerkzeugKaputtError('Dienst startet', null, true))).toBe(true);
    expect(istVoruebergehenderFehler(new OcrWerkzeugKaputtError('nicht installiert'))).toBe(false);
  });

  it('behandelt eine abgeschnittene Modellantwort (ExtractionTruncatedError) als dauerhaft', () => {
    expect(istVoruebergehenderFehler(new ExtractionTruncatedError('abgeschnitten', '{"a":'))).toBe(false);
  });

  it('reicht die abgeschnittene Rohantwort an markFailed weiter', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionTruncatedError('abgeschnitten', '{"merchantName":"REWE"'); })
      }
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).resolves.toBeUndefined();
    expect(d.markFailed).toHaveBeenCalledWith('r1', expect.any(String), {
      raw: '{"merchantName":"REWE"',
      ocrText: undefined,
      ocr: undefined
    });
  });
});

// Aufgabenstellung, Teil B, Punkt 2 — der wichtigste Test dieser Aufgabe: OHNE
// diese Änderung bleibt ein Bon, dessen Wiederholungsbudget ausgeschöpft ist,
// für immer auf 'extracting' ("wird ausgelesen") stehen, weil handleExtractJobs
// einen vorübergehenden Fehler VOR dieser Aufgabe unter KEINEN Umständen
// markFailed aufrufen liess. Dieser Test ist daher am unveränderten Code (vor
// Aufgabe 4) ROT: `getRetryInfo` existierte nicht, und `markFailed` wurde für
// einen vorübergehenden Fehler nie aufgerufen, gleich wie oft schon versucht.
describe('handleExtractJobs — ausgeschöpftes Wiederholungsbudget (Aufgabenstellung, Teil B)', () => {
  it('markiert den Bon NICHT als gescheitert, solange noch ein Antritt aussteht', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionHttpError(503, 'HTTP 503'); })
      },
      // Zwei von drei erlaubten Wiederholungen verbraucht — pg-boss würde diesen
      // Job also noch mindestens einmal erneut anlegen.
      getRetryInfo: vi.fn(async () => ({ retryCount: 2, retryLimit: 3 }))
    });
    await expect(handleExtractJobs([job('r1')] as never, d as never)).rejects.toThrow();
    expect(d.markFailed).not.toHaveBeenCalled();
  });

  // Der Kernbeweis: nach dem LETZTEN von pg-boss erlaubten Antritt (retryCount ===
  // retryLimit) darf der Bon NICHT mehr auf 'extracting' stehen bleiben — er MUSS
  // über markFailed einen sichtbaren, unterscheidbaren Zustand bekommen.
  it('markiert den Bon als gescheitert, wenn der letzte erlaubte Antritt ebenfalls vorübergehend scheitert', async () => {
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionHttpError(503, 'HTTP 503'); })
      },
      getRetryInfo: vi.fn(async () => ({ retryCount: 3, retryLimit: 3 }))
    });
    // Terminal behandelt (siehe die "dauerhaft"-Tests oben) — kein weiterer
    // pg-boss-Antritt nötig, der Stapel wirft deshalb nicht mehr.
    await expect(handleExtractJobs([job('r1')] as never, d as never)).resolves.toBeUndefined();
    expect(d.markFailed).toHaveBeenCalledTimes(1);
    const [, reason] = d.markFailed.mock.calls[0];
    // MUSS von "der Bon ist unlesbar" (BonUnlesbarError) unterscheidbar sein — der
    // Nutzer muss erkennen können, WAS los war: hier war das MODELL nicht
    // erreichbar, nicht der BON unlesbar.
    expect(reason).toMatch(/nicht erreichbar/i);
    expect(reason).not.toMatch(/unlesbar/i);
  });

  it('nutzt getRetryInfo mit der Job-Id, nicht mit der Bon-Id', async () => {
    const getRetryInfo = vi.fn(async () => ({ retryCount: 3, retryLimit: 3 }));
    const d = deps({
      provider: {
        id: 'test', model: 'test-1',
        extract: vi.fn(async () => { throw new ExtractionHttpError(503, 'HTTP 503'); })
      },
      getRetryInfo
    });
    const j = { ...job('r1'), id: 'pgboss-job-42' };
    await handleExtractJobs([j] as never, d as never);
    expect(getRetryInfo).toHaveBeenCalledWith('pgboss-job-42');
  });

  // Gegenprobe: getRetryInfo wird für einen DAUERHAFTEN Fehler gar nicht erst
  // gebraucht (der Bon wird ohnehin sofort markiert) — ein überflüssiger
  // DB-Roundtrip wäre reine Verschwendung.
  it('ruft getRetryInfo NICHT auf, wenn der Fehler von Anfang an dauerhaft ist', async () => {
    const getRetryInfo = vi.fn(async () => ({ retryCount: 0, retryLimit: 3 }));
    const d = deps({
      provider: { id: 'test', model: 'test-1', extract: vi.fn(async () => { throw new Error('kaputt'); }) },
      getRetryInfo
    });
    await handleExtractJobs([job('r1')] as never, d as never);
    expect(getRetryInfo).not.toHaveBeenCalled();
  });
});

describe('istLetzterErlaubterVersuch', () => {
  it('ist falsch, solange retryCount unter retryLimit liegt', () => {
    expect(istLetzterErlaubterVersuch({ retryCount: 0, retryLimit: 3 })).toBe(false);
    expect(istLetzterErlaubterVersuch({ retryCount: 2, retryLimit: 3 })).toBe(false);
  });

  it('ist wahr, sobald retryCount retryLimit erreicht', () => {
    expect(istLetzterErlaubterVersuch({ retryCount: 3, retryLimit: 3 })).toBe(true);
  });
});

describe('sanitizeItemsForInsert', () => {
  const base = {
    rawText: 'x', lineType: 'article' as const, quantity: null, unit: null,
    unitPriceCents: 100, totalPriceCents: 100, vatClass: null
  };

  it('lässt eindeutige lineNo-Werte unangetastet', () => {
    const items = [
      { ...base, lineNo: 1, appliesToLine: null },
      { ...base, lineNo: 2, appliesToLine: null }
    ];
    expect(sanitizeItemsForInsert(items).map((i) => i.lineNo)).toEqual([1, 2]);
  });

  it('behält die Nummer der ERSTEN Zeile und nummeriert spätere Duplikate auf die nächste freie Nummer um', () => {
    const items = [
      { ...base, lineNo: 1, rawText: 'zuerst', appliesToLine: null },
      { ...base, lineNo: 1, rawText: 'duplikat', appliesToLine: null },
      { ...base, lineNo: 2, rawText: 'zweite', appliesToLine: null }
    ];
    const out = sanitizeItemsForInsert(items);
    expect(out.map((i) => i.lineNo)).toEqual([1, 3, 2]); // 3 = max(1,1,2)+1, frei
    expect(out.map((i) => i.rawText)).toEqual(['zuerst', 'duplikat', 'zweite']); // rawText unverändert
    // Alle finalen lineNo-Werte sind paarweise verschieden (Unique-Constraint hielte).
    expect(new Set(out.map((i) => i.lineNo)).size).toBe(out.length);
  });

  it('führt einen appliesToLine-Bezug auf eine umnummerierte, eindeutige Zeile mit', () => {
    const items = [
      { ...base, lineNo: 5, rawText: 'Artikel', appliesToLine: null },
      { ...base, lineNo: 5, rawText: 'Duplikat-Artikel', appliesToLine: null },
      { ...base, lineNo: 6, rawText: 'Rabatt', appliesToLine: 6 }
    ];
    // lineNo 6 kommt nur einmal vor (eindeutig) -> Bezug bleibt auflösbar, auch
    // wenn ANDERE Zeilen umnummeriert wurden.
    const out = sanitizeItemsForInsert(items);
    const rabatt = out.find((i) => i.rawText === 'Rabatt')!;
    expect(rabatt.appliesToLine).toBe(6);
  });

  it('setzt appliesToLine auf null, wenn die referenzierte lineNo selbst mehrfach vergeben war (nicht mehr feststellbar, welche gemeint ist)', () => {
    const items = [
      { ...base, lineNo: 12, rawText: 'Artikel A', appliesToLine: null },
      { ...base, lineNo: 12, rawText: 'Artikel B', appliesToLine: null },
      { ...base, lineNo: 13, rawText: 'Rabatt', appliesToLine: 12 }
    ];
    const out = sanitizeItemsForInsert(items);
    const rabatt = out.find((i) => i.rawText === 'Rabatt')!;
    expect(rabatt.appliesToLine).toBeNull();
  });

  it('lässt einen bereits unauflösbaren Bezug (Ziel existiert gar nicht) weiter auf null', () => {
    const items = [{ ...base, lineNo: 1, appliesToLine: 99 }];
    expect(sanitizeItemsForInsert(items)[0].appliesToLine).toBeNull();
  });

  it('liefert eine leere Liste für eine leere Liste', () => {
    expect(sanitizeItemsForInsert([])).toEqual([]);
  });
});

describe('assertBatchSizeOne', () => {
  it('wirft bei einem anderen Wert als 1', () => {
    expect(() => assertBatchSizeOne(2)).toThrow(/batchSize/);
    expect(() => assertBatchSizeOne(0)).toThrow();
  });
  it('lässt batchSize 1 unbeanstandet durch', () => {
    expect(() => assertBatchSizeOne(1)).not.toThrow();
  });
});

describe('kostenAusTokens', () => {
  it('liefert null, wenn keine Preise konfiguriert sind', () => {
    delete process.env.EXTRACTION_PRICE_IN_MICRO;
    delete process.env.EXTRACTION_PRICE_OUT_MICRO;
    expect(kostenAusTokens({ inputTokens: 1000, outputTokens: 100 })).toBeNull();
  });
  it('rechnet Kosten aus Token und Preisen', () => {
    process.env.EXTRACTION_PRICE_IN_MICRO = '1380000';   // 1,38 EUR je Mio. Token
    process.env.EXTRACTION_PRICE_OUT_MICRO = '6900000';
    // 2356 * 1,38 + 1993 * 6,90 je Mio. = 3251 + 13752 = 17003 Mikro-Euro
    expect(kostenAusTokens({ inputTokens: 2356, outputTokens: 1993 })).toBe(17003);
    delete process.env.EXTRACTION_PRICE_IN_MICRO;
    delete process.env.EXTRACTION_PRICE_OUT_MICRO;
  });
  it('liefert null ohne usage', () => {
    expect(kostenAusTokens(null)).toBeNull();
  });
});

// Beweissicherung: Wird ein Bon abgelehnt, muss festgehalten werden, WAS das Modell
// geschrieben hat. Ohne das bleibt nur "passt nicht zum Schema" — und genau diese
// Blindheit hat die wiederkehrende Typ-/null-Fehlerklasse siebenmal teuer gemacht:
// dass das Modell `lines` statt `items` schrieb, kam nur durch eine Handprobe ans
// Licht, nie aus den gespeicherten Daten.
// Die einzige Stelle, an der Laufdaten zu Datenbankspalten werden — beide Schreibwege
// gehen hier durch. Deshalb eigene Tests: eine Abweichung hier waere in beiden
// Schreibwegen gleichzeitig da und faellt im Vergleich nicht als Unstimmigkeit auf.
describe('ocrFelder', () => {
  it('bildet die Laufdaten auf die vier Spalten ab', () => {
    expect(
      ocrFelder({ engine: 'tesseract', durationMs: 812, options: { psm: 6 } })
    ).toEqual({
      ocrEngine: 'tesseract',
      ocrEngineVersion: null,
      ocrDurationMs: 812,
      ocrOptions: { psm: 6 }
    });
  });

  it('uebernimmt eine gemeldete Version, statt sie zu verschlucken', () => {
    expect(
      ocrFelder({ engine: 'paddleocr', engineVersion: '2.9.1', durationMs: 5, options: {} })
        .ocrEngineVersion
    ).toBe('2.9.1');
  });

  // Ohne OCR bleiben alle vier leer. Besonders ocr_duration_ms: eine 0 dort waere eine
  // Behauptung ueber einen Lauf, den es nie gab — und jeder Mittelwert ueber die Spalte
  // waere still nach unten gezogen, ohne dass es jemand bemerken koennte.
  it('laesst alle vier Spalten null, wenn keine OCR lief', () => {
    for (const ohne of [null, undefined]) {
      expect(ocrFelder(ohne), String(ohne)).toEqual({
        ocrEngine: null,
        ocrEngineVersion: null,
        ocrDurationMs: null,
        ocrOptions: null
      });
    }
  });
});

describe('Rohantwort im Fehlerfall', () => {
  const jobs = [{ data: { receiptId: 'r1' }, signal: undefined }] as never;

  function deps(fehler: unknown) {
    const markFailed = vi.fn(async () => {});
    return {
      markFailed,
      d: {
        loadImage: async () => Buffer.from('x'),
        provider: {
          id: 'p', model: 'm',
          extract: async () => { throw fehler; }
        },
        saveResult: async () => {},
        markFailed,
        now: () => new Date('2026-03-16T12:00:00Z')
      } as never
    };
  }

  // Aufgabe 4, Teil B: eine erfolgreiche markFailed-Schreibung lässt den Stapel
  // nicht mehr werfen (terminal behandelt, siehe Kommentar bei handleExtractJobs)
  // — vor dieser Aufgabe (Task 3) warf handleExtractJobs hier noch.
  it('reicht die Modellantwort durch, wenn das Schema sie ablehnt', async () => {
    const antwort = { merchantName: 'LIDL', lines: [{ lineNo: 1 }] };
    const { markFailed, d } = deps(new ExtractionSchemaError('items: erwartet Array', antwort));
    await expect(handleExtractJobs(jobs, d)).resolves.toBeUndefined();
    expect(markFailed).toHaveBeenCalledWith('r1', 'items: erwartet Array', {
      raw: antwort,
      ocrText: undefined,
      ocr: undefined
    });
  });

  // Ein GEWÖHNLICHER `Error('fetch failed')` (kein `TypeError`!) bleibt ein
  // dauerhafter Fehler — Aufgabe 3 unterscheidet über den Fehler-TYP
  // (`istVoruebergehenderFehler`), nicht über den Text. Ein echter Netzwerkfehler
  // von `fetch` selbst ist ein `TypeError`, siehe die eigene Beschreibung weiter unten.
  it('reicht undefined durch, wenn es gar keine Antwort gab', async () => {
    const { markFailed, d } = deps(new Error('fetch failed'));
    await expect(handleExtractJobs(jobs, d)).resolves.toBeUndefined();
    expect(markFailed).toHaveBeenCalledWith('r1', 'fetch failed', {
      raw: undefined,
      ocrText: undefined,
      ocr: undefined
    });
  });
});

describe('modellFelder', () => {
  it('nimmt das gelieferte Modell und vermerkt keine Abweichung, wenn beide gleich sind', () => {
    expect(modellFelder('gemini-3.6-flash', 'gemini-3.6-flash')).toEqual({
      model: 'gemini-3.6-flash',
      requestedModel: null
    });
  });

  // Der Fall, für den es die Spalte gibt: der Proxy hat still umgeleitet.
  it('haelt beide Werte fest, wenn der Anbieter etwas anderes geliefert hat', () => {
    expect(modellFelder('gpt-5.6-mini', 'gemini-3.6-flash')).toEqual({
      model: 'gpt-5.6-mini',
      requestedModel: 'gemini-3.6-flash'
    });
  });

  // Kein Modell gemeldet heisst NICHT "umgeleitet" — es heisst "unbekannt". Eine
  // Abweichung zu behaupten, die wir nicht belegen koennen, waere eine Erfindung.
  it('faellt auf den konfigurierten Wert zurueck, wenn nichts gemeldet wurde', () => {
    expect(modellFelder(null, 'gemini-3.6-flash')).toEqual({
      model: 'gemini-3.6-flash',
      requestedModel: null
    });
  });
});

describe('kostenAusTokens mit den gemessenen Preisen', () => {
  // $0,75 / $3,75 je Mio. Token, umgerechnet mit 0,92 USD/EUR (Stand 2026-09-14).
  const preise = { EXTRACTION_PRICE_IN_MICRO: '690000', EXTRACTION_PRICE_OUT_MICRO: '3450000' };

  it('ergibt fuer einen echten Bon rund 0,9 Cent', () => {
    vi.stubEnv('EXTRACTION_PRICE_IN_MICRO', preise.EXTRACTION_PRICE_IN_MICRO);
    vi.stubEnv('EXTRACTION_PRICE_OUT_MICRO', preise.EXTRACTION_PRICE_OUT_MICRO);
    try {
      // 2356 Eingabe- + 1998 Ausgabe-Token, gemessen am Lidl-Bon.
      expect(kostenAusTokens({ inputTokens: 2356, outputTokens: 1998 })).toBe(8519);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Der Unterschied, auf den es ankommt: eine LEERE Variable ist eine Leerstelle,
  // eine ausdrueckliche "0" ist eine Angabe. Ein kostenloses Modell darf 0 kosten.
  it('nimmt eine ausdrueckliche 0 als gueltigen Preis an', () => {
    vi.stubEnv('EXTRACTION_PRICE_IN_MICRO', '0');
    vi.stubEnv('EXTRACTION_PRICE_OUT_MICRO', '0');
    try {
      expect(kostenAusTokens({ inputTokens: 2356, outputTokens: 1998 })).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Fehlende Preise duerfen nicht als "kostenlos" in der Datenbank landen.
  it('bleibt null, wenn die Preise nicht gesetzt sind', () => {
    vi.stubEnv('EXTRACTION_PRICE_IN_MICRO', '');
    vi.stubEnv('EXTRACTION_PRICE_OUT_MICRO', '');
    try {
      expect(kostenAusTokens({ inputTokens: 100, outputTokens: 100 })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Konfigurationsfehler sind voruebergehend', () => {
  // Der Bon ist nicht schuld. Repariert der Betreiber die Einstellung, laeuft er beim
  // naechsten Versuch durch; erst ein erschoepftes Budget markiert ihn.
  it('stuft BildwegNichtFreigegeben und KiSchluesselUnlesbar als voruebergehend ein', () => {
    expect(istVoruebergehenderFehler(new BildwegNichtFreigegeben('x'))).toBe(true);
    expect(istVoruebergehenderFehler(new KiSchluesselUnlesbar('x'))).toBe(true);
  });
});

describe('kostenAusTokens mit uebergebenen Preisen', () => {
  it('rechnet mit den Preisen des Anbieters, nicht mit der .env', () => {
    vi.stubEnv('EXTRACTION_PRICE_IN_MICRO', '999999999');
    vi.stubEnv('EXTRACTION_PRICE_OUT_MICRO', '999999999');
    try {
      expect(kostenAusTokens({ inputTokens: 2356, outputTokens: 1998 }, { einMicro: 690000, ausMicro: 3450000 })).toBe(8519);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('bleibt null, wenn ein Preis des Anbieters unbekannt ist', () => {
    expect(kostenAusTokens({ inputTokens: 1, outputTokens: 1 }, { einMicro: 1, ausMicro: null })).toBeNull();
  });
  it('nimmt eine ausdrueckliche 0 als Preis', () => {
    expect(kostenAusTokens({ inputTokens: 5, outputTokens: 5 }, { einMicro: 0, ausMicro: 0 })).toBe(0);
  });
});
