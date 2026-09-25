import { describe, it, expect, vi, beforeEach } from 'vitest';

// $lib/server/db/schema hat keine Nebenwirkungen (reine Tabellendefinitionen) und wird
// bewusst NICHT gemockt: eq(receipts.id, ...) und die table-Objekte selbst (zum
// Identifizieren, welche Tabelle ein Insert/Update trifft) brauchen die echten Column-
// bzw. Tabellen-Objekte, kein Fake dafür. Dieselbe Begründung wie in
// receipts-endpoint.test.ts.
//
// $lib/server/db wird gemockt, damit productionDeps ohne laufende Datenbank getestet
// werden kann — dieselbe Grund-Idee wie beim Handler-Test, nur hier für die
// DB-schreibende Hälfte von Task 11 (Review-Runde 1, F1 und F2).
const mocks = vi.hoisted(() => ({
	insertCalls: [] as { table: unknown; values: unknown }[],
	updateCalls: [] as { table: unknown; set: unknown }[],
	// Steuert den Haendler-Upsert-Zweig (onConflictDoUpdate().returning()): normal
	// liefert er eine fake Id zurueck; fuer Review Task 1, Befund 1 kann ein Test
	// hierueber einen Fehler erzwingen, um zu pruefen, dass ein werfendes
	// haendlerAufloesen die restliche Transaktion NICHT mitreisst.
	merchantUpsertError: null as Error | null,
	// Aufgabe 4, Teil B: notifyMatrix und getBoss()/getJobById() gemockt, damit
	// productionDeps().markFailed/getRetryInfo ohne echtes Matrix-Konto bzw. echten
	// pg-boss getestet werden koennen — dieselbe Grund-Idee wie beim DB-Mock oben.
	// Expliziter Typparameter (wie bei saveResult/markFailed in
	// extract-receipt.test.ts): sonst typisiert vi.fn() `.mock.calls[0]` als leeres
	// Tupel, und die Destrukturierung weiter unten scheitert an svelte-check.
	notifyMatrix: vi.fn<(text: string) => Promise<void>>(async () => {}),
	getJobById: vi.fn(async () => ({ retryCount: 1, retryLimit: 3 }) as unknown),
	// Die Doppel-Suche hat eigene Tests gegen die echte Datenbank (bons/doppelt.db.test.ts).
	// Hier nur: was der Worker mit ihrer Antwort macht — auch wenn sie wirft.
	originalFuerNeuenBon: vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null)
}));

vi.mock('$lib/server/bons/doppelt', () => ({
	DOPPEL_GRUND: 'moeglicher_doppelbon',
	originalFuerNeuenBon: mocks.originalFuerNeuenBon
}));

vi.mock('$lib/server/notify', () => ({ notifyMatrix: mocks.notifyMatrix }));

vi.mock('$lib/server/queue/boss', () => ({
	QUEUE_EXTRACT: 'extract-receipt',
	getBoss: async () => ({ getJobById: mocks.getJobById })
}));

vi.mock('$lib/server/db', () => {
	function makeInsert(table: unknown) {
		return {
			values: (values: unknown) => {
				mocks.insertCalls.push({ table, values });
				return {
					// Wie bisher direkt awaitbar (receiptItems/extractionRuns brauchen nur das).
					then: (resolve: (v: undefined) => void) => resolve(undefined),
					// Zusaetzlich verkettbar wie beim Haendler-Upsert in merchants.ts
					// (haendlerAufloesen ruft echten Code, der hier auf den Mock trifft):
					// insert(...).values(...).onConflictDoUpdate(...).returning(...).
					onConflictDoUpdate: () => ({
						returning: () =>
							mocks.merchantUpsertError
								? Promise.reject(mocks.merchantUpsertError)
								: Promise.resolve([{ id: 'merchant-fake-id' }])
					})
				};
			}
		};
	}
	function makeUpdate(table: unknown) {
		return {
			set: (set: unknown) => ({
				where: () => {
					mocks.updateCalls.push({ table, set });
					return Promise.resolve();
				}
			})
		};
	}
	return {
		db: {
			insert: makeInsert,
			update: makeUpdate,
			delete: () => ({ where: () => Promise.resolve() }),
			transaction: async (fn: (tx: unknown) => Promise<void>) => {
				const tx = { insert: makeInsert, update: makeUpdate, delete: () => ({ where: () => Promise.resolve() }) };
				await fn(tx);
			}
		}
	};
});

import { productionDeps } from './extract-receipt';
import { receipts, receiptItems, extractionRuns } from '$lib/server/db/schema';
import { checkPlausibility } from '$lib/server/validation/plausibility';
import type { ExtractedReceipt } from '$lib/server/extraction/schema';

beforeEach(() => {
	mocks.insertCalls.length = 0;
	mocks.updateCalls.length = 0;
	mocks.merchantUpsertError = null;
	vi.clearAllMocks();
	// vi.clearAllMocks() leert nur die Aufrufliste, nicht die per vi.fn(impl) beim
	// Erstellen gesetzte Standard-Implementierung — die bleibt also erhalten. Ein
	// einzelner Test kann sie trotzdem gezielt mit mockResolvedValueOnce/
	// mockImplementationOnce überschreiben.
});

describe('productionDeps().markFailed', () => {
	it('trägt die echte Provider-Identität ein, nicht "unknown" (Review-Runde 1, F1)', async () => {
		const deps = productionDeps({ id: 'openai-compat', model: 'gemini-3.6-flash', extract: vi.fn() });
		await deps.markFailed('r1', 'LLM kaputt');

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({
			receiptId: 'r1',
			provider: 'openai-compat',
			model: 'gemini-3.6-flash',
			error: 'LLM kaputt'
		});

		const receiptsUpdate = mocks.updateCalls.find((c) => c.table === receipts);
		expect(receiptsUpdate?.set).toMatchObject({ status: 'failed' });
	});

	// Aufgabe 3 (Entwurf E5): bei einem als unlesbar markierten Bon ist der OCR-Text
	// der einzige Beleg, was Tesseract geliefert hat — er muss in extraction_runs
	// ankommen, nicht nur im Fehlerobjekt stecken bleiben.
	it('legt den OCR-Text ab, wenn einer übergeben wird', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'Bon unlesbar', { ocrText: 'L$DL kauderwelsch' });

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({ ocrText: 'L$DL kauderwelsch' });
	});

	// Etappe 2: der gescheiterte Bon ist die Zeile, in der die Engine-Angabe am meisten
	// zaehlt — "welche Engine scheitert haeufiger" ist die halbe Fragestellung des
	// Tesseract/PaddleOCR-Vergleichs.
	it('legt Engine, Dauer und Optionen des OCR-Laufs ab, wenn der Bon an der OCR scheiterte', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'Bon unlesbar', {
			ocrText: 'L$DL kauderwelsch',
			ocr: {
				engine: 'tesseract',
				durationMs: 812,
				options: { sprache: 'deu', psm: 6, mitBoxen: false }
			}
		});

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({
			ocrEngine: 'tesseract',
			ocrDurationMs: 812,
			ocrOptions: { sprache: 'deu', psm: 6, mitBoxen: false },
			// Tesseract meldet heute keine Version. null ist die Leerstelle — eine leere
			// Zeichenkette saehe wie eine gemeldete Version aus.
			ocrEngineVersion: null
		});
	});

	// Der Bildweg hat keinen OCR-Schritt. Alle vier Spalten bleiben leer — insbesondere
	// ocr_duration_ms: eine 0 dort waere eine Behauptung ueber einen Lauf, den es nie
	// gab, und ein Mittelwert ueber die Spalte waere still verfaelscht.
	it('legt die OCR-Zeilen eines unlesbaren Bons ab', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		const zeilen = [{ text: 'L$DL', box: [0, 0, 10, 10] as [number, number, number, number], confidence: 12 }];
		await deps.markFailed('r1', 'Bon unlesbar', { ocrText: 'L$DL', ocrZeilen: zeilen });
		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({ ocrZeilen: zeilen });
	});

	it('laesst alle vier OCR-Spalten null, wenn keine OCR lief', async () => {
		const deps = productionDeps({ id: 'openai-compat', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'LLM kaputt');

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({
			ocrEngine: null,
			ocrEngineVersion: null,
			ocrDurationMs: null,
			ocrOptions: null
		});
	});

	it('legt null statt eines fehlenden Werts ab, wenn kein OCR-Text bekannt ist', async () => {
		const deps = productionDeps({ id: 'openai-compat', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'LLM kaputt');

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({ ocrText: null });
	});

	// Aufgabe 4, Teil B: seit handleExtractJobs einen terminal markierten Bon NICHT
	// mehr an pg-boss zur Wiederholung durchreicht, feuert der bisherige Alarm in
	// worker/index.ts (der nur bei einem geworfenen Fehler auslöst) für GENAU diesen
	// Fall nicht mehr — ohne einen eigenen Alarm HIER würde ein endgültig
	// aufgegebener Bon lautlos aufgegeben werden.
	it('meldet den Fehlschlag über notifyMatrix, mit der Bon-Id und dem Grund', async () => {
		const deps = productionDeps({ id: 'openai-compat', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'Modell nicht erreichbar');

		expect(mocks.notifyMatrix).toHaveBeenCalledTimes(1);
		const [text] = mocks.notifyMatrix.mock.calls[0] as [string];
		expect(text).toContain('r1');
		expect(text).toContain('Modell nicht erreichbar');
	});
});

// Aufgabe 4, Teil B: pg-bosses work()-Handler liefert kein retryCount/retryLimit
// mit (siehe Kommentar bei ExtractDeps.getRetryInfo) — productionDeps() muss es
// selbst über boss.getJobById() nachfragen.
describe('productionDeps().getRetryInfo', () => {
	it('liefert retryCount/retryLimit aus boss.getJobById()', async () => {
		mocks.getJobById.mockResolvedValueOnce({ retryCount: 2, retryLimit: 15 });
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });

		const info = await deps.getRetryInfo('job-123');

		expect(info).toEqual({ retryCount: 2, retryLimit: 15 });
		expect(mocks.getJobById).toHaveBeenCalledWith('extract-receipt', 'job-123');
	});

	// Konservativer Rückfall, falls getJobById aus irgendeinem Grund leer zurückkommt
	// (sollte praktisch nie vorkommen): NICHT als letzten Versuch werten, sonst gäbe
	// ein leeres Ergebnis einem Bon fälschlich auf, statt eine Runde länger zu warten.
	it('behandelt einen fehlenden Job konservativ als "nicht letzter Versuch"', async () => {
		mocks.getJobById.mockResolvedValueOnce(null);
		const konsoleFehler = vi.spyOn(console, 'error').mockImplementation(() => {});
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });

		const info = await deps.getRetryInfo('job-verschwunden');

		expect(info.retryCount).toBeLessThan(info.retryLimit);
		expect(konsoleFehler).toHaveBeenCalled();
		konsoleFehler.mockRestore();
	});
});

describe('productionDeps().saveResult — Duplikat-lineNo (Review-Runde 1, F2)', () => {
	const duplicateReceipt: ExtractedReceipt = {
		merchantName: 'REWE', merchantAddress: null, purchasedAt: null,
		totalGrossCents: 300, currency: 'EUR', paymentMethod: null,
		vatSummary: [{ rate: 19, netCents: 252, taxCents: 48, grossCents: 300 }],
		items: [
			{ lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1', unit: 'stk',
				unitPriceCents: 100, totalPriceCents: 100, vatClass: 'A', appliesToLine: null },
			{ lineNo: 1, rawText: 'BUTTER', lineType: 'article', quantity: '1', unit: 'stk',
				unitPriceCents: 200, totalPriceCents: 200, vatClass: 'A', appliesToLine: null }
		]
	};

	it('wird trotz doppelter lineNo eingefügt, mit eindeutigen Zeilennummern, und duplicate_line_no bleibt in den Beanstandungen sichtbar', async () => {
		const deps = productionDeps({
			id: 'test', model: 'test-1',
			extract: vi.fn(async () => ({
				receipt: duplicateReceipt, usage: null, raw: duplicateReceipt, servedModel: 'test-1',
				warnings: [], ocrText: null, ocr: null, ocrZeilen: null
			}))
		});

		// problems über die echte checkPlausibility auf den ROHDATEN berechnet (vor
		// der Sanitisierung in saveResult), genau wie handleExtractJobs es täte —
		// "duplicate_line_no" kommt damit tatsächlich aus dem Bon selbst, nicht aus
		// dem Test vorgetäuscht. loadImage/db.select wird hier bewusst nicht
		// durchlaufen (kein echtes Bild auf der Platte nötig) — dieser Test prüft
		// gezielt saveResult, nicht den ganzen Job-Ablauf (der ist in
		// extract-receipt.test.ts abgedeckt).
		const problems = checkPlausibility(duplicateReceipt);
		expect(problems).toContain('duplicate_line_no');

		await deps.saveResult({
			receiptId: 'r1',
			result: duplicateReceipt,
			raw: duplicateReceipt,
			servedModel: 'test-1',
			problems,
			provider: 'test',
			model: 'test-1',
			durationMs: 10,
			usage: null,
			ocrText: null,
			ocr: null,
			ocrZeilen: null
		});

		const itemsInsert = mocks.insertCalls.find((c) => c.table === receiptItems);
		const insertedValues = itemsInsert?.values as { lineNo: number; rawText: string }[];
		expect(insertedValues).toHaveLength(2);
		const lineNos = insertedValues.map((v) => v.lineNo);
		expect(new Set(lineNos).size).toBe(2); // eindeutig, der Unique-Constraint hielte
		expect(insertedValues.map((v) => v.rawText)).toEqual(['MILCH', 'BUTTER']); // unangetastet

		const receiptsUpdate = mocks.updateCalls.find((c) => c.table === receipts);
		const setArg = receiptsUpdate?.set as {
			needsReviewReason: string[];
			status: string;
			merchantId: string | null;
		};
		expect(setArg.needsReviewReason).toContain('duplicate_line_no');
		expect(setArg.status).toBe('review'); // der Bon überlebt, wird nur geflaggt
		// Review Task 1, Befund 3: bisher prüfte keine Zusicherung, dass merchantId
		// tatsächlich aus dem Haendler-Upsert (RETURNING) im receiptsUpdate.set landet —
		// eine vertauschte oder fehlende Verdrahtung wäre unbemerkt geblieben.
		expect(setArg.merchantId).toBe('merchant-fake-id');

		// Aufgabe 3 (Entwurf E5): der OCR-Text muss bei einem erfolgreich gespeicherten
		// Bon ebenfalls in extraction_runs ankommen.
		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({ ocrText: null });
	});

	it('legt einen tatsächlich übergebenen OCR-Text ab (Textweg-Anbieter)', async () => {
		const deps = productionDeps({
			id: 'test', model: 'test-1',
			extract: vi.fn(async () => ({
				receipt: duplicateReceipt, usage: null, raw: duplicateReceipt, servedModel: 'test-1',
				warnings: [], ocrText: 'Milch 1,00\nButter 2,00\nZu zahlen 3,00',
				ocr: { engine: 'tesseract' as const, durationMs: 812, options: { sprache: 'deu', psm: 6, mitBoxen: false } },
				ocrZeilen: null
			}))
		});

		await deps.saveResult({
			receiptId: 'r1',
			result: duplicateReceipt,
			raw: duplicateReceipt,
			servedModel: 'test-1',
			problems: [],
			provider: 'test',
			model: 'test-1',
			durationMs: 10,
			usage: null,
			ocrText: 'Milch 1,00\nButter 2,00\nZu zahlen 3,00',
			// Etappe 2: derselbe Lauf, der den Text erzeugt hat.
			ocr: { engine: 'tesseract', durationMs: 812, options: { sprache: 'deu', psm: 6, mitBoxen: false } },
			ocrZeilen: null
		});

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({
			ocrText: 'Milch 1,00\nButter 2,00\nZu zahlen 3,00',
			// Etappe 2: dieselben vier Spalten wie auf dem Fehlerweg. Sie NUR dort zu
			// fuellen hiesse, dass der Vergleich ausgerechnet die gelungenen Laeufe
			// nicht kennt — also genau die, an denen man Qualitaet misst.
			ocrEngine: 'tesseract',
			ocrEngineVersion: null,
			ocrDurationMs: 812,
			ocrOptions: { sprache: 'deu', psm: 6, mitBoxen: false }
		});
	});
	// Etappe 2 der Oberflaeche: die Zeilen landen im Lauf, und jede Position bekommt
	// ihre Zeile — hier eine Tesseract-Zeile, die Name und Betrag traegt.
	it('legt ocr_zeilen im Lauf und ocr_zeile je Position ab', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		const zeilen = [
			{ text: 'KOPFZEILE', box: [0, 0, 100, 10] as [number, number, number, number], confidence: 80 },
			{ text: 'MILCH 1,00 A', box: [0, 20, 100, 10] as [number, number, number, number], confidence: 90 },
			{ text: 'BUTTER 2,00 A', box: [0, 40, 100, 10] as [number, number, number, number], confidence: 90 }
		];
		await deps.saveResult({
			receiptId: 'r1',
			result: duplicateReceipt,
			raw: duplicateReceipt,
			servedModel: 'test-1',
			problems: [],
			provider: 'test',
			model: 'test-1',
			durationMs: 10,
			usage: null,
			ocrText: zeilen.map((z) => z.text).join('\n'),
			ocr: null,
			ocrZeilen: zeilen
		});

		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert?.values).toMatchObject({ ocrZeilen: zeilen });
		const itemsInsert = mocks.insertCalls.find((c) => c.table === receiptItems);
		const eingefuegt = itemsInsert?.values as { rawText: string; ocrZeile: number | null }[];
		// duplicateReceipt hat MILCH (100) und BUTTER (200) — beide finden ihre Zeile.
		expect(eingefuegt.find((i) => i.rawText === 'MILCH')?.ocrZeile).toBe(1);
		expect(eingefuegt.find((i) => i.rawText === 'BUTTER')?.ocrZeile).toBe(2);
	});

	it('laesst ocr_zeile null, wenn der Lauf keine Zeilen hat', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		await deps.saveResult({
			receiptId: 'r1', result: duplicateReceipt, raw: duplicateReceipt, servedModel: 'test-1', problems: [],
			provider: 'test', model: 'test-1', durationMs: 10, usage: null, ocrText: null, ocr: null, ocrZeilen: null
		});
		const itemsInsert = mocks.insertCalls.find((c) => c.table === receiptItems);
		for (const i of itemsInsert?.values as { ocrZeile: number | null }[]) expect(i.ocrZeile).toBeNull();
	});
});

describe('productionDeps().saveResult — Haendler-Aufloesung darf den Bon nicht mitreissen (Review Task 1, Befund 1)', () => {
	const einfacherBeleg: ExtractedReceipt = {
		merchantName: 'Pleite-Getraenke GmbH',
		merchantAddress: null,
		purchasedAt: null,
		totalGrossCents: 199,
		currency: 'EUR',
		paymentMethod: null,
		vatSummary: [{ rate: 19, netCents: 167, taxCents: 32, grossCents: 199 }],
		items: [
			{
				lineNo: 1,
				rawText: 'WASSER',
				lineType: 'article',
				quantity: '1',
				unit: 'stk',
				unitPriceCents: 199,
				totalPriceCents: 199,
				vatClass: 'A',
				appliesToLine: null
			}
		]
	};

	it('speichert Positionen, receipts-Update und extractionRuns trotzdem, mit merchantId=null, wenn haendlerAufloesen wirft', async () => {
		// Simuliert genau den im Review beschriebenen Fall: DB-Verbindungsaussetzer o.ä.
		// beim Haendler-Upsert. Das rohe Fehlerobjekt darf nicht ins Log — hier wird nur
		// geprüft, dass der Bon trotzdem überlebt; das Log-Verhalten selbst ist am Code
		// (extract-receipt.ts) ersichtlich (sanitierte message statt raw error).
		mocks.merchantUpsertError = new Error('DB-Verbindung verloren: TESTMARKER-fiktiver-fehlertext-kein-echtes-geheimnis');
		const konsoleFehler = vi.spyOn(console, 'error').mockImplementation(() => {});

		const deps = productionDeps({ id: 'test', model: 'test-1', extract: vi.fn() });

		await deps.saveResult({
			receiptId: 'r2',
			result: einfacherBeleg,
			raw: einfacherBeleg,
			servedModel: 'test-1',
			problems: [],
			provider: 'test',
			model: 'test-1',
			durationMs: 5,
			usage: null,
			ocrText: null,
			ocr: null,
			ocrZeilen: null
		});

		// Die Positionen sind trotzdem eingefügt — genau die teuer aufbereiteten Daten,
		// die laut Review sonst mit der ganzen Transaktion zurückgerollt würden.
		const itemsInsert = mocks.insertCalls.find((c) => c.table === receiptItems);
		const insertedValues = itemsInsert?.values as { lineNo: number; rawText: string }[];
		expect(insertedValues).toHaveLength(1);
		expect(insertedValues[0].rawText).toBe('WASSER');

		// receipts-Update lief durch, der Bon bleibt "review" (nicht "failed"), und
		// merchantId fällt auf null zurück — denselben Wert wie bei "kein Name gelesen".
		const receiptsUpdate = mocks.updateCalls.find((c) => c.table === receipts);
		const setArg = receiptsUpdate?.set as { status: string; merchantId: string | null };
		expect(setArg.status).toBe('review');
		expect(setArg.merchantId).toBeNull();

		// extractionRuns-Insert (der teure Beleg für Kosten/Provider-Vergleich) ist
		// ebenfalls nicht mit zurückgerollt.
		const runsInsert = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runsInsert).toBeDefined();

		// Bemerkbar geloggt, aber ohne das rohe Fehlerobjekt (könnte Verbindungsdaten
		// mitschleppen) — nur die sanitierte message darf im Log auftauchen.
		//
		// Gesucht wird GEZIELT der Haendler-Eintrag, nicht „genau ein console.error":
		// seit die Kategorie-Kaskade nach der Transaktion laeuft (Phase 2, Aufgabe 8),
		// meldet auch sie sich hier, weil in diesem Test weder Datenbank noch Modell
		// echt sind. Eine Zaehlung haette diesen Test bei jeder weiteren, voellig
		// berechtigten Meldung erneut brechen lassen.
		const haendlerRufe = konsoleFehler.mock.calls.filter((c) =>
			(c as unknown[]).some((a) => typeof a === 'string' && a.includes('Haendler-Aufloesung'))
		);
		expect(haendlerRufe).toHaveLength(1);
		const alleArgs = haendlerRufe[0] as unknown[];
		// Kein rohes Fehlerobjekt im Log (könnte z. B. Verbindungsdaten mitschleppen) …
		expect(alleArgs.some((a) => a instanceof Error)).toBe(false);
		// … aber die sanitierte message UND die Bon-Id sind bemerkbar drin.
		expect(alleArgs.some((a) => typeof a === 'string' && a.includes('TESTMARKER-fiktiver-fehlertext-kein-echtes-geheimnis'))).toBe(true);
		expect(alleArgs.some((a) => typeof a === 'string' && a.includes('r2'))).toBe(true);

		konsoleFehler.mockRestore();
	});
});

describe('productionDeps().saveResult — Doppel-Erkennung', () => {
	const bon: ExtractedReceipt = {
		merchantName: 'ALDI', merchantAddress: null, purchasedAt: '2026-09-16T16:10:00',
		totalGrossCents: 1217, currency: 'EUR', paymentMethod: null, vatSummary: [],
		items: [
			{ lineNo: 1, rawText: 'BANANEN', lineType: 'article', quantity: '1', unit: 'stk',
				unitPriceCents: 1217, totalPriceCents: 1217, vatClass: 'A', appliesToLine: null }
		]
	};
	const speichern = () =>
		productionDeps({ id: 'test', model: 'test-1', extract: vi.fn() }).saveResult({
			receiptId: 'r2', result: bon, raw: bon, servedModel: 'test-1', problems: ['sum_mismatch'],
			provider: 'test', model: 'test-1', durationMs: 10, usage: null, ocrText: null, ocr: null, ocrZeilen: null
		});
	const receiptsSet = () =>
		mocks.updateCalls.find((c) => c.table === receipts)?.set as {
			vermutetesOriginalId: string | null;
			needsReviewReason: string[];
			status: string;
		};

	it('traegt das vermutete Original ein und ergaenzt den Hinweis bei den Beanstandungen', async () => {
		mocks.originalFuerNeuenBon.mockResolvedValueOnce('r1');
		await speichern();
		// Gefragt wird mit der GELESENEN Kaufzeit und Summe dieses Bons.
		const [, id, zeit, summe] = mocks.originalFuerNeuenBon.mock.calls[0];
		expect(id).toBe('r2');
		expect(zeit).toBeInstanceOf(Date);
		expect(summe).toBe(1217);
		const set = receiptsSet();
		expect(set.vermutetesOriginalId).toBe('r1');
		expect(set.needsReviewReason).toEqual(['sum_mismatch', 'moeglicher_doppelbon']);
		expect(set.status).toBe('review');
	});

	it('laesst beides leer, wenn es kein Original gibt', async () => {
		await speichern();
		const set = receiptsSet();
		expect(set.vermutetesOriginalId).toBeNull();
		expect(set.needsReviewReason).toEqual(['sum_mismatch']);
	});

	it('speichert den Bon trotzdem, wenn die Doppel-Suche wirft', async () => {
		// Ein Bon wird nie wegen einer Nebenpruefung verworfen — derselbe Grundsatz wie bei
		// der Haendler-Aufloesung. Er kommt dann eben ohne Hinweis in die Pruefung.
		mocks.originalFuerNeuenBon.mockRejectedValueOnce(new Error('Verbindung weg'));
		const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
		await speichern();
		const set = receiptsSet();
		expect(set.status).toBe('review');
		expect(set.vermutetesOriginalId).toBeNull();
		expect(fehler).toHaveBeenCalled();
		fehler.mockRestore();
	});
});

describe('productionDeps — Herkunft des Laufs', () => {
	it('schreibt den Anbieter der Oberflaeche an einen fehlgeschlagenen Lauf', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'qwen', kiAnbieterId: 'a1', preise: { einMicro: 0, ausMicro: 0 }, extract: vi.fn() });
		await deps.markFailed('r1', 'kaputt');
		const runs = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runs?.values).toMatchObject({ kiAnbieterId: 'a1' });
	});

	it('schreibt null, wenn der Lauf ueber die .env kam', async () => {
		const deps = productionDeps({ id: 'ocr-text', model: 'm', extract: vi.fn() });
		await deps.markFailed('r1', 'kaputt');
		const runs = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runs?.values).toMatchObject({ kiAnbieterId: null });
	});

	// Vorlage: der erste Test unter „productionDeps().saveResult — Duplikat-lineNo" —
	// hier nur um kiAnbieterId/preise/usage ergaenzt, um die Kostenberechnung des
	// wechselnden Anbieters zu pruefen (10 Input- + 5 Output-Token je 1 Euro/Mio.
	// Token = 15 Millionstel Euro). Eigenes `result`, weil `duplicateReceipt` im
	// Geltungsbereich des anderen describe-Blocks liegt.
	it('schreibt den Anbieter und dessen Kosten an einen erfolgreichen Lauf', async () => {
		const herkunftReceipt: ExtractedReceipt = {
			merchantName: 'REWE', merchantAddress: null, purchasedAt: null,
			totalGrossCents: 300, currency: 'EUR', paymentMethod: null,
			vatSummary: [{ rate: 19, netCents: 252, taxCents: 48, grossCents: 300 }],
			items: [
				{ lineNo: 1, rawText: 'MILCH', lineType: 'article', quantity: '1', unit: 'stk',
					unitPriceCents: 100, totalPriceCents: 100, vatClass: 'A', appliesToLine: null },
				{ lineNo: 2, rawText: 'BUTTER', lineType: 'article', quantity: '1', unit: 'stk',
					unitPriceCents: 200, totalPriceCents: 200, vatClass: 'A', appliesToLine: null }
			]
		};
		const deps = productionDeps({
			id: 'ocr-text', model: 'm', kiAnbieterId: 'a1', preise: { einMicro: 1_000_000, ausMicro: 1_000_000 },
			extract: vi.fn()
		});

		await deps.saveResult({
			receiptId: 'r1',
			result: herkunftReceipt,
			raw: herkunftReceipt,
			servedModel: 'm',
			problems: [],
			provider: 'ocr-text',
			model: 'm',
			durationMs: 10,
			usage: { inputTokens: 10, outputTokens: 5 },
			ocrText: null,
			ocr: null,
			ocrZeilen: null
		});

		const runs = mocks.insertCalls.find((c) => c.table === extractionRuns);
		expect(runs?.values).toMatchObject({ kiAnbieterId: 'a1', costMicroEuros: 15 });
	});
});
