import { describe, it, expect, vi } from 'vitest';
import {
	AUFTRAG_VERFAELLT_SEKUNDEN,
	AUFTRAG_SICHERHEIT_SEKUNDEN,
	MAX_ZEITLIMIT_MS,
	MAX_OCR_ZEITLIMIT_MS,
	RESERVE_MINDEST_REST_MS,
	NACHFRAGE_MINDEST_REST_MS,
	auftragsFrist
} from './fristen';
import { MAX_TOKENS_STRUKTURIERT } from '../extraction/ocr-text-provider';
import { OCR_ZEITLIMIT_MS } from '../ocr/lesen';
import { PADDLE_ZEITLIMIT_MS } from '../ocr/paddle';
import { MATRIX_ZEITLIMIT_MS } from '../notify';
import { KATEGORIEN_ZEITLIMIT_MS } from '../kategorien/modell';

// Gemessen am 2026-09-15 auf dem Mac mini des Betreibers.
const TOKEN_PRO_SEKUNDE = 30;
const PREFILL_SEKUNDEN = 14;

describe('Die Fristen der Auslesung stehen in der richtigen Ordnung', () => {
	// Ohne diese Zusicherung kann jemand eine der drei Zahlen anfassen, ohne die
	// anderen mitzudenken — und der Fehler zeigt sich erst im Betrieb, als Lawine
	// gleichzeitiger Anfragen an einen Rechner, der zwei bis drei verkraftet.
	it('laesst das Zeitlimit zuverlaessig vor dem Auftragsverfall greifen', () => {
		expect(MAX_ZEITLIMIT_MS).toBeLessThan(AUFTRAG_VERFAELLT_SEKUNDEN * 1000);
		expect(AUFTRAG_VERFAELLT_SEKUNDEN * 1000 - MAX_ZEITLIMIT_MS).toBeGreaterThanOrEqual(60_000);
	});

	// Etappe 3: der OCR-Schritt laeuft VOR dem Modellaufruf, seine Dauer kommt obendrauf.
	// Ohne diese Zusicherung passten 60 s PaddleOCR plus 540 s Modell exakt in die 600 s
	// Verfallsfrist — also gar nicht: ein Auftrag, der verfaellt, waehrend seine Anfrage
	// noch laeuft, startet ein zweites Mal NEBEN dem ersten, und der Mac antwortet bei
	// zwei bis drei gleichzeitigen Anfragen mit 503. Genau die Lawine, gegen die diese
	// Datei geschrieben wurde.
	it('laesst OCR und Modell zusammen vor dem Auftragsverfall fertig werden', () => {
		expect(MAX_OCR_ZEITLIMIT_MS + MAX_ZEITLIMIT_MS).toBeLessThan(
			AUFTRAG_VERFAELLT_SEKUNDEN * 1000
		);
	});

	// Das Budget gilt fuer JEDE Engine. Wer ein Engine-Zeitlimit anhebt, soll hier
	// scheitern und nicht erst im Betrieb — ein zu spaet bemerktes Zeitlimit ist
	// dieselbe Lawine, nur langsamer.
	it('haelt jede OCR-Engine innerhalb des OCR-Budgets', () => {
		for (const [name, limit] of [
			['tesseract', OCR_ZEITLIMIT_MS],
			['paddleocr', PADDLE_ZEITLIMIT_MS]
		] as const) {
			expect(limit, name).toBeLessThanOrEqual(MAX_OCR_ZEITLIMIT_MS);
		}
	});

	it('laesst dem Auslegungsfall genug Zeit, ueberhaupt fertig zu werden', () => {
		const positionen = 60;
		const tokenJePosition = 109;
		const kopf = 300;
		const dauerSekunden = (positionen * tokenJePosition + kopf) / TOKEN_PRO_SEKUNDE + PREFILL_SEKUNDEN;
		expect(dauerSekunden).toBeLessThan(MAX_ZEITLIMIT_MS / 1000);
	});

	// Die Notbremse darf groesser sein als der Auslegungsfall — aber wer sie anhebt,
	// soll daran erinnert werden, dass darueber niemand mehr rechtzeitig fertig wird.
	it('nennt die Grenze, ab der ein Bon nicht mehr rechtzeitig fertig werden kann', () => {
		const maximalMoegliche = (MAX_ZEITLIMIT_MS / 1000 - PREFILL_SEKUNDEN) * TOKEN_PRO_SEKUNDE;
		expect(MAX_TOKENS_STRUKTURIERT).toBeLessThanOrEqual(Math.ceil(maximalMoegliche));
	});
});

describe('auftragsFrist — eine Frist je Auftrag (4.5)', () => {
	it('gibt dem Auftrag den Verfall minus 60 s Sicherheit und wird nie negativ', () => {
		let jetzt = 1_000_000;
		const frist = auftragsFrist(1_000_000, () => jetzt);
		expect(frist.restMs()).toBe(540_000);
		jetzt += 500_000;
		expect(frist.restMs()).toBe(40_000);
		jetzt += 100_000;
		expect(frist.restMs()).toBe(0);
	});

	it('ein Signal bekommt hoechstens sein eigenes Limit und hoechstens die Restzeit', () => {
		const zeit = vi.spyOn(AbortSignal, 'timeout');
		try {
			let jetzt = 0;
			const frist = auftragsFrist(0, () => jetzt);
			frist.signal(120_000);
			expect(zeit).toHaveBeenLastCalledWith(120_000);
			jetzt = 500_000;
			frist.signal(120_000);
			expect(zeit).toHaveBeenLastCalledWith(40_000);
			jetzt = 700_000;
			frist.signal(120_000);
			expect(zeit).toHaveBeenLastCalledWith(0);
		} finally {
			zeit.mockRestore();
		}
	});

	it('das Signal endet mit dem Auftrag (AbortError) — und an der Frist (TimeoutError)', async () => {
		const auftrag = new AbortController();
		const imAuftrag = auftragsFrist(0, () => 0).signal(120_000, auftrag.signal);
		expect(imAuftrag.aborted).toBe(false);
		auftrag.abort();
		expect(imAuftrag.aborted).toBe(true);
		expect((imAuftrag.reason as DOMException).name).toBe('AbortError');

		const vorbei = auftragsFrist(0, () => 600_000).signal(120_000);
		await new Promise((r) => setTimeout(r, 20));
		expect(vorbei.aborted).toBe(true);
		expect((vorbei.reason as DOMException).name).toBe('TimeoutError');
	});
});

describe('Die Summe eines Auftrags (4.5)', () => {
	const FRIST_MS = (AUFTRAG_VERFAELLT_SEKUNDEN - AUFTRAG_SICHERHEIT_SEKUNDEN) * 1000;

	// Ohne gemeinsame Frist addierten sich die Einzelfristen: OCR 60 + Mac 480 + Reserve 480 +
	// Kategorien 120 + Nachfrage 120 = 1260 s gegen 600 s Verfall. pg-boss startete den Auftrag
	// neu, waehrend seine Kategorie-Fragen noch liefen — zwei Anfragen gleichzeitig am Mac.
	it('ohne gemeinsame Frist reichte der Verfall nicht', () => {
		const einzeln = MAX_OCR_ZEITLIMIT_MS + 2 * MAX_ZEITLIMIT_MS + 2 * KATEGORIEN_ZEITLIMIT_MS;
		expect(einzeln).toBe(1_260_000);
		expect(einzeln).toBeGreaterThan(AUFTRAG_VERFAELLT_SEKUNDEN * 1000);
	});

	// Mit Frist endet alles, was ein Modell fragt (Mac, Reserve, Bildweg, Kategorien), spaetestens
	// an ihr. Danach laufen hoechstens ZWEI Matrix-Meldungen: eine aus dem Umschalten („Reserve
	// liest ab jetzt" / „Mac wieder da" / „Monatsgrenze") und eine aus dem Worker (Alarm
	// „Extraktion fehlgeschlagen" ODER „konnte nicht ausgelesen werden"). Dazu nur DB-Schreibungen.
	it('mit Frist endet der schlimmste Auftrag vor dem Verfall', () => {
		const schlimmsterFall = FRIST_MS + 2 * MATRIX_ZEITLIMIT_MS;
		expect(schlimmsterFall).toBe(560_000);
		expect(schlimmsterFall).toBeLessThan(AUFTRAG_VERFAELLT_SEKUNDEN * 1000);
	});

	it('ohne Reserve passt der langsamste Weg schon ungekuerzt in die Frist', () => {
		expect(MAX_OCR_ZEITLIMIT_MS + MAX_ZEITLIMIT_MS).toBeLessThanOrEqual(FRIST_MS);
	});

	it('Reserve und Nachfrage beginnen nur mit genug Restzeit — die Nachfrage nur mit ihrem vollen Zeitlimit', () => {
		expect(RESERVE_MINDEST_REST_MS).toBe(60_000);
		expect(NACHFRAGE_MINDEST_REST_MS).toBe(KATEGORIEN_ZEITLIMIT_MS);
	});
});
