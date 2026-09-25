import { createOpenAiCompatProvider, STANDARD_ZEITLIMIT_MS } from './openai-compat';
// Die Obergrenze gehoert zur Fristen-Ordnung und steht deshalb dort, nicht hier:
// das Zeitlimit MUSS vor pg-bosses Auftragsverfall greifen (siehe queue/fristen.ts).
import { MAX_ZEITLIMIT_MS } from '../queue/fristen';
import { createOcrTextProvider } from './ocr-text-provider';
import { ocrKonfigurationAusEnv, waehleOcrAnbieter } from '../ocr/konfiguration';
import type { ExecFileImpl } from '../ocr/lesen';
import type { OcrAnbieter } from '../ocr/anbieter';
import type { ExtractionProvider } from './types';
import { BildwegNichtFreigegeben } from '../ki/fehler';

export { STANDARD_ZEITLIMIT_MS };

const MIN_ZEITLIMIT_MS = 1_000;

/**
 * Liest EXTRACTION_TIMEOUT_MS — und wirft lieber, als still zurueckzufallen.
 *
 * Number('60s') ist NaN, Number('') ist 0. Wuerde die Funktion bei so etwas den
 * Standard nehmen, braeche jede Auslesung am lokalen Modell nach 30 Sekunden ab, und
 * niemand faende je den Tippfehler: die Meldung hiesse "Zeitueberschreitung", nicht
 * "deine Einstellung wurde nicht gelesen". Ein Rueckfallwert, den niemand bemerken
 * kann, ist selbst ein Defekt. NICHT gesetzt zu sein ist dagegen eine gueltige Aussage
 * und ergibt den Standard.
 *
 * Die Obergrenze verhindert, dass ein vertippter Wert einen Worker-Slot stundenlang
 * blockiert; die Untergrenze, dass ein zu kleiner Wert jede Auslesung scheitern laesst.
 */
export function zeitlimitAusEnv(wert: string | undefined): number {
	if (wert === undefined || wert.trim() === '') return STANDARD_ZEITLIMIT_MS;
	const n = Number(wert.trim());
	if (!Number.isInteger(n) || n < MIN_ZEITLIMIT_MS || n > MAX_ZEITLIMIT_MS) {
		throw new Error(
			`EXTRACTION_TIMEOUT_MS ist unbrauchbar: ${JSON.stringify(wert)}. ` +
				`Erwartet wird eine ganze Zahl in Millisekunden zwischen ${MIN_ZEITLIMIT_MS} und ${MAX_ZEITLIMIT_MS}.`
		);
	}
	return n;
}

/**
 * Der Bildweg schickt das Bon-FOTO an das Modell, der Textweg nur die ausgelesenen
 * Zeichen. Welcher laeuft, entscheidet EXTRACTION_PROVIDER — und der eingebaute
 * Standard ist der Bildweg. Faellt die Zeile weg (neu aufgesetzte .env, vergessene
 * Variable, kopiertes .env.example), ginge das Foto still hinaus. Ein Rueckfall, den
 * niemand bemerken kann, ist selbst ein Defekt; hier ist er ausserdem einer, der
 * Kassenbons aus dem Haus traegt. Also lieber gar nicht erst starten.
 *
 * Nur der genaue Wert "ja" zaehlt. "true", "1" und "yes" schreibt man aus Gewohnheit
 * hin, ohne gelesen zu haben, wozu — und wer das Foto herausgibt, soll es bewusst tun.
 */
export function bildwegIstBestaetigt(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXTRACTION_BILDWEG_BESTAETIGT === 'ja';
}

export type KiWeg = 'text' | 'bild';

/** Alles, was ein Anbieter zum Bauen braucht — aus der .env ODER aus ki_anbieter. */
export type ProviderKonfig = {
  weg: KiWeg;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

/** EXTRACTION_PROVIDER → Weg. Fehlt die Variable, bleibt es beim Bildweg (unveraenderte Voreinstellung). */
export function konfigAusEnv(env: NodeJS.ProcessEnv = process.env): ProviderKonfig {
  const kind = env.EXTRACTION_PROVIDER ?? 'openai-compat';
  const lies = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} ist nicht gesetzt`);
    return v;
  };
  const gemeinsam = {
    baseUrl: lies('EXTRACTION_BASE_URL'),
    apiKey: lies('EXTRACTION_API_KEY'),
    model: lies('EXTRACTION_MODEL'),
    timeoutMs: zeitlimitAusEnv(env.EXTRACTION_TIMEOUT_MS)
  };
  if (kind === 'openai-compat') return { ...gemeinsam, weg: 'bild' };
  if (kind === 'ocr-text') return { ...gemeinsam, weg: 'text' };
  throw new Error(`Unbekannter Extraktions-Provider: ${kind}`);
}

/**
 * Baut einen Anbieter. Hier — und nur hier — steht die Bildweg-Sperre: egal ob die
 * Konfiguration aus der .env oder aus der Oberflaeche kommt, ohne
 * EXTRACTION_BILDWEG_BESTAETIGT=ja verlaesst kein Foto den Server.
 *
 * `overrides.ocrAnbieter` gibt es fuer den Testknopf (fester Testbon-Text statt OCR) und
 * fuer Tests; im Betrieb bleibt es leer, und die OCR kommt aus der .env.
 */
export function baueProvider(
  k: ProviderKonfig,
  overrides?: { fetchImpl?: typeof fetch; execFileImpl?: ExecFileImpl; ocrAnbieter?: OcrAnbieter },
  env: NodeJS.ProcessEnv = process.env
): ExtractionProvider {
  const gemeinsam = { baseUrl: k.baseUrl, apiKey: k.apiKey, model: k.model, timeoutMs: k.timeoutMs };
  if (k.weg === 'bild') {
    if (!bildwegIstBestaetigt(env)) {
      throw new BildwegNichtFreigegeben(
        'Der Foto-Weg ist nicht freigegeben. Er wuerde das Bon-FOTO an ' +
          `${k.baseUrl} schicken. Auswege: einen Textweg-Anbieter aktivieren — in ` +
          '/betrieb/ki, bzw. ohne aktiven Anbieter EXTRACTION_PROVIDER=ocr-text in der .env ' +
          '(PaddleOCR liest lokal, nur der ausgelesene Text geht hinaus) — oder, wenn das ' +
          'Foto wirklich hinaus soll, EXTRACTION_BILDWEG_BESTAETIGT=ja in der .env setzen.'
      );
    }
    return createOpenAiCompatProvider({ ...gemeinsam, id: 'openai-compat', fetchImpl: overrides?.fetchImpl });
  }
  // Die OCR-Einstellung wird NUR fuer den Textweg gelesen — eine kaputte OCR-Einstellung
  // darf den Bildweg nicht aufhalten. Beide Leser werfen bei einem unbrauchbaren Wert.
  const ocr = ocrKonfigurationAusEnv(env);
  return createOcrTextProvider({
    ...gemeinsam,
    id: 'ocr-text',
    fetchImpl: overrides?.fetchImpl,
    ocrAnbieter:
      overrides?.ocrAnbieter ??
      waehleOcrAnbieter(ocr.engine, { execFileImpl: overrides?.execFileImpl, paddleUrl: ocr.paddleUrl }),
    mitBoxen: ocr.mitBoxen
  });
}

/**
 * Der reine .env-Weg: konfigAusEnv + baueProvider. Der Worker ruft ihn NICHT mehr auf —
 * er loest ueber ki/aktiv.ts auf (`aktuellerProvider`), das ohne aktiven Anbieter
 * dieselben beiden Schritte geht und beim Start ebenso laut scheitert. Geblieben ist er
 * fuer Tests (index.test.ts, golden.test.ts): `overrides` spritzt `fetchImpl` bzw.
 * `execFileImpl` ein, damit sie ohne echtes Netz und ohne echtes `tesseract` laufen.
 */
export function getProvider(overrides?: {
  fetchImpl?: typeof fetch;
  execFileImpl?: ExecFileImpl;
}): ExtractionProvider {
  return baueProvider(konfigAusEnv(), overrides);
}

export type { ExtractionProvider, ExtractionResult, ExtractionUsage } from './types';
