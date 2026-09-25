import { describe, it, expect } from 'vitest';
import { AUFTRAG_VERFAELLT_SEKUNDEN, MAX_ZEITLIMIT_MS, MAX_OCR_ZEITLIMIT_MS } from './fristen';
import { MAX_TOKENS_STRUKTURIERT } from '../extraction/ocr-text-provider';
import { OCR_ZEITLIMIT_MS } from '../ocr/lesen';
import { PADDLE_ZEITLIMIT_MS } from '../ocr/paddle';

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
