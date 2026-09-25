import { describe, it, expect, vi } from 'vitest';
import {
  createOcrTextProvider,
  BonUnlesbarError,
  OcrWerkzeugKaputtError,
  MAX_TOKENS_STRUKTURIERT
} from './ocr-text-provider';
import { ExtractionHttpError, ExtractionTruncatedError } from './types';
import { bonResponseJsonSchema } from './schema';
import type { ExecFileImpl } from '../ocr/lesen';

// Derselbe Kauderwelsch-Text wie in qualitaet.test.ts / Task-1-Vorlagen — 0 Beträge,
// keine Summenzeile, kein Datum. Muss bei JEDER Prüfung durchfallen.
const KAUDERWELSCH = 'L$DL\nA,\nAAl\n3 A\nmin ö eten 9 äreen\nE\n| Aa';

const LESBARER_TEXT = [
  'Supermarkt Musterstadt',
  'Milch 1,29 A',
  'Brot 2,49 A',
  'Zu zahlen 3,78',
  'Datum: 01.01.2026 12:00'
].join('\n');

// Nachgebaute Kurzfassung des bekannten Restfehlers (siehe Entwurf E7 /
// ocr-prompt-zusatz.ts): eine echte Pfandrückgabe über -1,00 EUR mit eigener
// Stückzahl-Zeile darunter.
const TEXT_MIT_PFANDRUECKGABE = [
  'Supermarkt Musterstadt',
  'Milch 1,29 A',
  'Pfandrückgabe -1,00 B',
  '-4 x 0,25',
  'Zu zahlen 0,29',
  'Datum: 01.01.2026 12:00'
].join('\n');

// Ein Bon mit einem ECHTEN, positiv gedruckten Pfand-Aufschlag ("PFAND 0,25") — hier
// darf die deposit-Zeile NICHT entfernt werden.
const TEXT_MIT_ECHTEM_PFAND = [
  'Supermarkt Musterstadt',
  'Milch 1,29 A',
  'PFAND 0,25 A',
  'Zu zahlen 1,54',
  'Datum: 01.01.2026 12:00'
].join('\n');

function execFileImplMitText(text: string): ExecFileImpl {
  return async () => ({ stdout: text, stderr: '' });
}

function execFileImplMitAufgezeichnetemStdin(
  text: string,
  aufzeichnung: { stdin?: Buffer }
): ExecFileImpl {
  return async (_file, _args, _options, stdin) => {
    aufzeichnung.stdin = stdin;
    return { stdout: text, stderr: '' };
  };
}

function enoentFehler(): NodeJS.ErrnoException {
  const fehler: NodeJS.ErrnoException = new Error('spawn tesseract ENOENT');
  fehler.code = 'ENOENT';
  return fehler;
}

function execFileImplWerkzeugKaputt(): ExecFileImpl {
  return async () => {
    throw enoentFehler();
  };
}

function basisAntwort(items: Record<string, unknown>[]) {
  return {
    merchantName: 'Supermarkt Musterstadt',
    merchantAddress: null,
    purchasedAt: null,
    totalGrossCents: 378,
    currency: 'EUR',
    paymentMethod: null,
    vatSummary: [],
    items
  };
}

const ZWEI_ARTIKEL = [
  { lineNo: 1, rawText: 'Milch', lineType: 'article', quantity: '1', unit: 'stk',
    unitPriceCents: 129, totalPriceCents: 129, vatClass: 'A', appliesToLine: null },
  { lineNo: 2, rawText: 'Brot', lineType: 'article', quantity: '1', unit: 'stk',
    unitPriceCents: 249, totalPriceCents: 249, vatClass: 'A', appliesToLine: null }
];

function fakeFetchGibt(content: string) {
  // Expliziter Typparameter (dasselbe Muster wie in openai-compat.test.ts) — sonst
  // typisiert vi.fn() `.mock.calls[0]` als leeres Tupel und `svelte-check` scheitert
  // an den Zugriffen weiter unten, obwohl `vitest run` grün wäre.
  return vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ));
}

describe('createOcrTextProvider', () => {
  // Die wichtigste Zusicherung der ganzen Aufgabe: Kauderwelsch darf NIE beim Modell
  // landen. Bewiesen über die Aufrufzahl des Fetch-Doubles, nicht nur über den
  // geworfenen Fehlertyp — ein Test, der nur den Fehler prüft, würde einen
  // zusätzlichen (verschwendeten) Modellaufruf VOR dem Werfen nicht bemerken.
  it('ruft das Modell NICHT auf, wenn der OCR-Text Kauderwelsch ist', async () => {
    const fetchImpl = fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL)));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(KAUDERWELSCH)
    });

    await expect(provider.extract(Buffer.from('bild'))).rejects.toBeInstanceOf(BonUnlesbarError);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it('BonUnlesbarError trägt den OCR-Text und das Qualitätsurteil', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt('{}') as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(KAUDERWELSCH)
    });

    try {
      await provider.extract(Buffer.from('bild'));
      expect.unreachable('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(BonUnlesbarError);
      const e = fehler as BonUnlesbarError;
      expect(e.ocrText).toBe(KAUDERWELSCH);
      expect(e.qualitaet.brauchbar).toBe(false);
    }
  });

  it('ruft das Modell genau einmal auf und schickt den OCR-Text mit, wenn der Text lesbar ist', async () => {
    const fetchImpl = fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL)));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    const { receipt } = await provider.extract(Buffer.from('bild'));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain(LESBARER_TEXT);
    const systemMessage = body.messages.find((m: { role: string }) => m.role === 'system');
    // Der Zusatz muss tatsächlich mitgeschickt werden — sonst testet dieser Fall
    // nichts anderes als den Bildweg mit vertauschtem Inhalt.
    expect(systemMessage.content).toContain('DIESER TEXT STAMMT AUS EINER TEXTERKENNUNG');
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items[0].rawText).toBe('Milch');
  });

  // Aufgabe 4, Teil A: ECHT erzwungene JSON-Ausgabe (llguidance-Grammatik) statt
  // nur eines Prompt-Hinweises — response_format.json_schema, abgeleitet aus
  // unserem Zod-Schema (schema.ts), plus das laut Messung PFLICHTIGE max_tokens
  // (ohne sie greift serverseitig 2048, ein entgleistes Modell verbrennt sie
  // vollständig). Ohne diesen Test könnte man NICHT erkennen, ob response_format
  // tatsächlich ankam — der Mac-Server schluckt unbekannte/falsch benannte Felder
  // stillschweigend (siehe Task-4-Auftrag) — deshalb hier direkt am gesendeten
  // Request-Body geprüft, nicht am Ausbleiben eines Fehlers.
  it('schickt response_format.json_schema (aus dem Zod-Schema abgeleitet) und max_tokens mit', async () => {
    const fetchImpl = fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL)));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    await provider.extract(Buffer.from('bild'));

    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.max_tokens).toBe(MAX_TOKENS_STRUKTURIERT);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'bon', schema: bonResponseJsonSchema, strict: true }
    });
  });

  // Korrektur des Koordinators (2026-09-15): ein 24-Positionen-Bon brach bei
  // max_tokens: 1200 nachweislich mitten im JSON ab (finish_reason "length"). Ohne
  // eine eigene Behandlung liefe das entweder als roher JSON.parse-SyntaxError oder
  // als ExtractionSchemaError ("passt nicht zum Schema") durch — beides sieht wie
  // ein Modell-/Bonproblem aus, obwohl ein Retry deterministisch wieder abbricht.
  it('erkennt eine abgeschnittene Antwort (finish_reason "length") als ExtractionTruncatedError, NICHT als Schema-/Parse-Fehler', async () => {
    // Absichtlich mitten in einem String abgeschnitten — ein gewöhnlicher
    // JSON.parse würde hier mit "Unterminated string" scheitern.
    const abgeschnitten = '{"merchantName": "REWE", "items": [{"lineNo": 1, "rawText": "Mil';
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        choices: [{ message: { content: abgeschnitten }, finish_reason: 'length' }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    try {
      await provider.extract(Buffer.from('bild'));
      expect.unreachable('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ExtractionTruncatedError);
      expect((fehler as ExtractionTruncatedError).message).toContain('abgeschnitten');
      expect((fehler as ExtractionTruncatedError).message).not.toContain('Unterminated');
      expect((fehler as ExtractionTruncatedError).raw).toBe(abgeschnitten);
    }
  });

  it('lässt eine vollständige Antwort mit finish_reason "stop" unangetastet durch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(basisAntwort(ZWEI_ARTIKEL)) }, finish_reason: 'stop' }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    const { receipt } = await provider.extract(Buffer.from('bild'));
    expect(receipt.items).toHaveLength(2);
  });

  // Entwurf E5: der OCR-Text ist der einzige Beleg, was tatsächlich gelesen wurde.
  // Task 3 legt ihn in extraction_runs.ocr_text ab — dafür muss er hier im
  // Rückgabewert ankommen, nicht nur intern verwendet werden.
  it('liefert den OCR-Text im Ergebnis mit (Entwurf E5)', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    const { ocrText } = await provider.extract(Buffer.from('bild'));
    expect(ocrText).toBe(LESBARER_TEXT);
  });

  // Etappe 2: ohne diese Angaben laesst sich spaeter nicht sagen, WELCHE Engine einen
  // Bon gelesen hat — und damit auch kein Vergleich zwischen Tesseract und PaddleOCR
  // fuehren, was der ganze Zweck der Abstraktion ist.
  it('liefert die OCR-Laufdaten im Ergebnis mit — Engine, Dauer und uebergebene Optionen', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    const { ocr } = await provider.extract(Buffer.from('bild'));

    expect(ocr?.engine).toBe('tesseract');
    expect(ocr?.durationMs).toBeGreaterThanOrEqual(0);
    expect(ocr?.options).toEqual({ sprache: 'deu', psm: 6, mitBoxen: false });
  });

  it('reicht den Bild-Puffer unverändert an ocrLesen/Tesseract durch', async () => {
    const aufzeichnung: { stdin?: Buffer } = {};
    const bild = Buffer.from('echte-webp-bytes');
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitAufgezeichnetemStdin(LESBARER_TEXT, aufzeichnung)
    });

    await provider.extract(bild);

    expect(aufzeichnung.stdin).toBe(bild);
  });

  it('wirft ExtractionSchemaError mit der Rohantwort in der Hand, wenn das Modell nicht zum Schema passt', async () => {
    const kaputteAntwort = { items: 'keine Liste' };
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(kaputteAntwort)) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    await expect(provider.extract(Buffer.from('bild'))).rejects.toMatchObject({
      name: 'ExtractionSchemaError',
      raw: kaputteAntwort
    });
  });

  // Entwurf E7a, gemessen am 2026-09-15: zwei Anfragen kurz hintereinander an den Mac
  // lieferten HTTP 503. Task 3 muss das von einem dauerhaften Fehler unterscheiden
  // können — dafür muss der Status maschinenlesbar am Fehler hängen.
  it('wirft ExtractionHttpError mit dem HTTP-Status, wenn der Anbieter mit einem Fehlerstatus antwortet (Entwurf E7a)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('Service Unavailable', { status: 503 })
    );
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    try {
      await provider.extract(Buffer.from('bild'));
      expect.unreachable('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ExtractionHttpError);
      expect((fehler as ExtractionHttpError).status).toBe(503);
    }
  });

  it('unterscheidet ein kaputtes Werkzeug (Tesseract fehlt) von einem unlesbaren Bon', async () => {
    const fetchImpl = fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL)));
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execFileImpl: execFileImplWerkzeugKaputt()
    });

    await expect(provider.extract(Buffer.from('bild'))).rejects.toBeInstanceOf(OcrWerkzeugKaputtError);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it('OcrWerkzeugKaputtError ist KEIN BonUnlesbarError und umgekehrt', async () => {
    const werkzeugProvider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchGibt('{}') as unknown as typeof fetch,
      execFileImpl: execFileImplWerkzeugKaputt()
    });
    const unlesbarProvider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
      fetchImpl: fakeFetchGibt('{}') as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(KAUDERWELSCH)
    });

    await expect(werkzeugProvider.extract(Buffer.from('x'))).rejects.not.toBeInstanceOf(
      BonUnlesbarError
    );
    await expect(unlesbarProvider.extract(Buffer.from('x'))).rejects.not.toBeInstanceOf(
      OcrWerkzeugKaputtError
    );
  });
});

// Der bekannte Restfehler aus Entwurf E7: eine erfundene `deposit`-Zeile ohne Beleg im
// OCR-Text. Erst eine Prompt-Runde versucht, das über den Text abzustellen (siehe
// ocr-prompt-zusatz.ts, OCR_PROMPT_ZUSATZ_PFAND_KORREKTUR — UNVERIFIZIERT gegen das
// echte Modell, siehe Task-2-Bericht); diese Tests sichern die Code-Regel ab, die
// unabhängig davon greift.
describe('createOcrTextProvider — Code-Regel gegen die erfundene deposit-Zeile', () => {
  it('entfernt eine deposit-Zeile ohne positiven Beleg im OCR-Text und meldet das über warnings', async () => {
    const items = [
      ...ZWEI_ARTIKEL,
      { lineNo: 3, rawText: 'Pfandrückgabe', lineType: 'deposit_return', quantity: '4',
        unit: 'stk', unitPriceCents: 25, totalPriceCents: -100, vatClass: 'B', appliesToLine: null },
      // Die erfundene Zeile: +1,00 EUR "deposit", obwohl der Text nur die -1,00-EUR-
      // Rückgabe hergibt.
      { lineNo: 4, rawText: 'Pfand', lineType: 'deposit', quantity: '4', unit: 'stk',
        unitPriceCents: 25, totalPriceCents: 100, vatClass: 'B', appliesToLine: null }
    ];
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(items))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(TEXT_MIT_PFANDRUECKGABE)
    });

    const { receipt, warnings } = await provider.extract(Buffer.from('bild'));

    expect(receipt.items).toHaveLength(3);
    expect(receipt.items.some((i) => i.lineType === 'deposit')).toBe(false);
    // Die Rückgabe selbst bleibt unangetastet — nur die gespiegelte, unbelegte Zeile
    // fliegt raus.
    expect(receipt.items.some((i) => i.lineType === 'deposit_return')).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Position 4');
    expect(warnings[0]).toContain('entfernt');
  });

  it('lässt eine deposit-Zeile mit echtem, positivem Beleg im OCR-Text unangetastet', async () => {
    const items = [
      ...ZWEI_ARTIKEL,
      { lineNo: 3, rawText: 'PFAND', lineType: 'deposit', quantity: '1', unit: 'stk',
        unitPriceCents: 25, totalPriceCents: 25, vatClass: 'A', appliesToLine: null }
    ];
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(items))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(TEXT_MIT_ECHTEM_PFAND)
    });

    const { receipt, warnings } = await provider.extract(Buffer.from('bild'));

    expect(receipt.items).toHaveLength(3);
    expect(receipt.items.some((i) => i.lineType === 'deposit')).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('raw bleibt die UNGEFILTERTE Modellantwort — die entfernte Zeile bleibt dort auffindbar', async () => {
    const items = [
      ...ZWEI_ARTIKEL,
      { lineNo: 3, rawText: 'Pfandrückgabe', lineType: 'deposit_return', quantity: '4',
        unit: 'stk', unitPriceCents: 25, totalPriceCents: -100, vatClass: 'B', appliesToLine: null },
      { lineNo: 4, rawText: 'Pfand', lineType: 'deposit', quantity: '4', unit: 'stk',
        unitPriceCents: 25, totalPriceCents: 100, vatClass: 'B', appliesToLine: null }
    ];
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(items))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(TEXT_MIT_PFANDRUECKGABE)
    });

    const { raw } = await provider.extract(Buffer.from('bild'));

    expect((raw as { items: unknown[] }).items).toHaveLength(4);
  });
});

describe('BonUnlesbarError erklaert seine eigene Entscheidung', () => {
	// Anlass (2026-09-17, echter Bon): die Meldung lautete "24 Beträge, Summenzeile ja,
	// Datum nein" — und genau diese beiden Werte hätten BESTANDEN. Gegriffen hat der
	// Überhang, der in der Meldung gar nicht vorkam. Wer das liest, muss glauben, die
	// Prüfung sei kaputt. Eine Fehlermeldung, die ihre eigene Entscheidung nicht
	// erklären kann, sieht nach Auskunft aus und ist keine.
	it('nennt den Überhang als Grund, wenn er das ausschlaggebende Kriterium war', () => {
		const fehler = new BonUnlesbarError('irgendwas', {
			brauchbar: false,
			hatSummenzeile: true,
			anzahlBetraege: 24,
			hatDatum: false,
			ueberhangGroessterBetrag: 2.19
		});

		expect(fehler.message).toContain('überragt alle übrigen');
		expect(fehler.message).toContain('2.19');
		// Die Zahlen bleiben drin — sie waren nie falsch, nur unvollständig.
		expect(fehler.message).toContain('24 Beträge');
	});

	it('nennt fehlende Beträge bzw. fehlenden Kontext, wenn DIE gegriffen haben', () => {
		const ohneBetraege = new BonUnlesbarError('', {
			brauchbar: false, hatSummenzeile: false, anzahlBetraege: 0,
			hatDatum: false, ueberhangGroessterBetrag: null
		});
		expect(ohneBetraege.message).toContain('zu wenige erkennbare Beträge');
		expect(ohneBetraege.message).toContain('weder Summenzeile noch Datum');
	});
});

describe('ocrZeilen (Etappe 2 der Oberflaeche)', () => {
  const KOPF = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  // Eine Zeile mit zwei Woertern: Tesseract-TSV, wie die Abstraktion sie in Etappe 1
  // der PaddleOCR-Anbindung zusammenbaut. Betraege erfunden.
  const TSV = [
    KOPF,
    '5\t1\t1\t1\t1\t1\t10\t20\t60\t14\t91\tMilch',
    '5\t1\t1\t1\t1\t2\t80\t20\t30\t14\t88\t1,09',
    '5\t1\t1\t1\t2\t1\t10\t40\t90\t14\t95\tZu',
    '5\t1\t1\t1\t2\t2\t105\t40\t50\t14\t95\tzahlen',
    '5\t1\t1\t1\t2\t3\t160\t40\t30\t14\t95\t1,09',
    '5\t1\t1\t1\t3\t1\t10\t60\t60\t14\t90\t01.01.2026'
  ].join('\n');

  it('liefert mit mitBoxen die Zeilen ohne Woerter, mit Rahmen und Confidence', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(TSV),
      mitBoxen: true
    });

    const { ocrZeilen } = await provider.extract(Buffer.from('bild'));

    expect(ocrZeilen).toHaveLength(3);
    expect(ocrZeilen?.[0]).toEqual({ text: 'Milch 1,09', box: [10, 20, 100, 14], confidence: 89.5 });
    // Keine Woerter im gespeicherten Format — sie wuerden das JSON verdreifachen.
    expect(ocrZeilen?.[0]).not.toHaveProperty('woerter');
  });

  // Ohne mitBoxen gibt es keine Zeilen. null, kein leeres Array: "keine Boxen
  // angefordert" darf nicht aussehen wie "OCR fand keine Zeile".
  it('liefert ohne mitBoxen null', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt(JSON.stringify(basisAntwort(ZWEI_ARTIKEL))) as unknown as typeof fetch,
      execFileImpl: execFileImplMitText(LESBARER_TEXT)
    });

    const { ocrZeilen } = await provider.extract(Buffer.from('bild'));

    expect(ocrZeilen).toBeNull();
  });

  // Auch ein unlesbarer Bon traegt seine Zeilen: wer spaeter wissen will, WARUM der
  // Tuersteher zuschlug, braucht sie.
  it('haengt die Zeilen an den BonUnlesbarError', async () => {
    const provider = createOcrTextProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetchGibt('{}') as unknown as typeof fetch,
      execFileImpl: execFileImplMitText([KOPF, '5\t1\t1\t1\t1\t1\t10\t20\t60\t14\t91\tKauderwelsch'].join('\n')),
      mitBoxen: true
    });

    await expect(provider.extract(Buffer.from('bild'))).rejects.toMatchObject({
      name: 'BonUnlesbarError',
      ocrZeilen: [{ text: 'Kauderwelsch', box: [10, 20, 60, 14], confidence: 91 }]
    });
  });
});
