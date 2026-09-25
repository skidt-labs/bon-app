import { describe, it, expect, vi } from 'vitest';
import { createOpenAiCompatProvider } from './openai-compat';
import { ExtractionHttpError } from './types';

const answer = {
  merchantName: 'REWE', merchantAddress: null, purchasedAt: null,
  totalGrossCents: 109, currency: 'EUR', paymentMethod: null, vatSummary: [],
  items: [{ lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1',
            unit: 'stk', unitPriceCents: 109, totalPriceCents: 109,
            vatClass: 'A', appliesToLine: null }]
};

function fakeFetch(content: string) {
  // Expliziter Typparameter (statt Inferenz aus der 0-Parameter-Arrow-Funktion): sonst
  // typisiert vi.fn() `.mock.calls[0]` als leeres Tupel `[]`, und der User-Agent-Test unten
  // (`spy.mock.calls[0][1]!.headers`) scheitert an `svelte-check`, obwohl `vitest run` grün
  // ist. Siehe Task-9-Report zu dieser Abweichung vom wörtlichen Brief-Code.
  return vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ));
}

// Wie fakeFetch, aber mit einem frei wählbaren `usage`-Feld (oder ganz ohne), für die
// Token-Durchreiche-Tests unten.
function fakeFetchWithUsage(content: string, usage?: unknown) {
  const body: Record<string, unknown> = { choices: [{ message: { content } }] };
  if (usage !== undefined) body.usage = usage;
  return vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify(body),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ));
}

describe('createOpenAiCompatProvider', () => {
  it('gibt validierte Bondaten zurück', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetch(JSON.stringify(answer)) as unknown as typeof fetch
    });
    const { receipt } = await provider.extract(Buffer.from('x'));
    expect(receipt.items[0].rawText).toBe('MILCH');
  });

  // Dieser Anbieter korrigiert nichts an der Modellantwort (anders als der
  // Textweg-Anbieter aus Aufgabe 2, der eine unbelegte deposit-Zeile entfernen kann)
  // — warnings bleibt deshalb IMMER leer, nie fehlend.
  it('liefert immer leere warnings — dieser Anbieter korrigiert nichts', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetch(JSON.stringify(answer)) as unknown as typeof fetch
    });
    const { warnings } = await provider.extract(Buffer.from('x'));
    expect(warnings).toEqual([]);
  });

  // Entwurf E5: ocrText ist die Spur, was Tesseract gelesen hat. Dieser Anbieter
  // zeigt dem Modell das Bild direkt — es gibt keinen OCR-Schritt, also muss das
  // Ergebnis das ehrlich mit null sagen, statt eine Leerstelle zu erfinden.
  it('liefert ocrText als null — dieser Anbieter hat keinen OCR-Schritt', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetch(JSON.stringify(answer)) as unknown as typeof fetch
    });
    const { ocrText } = await provider.extract(Buffer.from('x'));
    expect(ocrText).toBeNull();
  });

  // Entwurf E7a: derselbe Fehlerstatus (503, gemessen am Mac) muss auch beim Bildweg
  // maschinenlesbar am Fehler hängen — Task 3 unterscheidet damit voruebergehende von
  // dauerhaften Fehlern, unabhaengig davon, welcher Anbieter lief.
  it('wirft ExtractionHttpError mit dem HTTP-Status bei einem Fehlerstatus', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response('Service Unavailable', { status: 503 })
      )
    });
    try {
      await provider.extract(Buffer.from('x'));
      expect.unreachable('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ExtractionHttpError);
      expect((fehler as ExtractionHttpError).status).toBe(503);
    }
  });

  it('setzt einen eigenen User-Agent (Abacus-WAF blockt den Default)', async () => {
    const spy = fakeFetch(JSON.stringify(answer));
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: spy as unknown as typeof fetch
    });
    await provider.extract(Buffer.from('x'));
    const headers = new Headers(spy.mock.calls[0][1]!.headers);
    expect(headers.get('user-agent')).toBe('bon-app/1.0');
  });

  it('schält einen Markdown-Codeblock ab', async () => {
    const wrapped = '```json\n' + JSON.stringify(answer) + '\n```';
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetch(wrapped) as unknown as typeof fetch
    });
    await expect(provider.extract(Buffer.from('x'))).resolves.toBeTruthy();
  });

  it('wirft, wenn das Modell Unsinn liefert', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetch('{"items": "keine Liste"}') as unknown as typeof fetch
    });
    await expect(provider.extract(Buffer.from('x'))).rejects.toThrow();
  });

  it('reicht die Token-Zahlen durch', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchWithUsage(JSON.stringify(answer), {
        input_tokens: 2356, output_tokens: 1993
      }) as unknown as typeof fetch
    });
    const { usage } = await provider.extract(Buffer.from('x'));
    expect(usage).toEqual({ inputTokens: 2356, outputTokens: 1993 });
  });

  it('liefert null statt erfundener Nullen, wenn der Anbieter nichts meldet', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchWithUsage(JSON.stringify(answer)) as unknown as typeof fetch
    });
    const { usage } = await provider.extract(Buffer.from('x'));
    expect(usage).toBeNull();
  });

  it('liefert null bei einem unbrauchbaren usage-Feld, statt zu werfen oder zu raten', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchWithUsage(JSON.stringify(answer), {
        input_tokens: 'viel', output_tokens: 1993
      }) as unknown as typeof fetch
    });
    const { usage } = await provider.extract(Buffer.from('x'));
    expect(usage).toBeNull();
  });

  // Ohne diesen Test verifizierte nur ein Reviewer per Hand (Task-9-Report), dass ein
  // von außen übergebenes AbortSignal tatsächlich am fetch-Aufruf ankommt. Task 11
  // verlässt sich direkt darauf (job.signal -> provider.extract), damit ein
  // ablaufender pg-boss-Job den hängenden HTTP-Request abbricht — ein Refactor, der
  // das Weiterreichen entfernt, ließe sonst nichts fehlschlagen außer der Produktion.
  it('reicht ein übergebenes AbortSignal an fetch weiter', async () => {
    const spy = fakeFetch(JSON.stringify(answer));
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: spy as unknown as typeof fetch
    });
    const controller = new AbortController();
    await provider.extract(Buffer.from('x'), controller.signal);
    const usedSignal = spy.mock.calls[0][1]!.signal as AbortSignal;
    expect(usedSignal).toBeInstanceOf(AbortSignal);
    // AbortSignal.any([...]) liefert ein NEUES, kombiniertes Signal zurück (nicht
    // dasselbe Objekt) — die eigentliche Probe ist daher Verhalten, nicht Identität:
    // ein Abort am übergebenen Signal muss das an fetch übergebene Signal mit abbrechen.
    expect(usedSignal.aborted).toBe(false);
    controller.abort(new Error('Job abgelaufen'));
    expect(usedSignal.aborted).toBe(true);
  });
});

// Der Abacus-Proxy laeuft auf RouteLLM und KOENNTE eine Anfrage umleiten. Am
// 2026-09-14 nachgemessen: er tut es nicht. Aber `extraction_runs.model` speicherte
// bisher den KONFIGURIERTEN Wert — eine stille Umleitung waere in den Daten
// unsichtbar, und der Cloud-gegen-Mac-Vergleich in Phase 7 verglich Aepfel mit Birnen.
describe('geliefertes Modell', () => {
  function providerMitAntwort(extra: Record<string, unknown>) {
    const body = { ...extra, choices: [{ message: { content: JSON.stringify(answer) } }] };
    return createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' }
      })) as unknown as typeof fetch
    });
  }

  it('fuehrt das gelieferte Modell mit', async () => {
    const { servedModel } = await providerMitAntwort({ model: 'gemini-3.6-flash' })
      .extract(Buffer.from('x'));
    expect(servedModel).toBe('gemini-3.6-flash');
  });

  it('liefert null, wenn der Anbieter keines meldet', async () => {
    const { servedModel } = await providerMitAntwort({}).extract(Buffer.from('x'));
    expect(servedModel).toBeNull();
  });

  // Defensiv wie bei usage: lieber ehrlich "nicht gemeldet" als "[object Object]"
  // oder ein leerer String in der Datenbank.
  it('liefert null bei unbrauchbaren Werten, statt sie zu uebernehmen', async () => {
    for (const kaputt of [{ model: '' }, { model: '   ' }, { model: 42 }, { model: { id: 'x' } }, { model: null }]) {
      const { servedModel } = await providerMitAntwort(kaputt).extract(Buffer.from('x'));
      expect(servedModel, JSON.stringify(kaputt)).toBeNull();
    }
  });

  it('schneidet Leerraum ab', async () => {
    const { servedModel } = await providerMitAntwort({ model: '  gemini-3.6-flash  ' })
      .extract(Buffer.from('x'));
    expect(servedModel).toBe('gemini-3.6-flash');
  });

  // Der Mac-mini-Server (mlx_vlm) meldet die Token-Zahlen in der OpenAI-Schreibweise
  // prompt_tokens/completion_tokens, der Abacus-Proxy in input_tokens/output_tokens.
  // Wer nur eine Schreibweise kennt, speichert beim anderen Anbieter still "unbekannt"
  // — und der Anbietervergleich in Phase 7 verglei­che dann Aepfel mit nichts.
  it('versteht auch die OpenAI-Schreibweise der Token-Zahlen', async () => {
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchWithUsage(JSON.stringify(answer), {
        prompt_tokens: 2030, completion_tokens: 821
      }) as unknown as typeof fetch
    });
    const { usage } = await provider.extract(Buffer.from('x'));
    expect(usage).toEqual({ inputTokens: 2030, outputTokens: 821 });
  });

  // Ein Modell auf eigener Hardware braucht laenger als ein Rechenzentrum: am
  // 2026-09-15 gemessen 36s warm und 58s kalt (das Modell wird erst geladen), gegen
  // 8,4s beim Cloud-Anbieter. Mit einer fest verdrahteten 30s-Schranke koennte die App
  // ueberhaupt kein lokales Modell benutzen, egal wie gut es liest.
  it('haelt sich an ein uebergebenes Zeitlimit', async () => {
    const haengt = ((_u: string, o: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        o.signal?.addEventListener('abort', () => rej(o.signal!.reason));
      })) as unknown as typeof fetch;
    const provider = createOpenAiCompatProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      timeoutMs: 25, fetchImpl: haengt
    });
    await expect(provider.extract(Buffer.from('x'))).rejects.toMatchObject({
      name: 'TimeoutError'
    });
  });
});
