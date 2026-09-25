import { ExtractionSchemaError, ExtractionHttpError } from './types';
import { extractedReceiptSchema } from './schema';
import { SYSTEM_PROMPT } from './prompt';
import type { ExtractionProvider, ExtractionUsage } from './types';

// Reale Messung an einem 18-Positionen-Bon beim Cloud-Anbieter: HTTP 200 nach ~9.5s.
// Der Adapter traegt eine EIGENE Obergrenze, unabhaengig davon, ob der Aufrufer ein
// eigenes AbortSignal uebergibt — sonst blockiert ein haengender Anbieter einen
// Worker-Slot unbegrenzt.
//
// Seit 2026-09-15 ist sie einstellbar: ein Modell auf eigener Hardware braucht laenger
// als ein Rechenzentrum. Gemessen am Mac mini (Qwen3.5-9B): 36s warm, 58s kalt, weil
// das Modell erst geladen wird. Mit einer fest verdrahteten 30s-Schranke koennte die
// App ueberhaupt kein lokales Modell benutzen, egal wie gut es liest.
export const STANDARD_ZEITLIMIT_MS = 30_000;

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

// Ersetzt jedes Vorkommen von `secret` in `text` durch ein Platzhalter-Token. Nutzt dies,
// um den Abacus-API-Key aus einem Response-Body zu tilgen, BEVOR der Body irgendwo landet,
// wo ihn ein Mensch zu Gesicht bekommt (Server-Log). Siehe Task-9-Report, Punkt 1, zur
// Begründung, warum der rohe Body trotzdem nie in die geworfene Fehlermeldung selbst geht.
//
// EXPORTIERT seit Aufgabe 2: der Textweg-Anbieter (`ocr-text-provider.ts`) spricht mit
// derselben Art Endpunkt (OpenAI-kompatible /chat/completions) und braucht dieselbe
// Absicherung — ein zweites, unabhängig gepflegtes Redact würde genau die Art Drift
// riskieren, die diese Regel verhindern soll.
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

// Wandelt die Wire-Feldnamen (input_tokens/output_tokens) in camelCase um und liefert
// null, statt eine Zahl zu erfinden, sobald `usage` fehlt oder eines der beiden Felder
// fehlt/keine Zahl ist. Absichtlich kein "unknown -> 0"-Fallback: eine erfundene 0 würde
// behaupten, der Aufruf sei kostenlos gewesen — derselbe Fehler, den die "?? 0"-Fallbacks
// im Schema (Task 8) für echte Geldbeträge bewusst vermeiden.
// EXPORTIERT seit Aufgabe 2: derselbe Grund wie bei redactSecret oben — der
// Textweg-Anbieter meldet Token-Zahlen in derselben Wire-Form und soll dieselbe
// Toleranz gegenüber der Abacus- wie der mlx_vlm-Schreibweise erben, statt sie
// zweimal zu pflegen.
export function parseUsage(raw: unknown): ExtractionUsage {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // Zwei Schreibweisen im Umlauf: der Abacus-Proxy meldet input_tokens/output_tokens,
  // der Mac-mini-Server (mlx_vlm) die OpenAI-Namen prompt_tokens/completion_tokens.
  // Wer nur eine kennt, speichert beim anderen Anbieter still "unbekannt" — und der
  // Anbietervergleich in Phase 7 haette fuer eine Seite gar keine Zahlen.
  const ein = typeof o.input_tokens === 'number' ? o.input_tokens : o.prompt_tokens;
  const aus = typeof o.output_tokens === 'number' ? o.output_tokens : o.completion_tokens;
  if (typeof ein !== 'number' || typeof aus !== 'number') return null;
  return { inputTokens: ein, outputTokens: aus };
}

export function createOpenAiCompatProvider(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  id?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ExtractionProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    id: opts.id ?? 'openai-compat',
    model: opts.model,
    async extract(image, signal) {
      const dataUrl = `data:image/webp;base64,${image.toString('base64')}`;

      const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? STANDARD_ZEITLIMIT_MS);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      const response = await doFetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: combinedSignal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
          // Die Abacus-Edge-WAF blockt den Default-UA des OpenAI-SDK mit 403.
          'user-agent': 'bon-app/1.0'
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Lies diesen Kassenbon.' },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        // Der rohe Response-Body geht absichtlich NIE in die geworfene Fehlermeldung: diese
        // landet unverändert in extraction_runs.error (Task 5) und potenziell in einem
        // Matrix-Alert. Manche Provider-Fehlerantworten ("invalid api key: ...") oder
        // WAF-Fehlerseiten echoen Teile des Requests — inklusive Authorization-Header —
        // in den Body zurück. Für die Fehlersuche geht ein redigierter, gekürzter Body
        // stattdessen ins Server-Log; auch dort nie der API-Key selbst.
        const body = await response.text().catch(() => '');
        const safeBody = redactSecret(body, opts.apiKey).slice(0, 500);
        console.error(
          `[extraction] ${opts.id ?? 'openai-compat'}: HTTP ${response.status} von ${opts.baseUrl}/chat/completions`,
          safeBody
        );
        // ExtractionHttpError statt eines schlichten Error: Task 3 (Entwurf E7a)
        // unterscheidet 503/429 (Anbieter gerade beschäftigt, später erneut versuchen)
        // von jedem anderen Status (dauerhaft) — dafür muss der Status maschinenlesbar
        // am Fehlerobjekt hängen, nicht nur im Text.
        throw new ExtractionHttpError(
          response.status,
          `Extraktion fehlgeschlagen: LLM antwortete mit HTTP ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        model?: unknown;
        choices?: { message?: { content?: string } }[];
        usage?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('Extraktion fehlgeschlagen: LLM-Antwort ohne Inhalt');

      // Erst parsen, DANN validieren — mit der Rohantwort in der Hand. Wird beides
      // in einem Ausdruck erledigt, ist bei einer Ablehnung nicht mehr greifbar, was
      // das Modell geschickt hat.
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
      // Defensiv wie bei usage: ein Anbieter, der hier etwas anderes als einen
      // nichtleeren String liefert, soll null ergeben statt "[object Object]" in der
      // Datenbank. null heisst ehrlich "nicht gemeldet".
      const servedModel =
        typeof payload.model === 'string' && payload.model.trim() !== ''
          ? payload.model.trim()
          : null;
      // warnings: [] — dieser Anbieter korrigiert nichts an der Modellantwort (siehe
      // ExtractionResult.warnings). Nur der Textweg-Anbieter (Aufgabe 2) entfernt
      // gezielt eine unbelegte deposit-Zeile und meldet das dort.
      // ocrText: null — dieser Anbieter zeigt dem Modell das Bild direkt, es gibt
      // keinen OCR-Schritt, dessen Text man ablegen könnte (siehe ExtractionResult.ocrText).
      return {
        receipt: geprueft.data,
        usage: parseUsage(payload.usage),
        raw,
        servedModel,
        warnings: [],
        ocrText: null,
        // ocr: null aus demselben Grund wie ocrText — es lief keine OCR-Engine,
        // also gibt es auch keine Laufdaten. Nicht "unbekannt", sondern "keine".
        ocr: null,
        // ocrZeilen: null — keine OCR, keine Zeilen.
        ocrZeilen: null
      };
    }
  };
}
