import { describe, it, expect, vi, afterEach } from 'vitest';
import { zeitlimitAusEnv, STANDARD_ZEITLIMIT_MS, getProvider, baueProvider, konfigAusEnv } from './index';
import type { ExecFileImpl } from '../ocr/lesen';
import { BildwegNichtFreigegeben } from '$lib/server/ki/fehler';

describe('zeitlimitAusEnv', () => {
  it('nimmt den Standard, wenn nichts gesetzt ist', () => {
    expect(zeitlimitAusEnv(undefined)).toBe(STANDARD_ZEITLIMIT_MS);
    expect(zeitlimitAusEnv('')).toBe(STANDARD_ZEITLIMIT_MS);
    expect(zeitlimitAusEnv('   ')).toBe(STANDARD_ZEITLIMIT_MS);
  });

  it('nimmt einen gueltigen Wert', () => {
    expect(zeitlimitAusEnv('120000')).toBe(120000);
  });

  // Der Kern dieser Funktion. Number('60s') ist NaN, Number('') ist 0 — beides wuerde
  // bei einem stillen Rueckfall auf den Standard dazu fuehren, dass jede Auslesung am
  // lokalen Modell nach 30s abbricht und niemand den Tippfehler je findet. Ein
  // Rueckfallwert, den niemand bemerken kann, ist selbst ein Defekt: also lieber laut
  // scheitern, wenn jemand ausdruecklich etwas eingestellt hat.
  it('wirft bei einem unbrauchbaren Wert, statt still zurueckzufallen', () => {
    for (const murks of ['60s', 'abc', '0', '-1', '12.5', '500', '540001', '600000', '900000', 'NaN']) {
      expect(() => zeitlimitAusEnv(murks), murks).toThrow(/EXTRACTION_TIMEOUT_MS/);
    }
  });
});

// Aufgabe 3 ("Einhängen"): getProvider() muss den Textweg (Aufgaben 1/2) WÄHLBAR
// machen, ohne die Voreinstellung heimlich zu verschieben. Die beiden Antwortwege
// unterscheiden sich strukturell im Request-Inhalt (Bild-URL vs. OCR-Text) — das ist
// der zuverlässigste Beweis, WELCHER Anbieter tatsächlich lief, zuverlässiger als nur
// `provider.id` zu vergleichen (das würde auch bestehen, wenn getProvider() versehentlich
// immer denselben Fabrik-Aufruf träfe, aber mit `id: kind` durchgereicht).
describe('getProvider', () => {
  const antwort = {
    merchantName: 'REWE', merchantAddress: null, purchasedAt: null,
    totalGrossCents: 109, currency: 'EUR', paymentMethod: null, vatSummary: [],
    items: [{ lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1',
      unit: 'stk', unitPriceCents: 109, totalPriceCents: 109, vatClass: 'A', appliesToLine: null }]
  };

  function fakeFetchGibtBon() {
    return vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(antwort) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
  }

  function stubGemeinsameEnv() {
    vi.stubEnv('EXTRACTION_BASE_URL', 'https://example.test/v1');
    vi.stubEnv('EXTRACTION_API_KEY', 'k');
    vi.stubEnv('EXTRACTION_MODEL', 'm');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('waehlt ohne EXTRACTION_PROVIDER weiterhin den Bildweg — die Voreinstellung bleibt unveraendert', async () => {
    const original = process.env.EXTRACTION_PROVIDER;
    delete process.env.EXTRACTION_PROVIDER;
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_BILDWEG_BESTAETIGT', 'ja');
    try {
      const fetchImpl = fakeFetchGibtBon();
      const execFileImpl: ExecFileImpl = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const provider = getProvider({ fetchImpl, execFileImpl });
      await provider.extract(Buffer.from('bild'));
      // Kein OCR-Schritt beim Bildweg — der Beweis, dass wirklich der Bildweg lief,
      // nicht nur, dass provider.id zufaellig passt.
      expect(execFileImpl).not.toHaveBeenCalled();
      const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
      expect(JSON.stringify(body.messages[1].content)).toContain('image_url');
    } finally {
      if (original !== undefined) process.env.EXTRACTION_PROVIDER = original;
    }
  });

  it('waehlt den Textweg, wenn EXTRACTION_PROVIDER=ocr-text gesetzt ist', async () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'ocr-text');
    const fetchImpl = fakeFetchGibtBon();
    const ocrText = 'Supermarkt\nMilch 1,09 A\nZu zahlen 1,09\nDatum: 01.01.2026';
    const execFileImpl: ExecFileImpl = vi.fn(async () => ({ stdout: ocrText, stderr: '' }));
    const provider = getProvider({ fetchImpl, execFileImpl });
    await provider.extract(Buffer.from('bild'));
    // OCR lief tatsaechlich, und das Modell bekam Text, kein Bild.
    expect(execFileImpl).toHaveBeenCalled();
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.messages[1].content).toContain(ocrText);
    expect(JSON.stringify(body.messages[1].content)).not.toContain('image_url');
  });

  // Der Bildweg schickt das Bon-FOTO an das Modell, der Textweg nur die ausgelesenen
  // Zeichen. Welcher laeuft, hing an einer einzigen Zeile in der .env — und der
  // eingebaute Standard ist der Bildweg. Faellt die Zeile weg (neu aufgesetzte .env,
  // vergessene Variable, kopiertes .env.example), griffe er still. Genau dagegen
  // steht dieser Riegel: kein Bildweg ohne ausdrueckliche Bestaetigung.
  it('verweigert den Bildweg, wenn EXTRACTION_PROVIDER ganz fehlt', () => {
    const original = process.env.EXTRACTION_PROVIDER;
    delete process.env.EXTRACTION_PROVIDER;
    stubGemeinsameEnv();
    try {
      expect(() => getProvider()).toThrow(/EXTRACTION_BILDWEG_BESTAETIGT/);
    } finally {
      if (original !== undefined) process.env.EXTRACTION_PROVIDER = original;
    }
  });

  it('verweigert den Bildweg auch bei ausdruecklichem EXTRACTION_PROVIDER=openai-compat', () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'openai-compat');
    expect(() => getProvider()).toThrow(/EXTRACTION_BILDWEG_BESTAETIGT/);
  });

  // Die Meldung muss den Weg nach draussen nennen, sonst raet der Betreiber um 02:00.
  it('nennt in der Meldung beide Auswege', () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'openai-compat');
    expect(() => getProvider()).toThrow(/ocr-text/);
  });

  // "true", "1" und "yes" sind die Werte, die man aus Gewohnheit hinschreibt, ohne
  // gelesen zu haben, wozu. Wer das Foto aus dem Haus gibt, soll es bewusst tun.
  it('akzeptiert nur ja — nicht true, 1 oder yes', () => {
    for (const fast of ['true', '1', 'yes', 'JA ', '']) {
      stubGemeinsameEnv();
      vi.stubEnv('EXTRACTION_PROVIDER', 'openai-compat');
      vi.stubEnv('EXTRACTION_BILDWEG_BESTAETIGT', fast);
      expect(() => getProvider(), fast).toThrow(/EXTRACTION_BILDWEG_BESTAETIGT/);
      vi.unstubAllEnvs();
    }
  });

  it('laesst den Bildweg zu, wenn er ausdruecklich bestaetigt ist', async () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'openai-compat');
    vi.stubEnv('EXTRACTION_BILDWEG_BESTAETIGT', 'ja');
    const fetchImpl = fakeFetchGibtBon();
    const provider = getProvider({ fetchImpl });
    await provider.extract(Buffer.from('bild'));
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(JSON.stringify(body.messages[1].content)).toContain('image_url');
  });

  // Der Riegel darf nur den Bildweg betreffen. Wuerde er auch den Textweg blockieren,
  // stuende der Betrieb still, obwohl gar kein Bild das Haus verlaesst.
  it('laesst den Textweg ohne jede Bestaetigung laufen', () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'ocr-text');
    expect(() => getProvider()).not.toThrow();
  });

  it('wirft bei einem unbekannten Provider', () => {
    stubGemeinsameEnv();
    vi.stubEnv('EXTRACTION_PROVIDER', 'irgendwas');
    expect(() => getProvider()).toThrow(/Unbekannter Extraktions-Provider/);
  });
});

describe('getProvider und die OCR-Engine', () => {
	const gesichert = { ...process.env };
	afterEach(() => {
		process.env = { ...gesichert };
	});

	function umgebung(extra: Record<string, string | undefined>) {
		process.env = {
			...gesichert,
			EXTRACTION_PROVIDER: 'ocr-text',
			EXTRACTION_BASE_URL: 'https://beispiel.test/v1',
			EXTRACTION_API_KEY: 'geheim',
			EXTRACTION_MODEL: 'modell',
			...extra
		} as NodeJS.ProcessEnv;
	}

	it('baut den Textweg ohne gesetzte OCR-Engine klaglos auf', () => {
		umgebung({ OCR_PROVIDER: undefined });
		expect(() => getProvider()).not.toThrow();
	});

	// Der Kern, seit Etappe 3 in der anderen Richtung: wer paddleocr einstellt, MUSS
	// PaddleOCR bekommen. Ein stiller Rueckfall auf Tesseract hiesse, dass der Betreiber
	// eine Engine misst und eine andere bekommt — unsichtbar in den Daten.
	it('baut den Textweg mit paddleocr auf, ohne auf Tesseract zurueckzufallen', () => {
		umgebung({ OCR_PROVIDER: 'paddleocr' });
		expect(() => getProvider()).not.toThrow();
	});

	it('scheitert beim Start bei einer unbrauchbaren OCR_PADDLE_URL', () => {
		umgebung({ OCR_PROVIDER: 'paddleocr', OCR_PADDLE_URL: 'bon-paddleocr:8000' });
		expect(() => getProvider()).toThrow(/OCR_PADDLE_URL/);
	});

	it('scheitert beim Start bei einer unbekannten OCR-Engine', () => {
		umgebung({ OCR_PROVIDER: 'tesserakt' });
		expect(() => getProvider()).toThrow(/OCR_PROVIDER/);
	});

	it('scheitert beim Start bei einem unbrauchbaren OCR_INCLUDE_BOXES', () => {
		umgebung({ OCR_INCLUDE_BOXES: 'ja' });
		expect(() => getProvider()).toThrow(/OCR_INCLUDE_BOXES/);
	});

	// Der Bildweg liest kein OCR — eine kaputte OCR-Einstellung darf ihn nicht aufhalten.
	// Die Bestaetigung steht hier nur, damit dieser Test weiterhin die OCR-Einstellung
	// prueft und nicht versehentlich den Bildweg-Riegel: sonst bestuende er aus dem
	// falschen Grund.
	it('laesst den Bildweg von der OCR-Einstellung unberuehrt', () => {
		umgebung({
			EXTRACTION_PROVIDER: 'openai-compat',
			EXTRACTION_BILDWEG_BESTAETIGT: 'ja',
			OCR_PROVIDER: 'paddleocr'
		});
		expect(() => getProvider()).not.toThrow();
	});
});

describe('baueProvider — aus einer ausdruecklichen Konfiguration', () => {
	const k = { baseUrl: 'http://m.invalid/v1', apiKey: '', model: 'm', timeoutMs: 30_000 };

	it('baut den Textweg mit der Anbieter-ID ocr-text', () => {
		const p = baueProvider({ ...k, weg: 'text' }, undefined, {} as NodeJS.ProcessEnv);
		expect(p.id).toBe('ocr-text');
		expect(p.model).toBe('m');
	});

	it('verweigert den Bildweg ohne Freigabe — mit eigener Fehlerklasse', () => {
		expect(() => baueProvider({ ...k, weg: 'bild' }, undefined, {} as NodeJS.ProcessEnv)).toThrow(
			BildwegNichtFreigegeben
		);
	});

	it('baut den Bildweg mit Freigabe', () => {
		const p = baueProvider({ ...k, weg: 'bild' }, undefined, {
			EXTRACTION_BILDWEG_BESTAETIGT: 'ja'
		} as NodeJS.ProcessEnv);
		expect(p.id).toBe('openai-compat');
	});
});

describe('konfigAusEnv', () => {
	it('uebersetzt EXTRACTION_PROVIDER in den Weg', () => {
		const env = {
			EXTRACTION_PROVIDER: 'ocr-text',
			EXTRACTION_BASE_URL: 'http://m.invalid/v1',
			EXTRACTION_API_KEY: 'x',
			EXTRACTION_MODEL: 'm'
		} as NodeJS.ProcessEnv;
		expect(konfigAusEnv(env)).toMatchObject({ weg: 'text', model: 'm', timeoutMs: 30_000 });
	});
	it('bleibt ohne EXTRACTION_PROVIDER beim Bildweg — die Voreinstellung aendert sich nicht', () => {
		const env = { EXTRACTION_BASE_URL: 'u', EXTRACTION_API_KEY: 'x', EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv;
		expect(konfigAusEnv(env).weg).toBe('bild');
	});
	it('wirft bei einem unbekannten Provider', () => {
		const env = { EXTRACTION_PROVIDER: 'murks', EXTRACTION_BASE_URL: 'u', EXTRACTION_API_KEY: 'x', EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv;
		expect(() => konfigAusEnv(env)).toThrow(/Unbekannter Extraktions-Provider/);
	});
});
