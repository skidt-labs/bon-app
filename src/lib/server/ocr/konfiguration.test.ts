import { describe, it, expect } from 'vitest';
import { ocrEngineAusEnv, mitBoxenAusEnv, waehleOcrAnbieter, paddleUrlAusEnv } from './konfiguration';

describe('ocrEngineAusEnv', () => {
	it('nimmt tesseract, wenn nichts gesetzt ist', () => {
		expect(ocrEngineAusEnv(undefined)).toBe('tesseract');
		expect(ocrEngineAusEnv('')).toBe('tesseract');
		expect(ocrEngineAusEnv('   ')).toBe('tesseract');
	});

	it('nimmt einen ausdruecklich gesetzten bekannten Wert', () => {
		expect(ocrEngineAusEnv('tesseract')).toBe('tesseract');
		expect(ocrEngineAusEnv(' TESSERACT ')).toBe('tesseract');
	});

	// Bis Etappe 3 warf dieser Leser bei paddleocr ausdruecklich — "lieber laut
	// scheitern als stillschweigend Tesseract nehmen und den Betreiber glauben lassen,
	// er messe PaddleOCR". Seit der Dienst steht, ist es ein gueltiger Wert. Die Regel
	// dahinter bleibt und wird weiter unten geprueft: kein stiller Rueckfall.
	it('nimmt paddleocr, seit der Dienst angeschlossen ist', () => {
		expect(ocrEngineAusEnv('paddleocr')).toBe('paddleocr');
		expect(ocrEngineAusEnv(' PaddleOCR ')).toBe('paddleocr');
	});

	it('scheitert laut bei einem unbekannten Wert und nennt die gueltigen', () => {
		for (const murks of ['tesserakt', 'paddle', 'easyocr', 'true', '1']) {
			expect(() => ocrEngineAusEnv(murks), murks).toThrow(/OCR_PROVIDER/);
		}
		expect(() => ocrEngineAusEnv('easyocr')).toThrow(/tesseract/);
	});
});

describe('mitBoxenAusEnv', () => {
	it('ist standardmaessig aus', () => {
		expect(mitBoxenAusEnv(undefined)).toBe(false);
		expect(mitBoxenAusEnv('')).toBe(false);
	});

	it('versteht true und false', () => {
		expect(mitBoxenAusEnv('true')).toBe(true);
		expect(mitBoxenAusEnv(' TRUE ')).toBe(true);
		expect(mitBoxenAusEnv('false')).toBe(false);
	});

	// "1", "yes", "ja" sehen aus wie ein Ja und waeren hier ein stilles Nein.
	// Lieber laut scheitern, als eine Einstellung zu verschlucken, die jemand
	// ausdruecklich vorgenommen hat.
	it('scheitert laut bei allem, was nur nach true aussieht', () => {
		for (const murks of ['1', '0', 'yes', 'ja', 'on', 'wahr']) {
			expect(() => mitBoxenAusEnv(murks), murks).toThrow(/OCR_INCLUDE_BOXES/);
		}
	});
});

describe('paddleUrlAusEnv', () => {
	it('nimmt den Nachbarcontainer, wenn nichts gesetzt ist', () => {
		expect(paddleUrlAusEnv(undefined)).toBe('http://bon-paddleocr:8000');
		expect(paddleUrlAusEnv('  ')).toBe('http://bon-paddleocr:8000');
	});

	it('nimmt eine ausdruecklich gesetzte Adresse', () => {
		expect(paddleUrlAusEnv('http://192.0.2.5:8000')).toBe('http://192.0.2.5:8000');
	});

	// Eine unbrauchbare Adresse still durch den Standard zu ersetzen hiesse: der
	// Betreiber misst gegen einen Dienst, den er gar nicht gemeint hat.
	it('scheitert laut bei etwas, das keine Adresse ist', () => {
		expect(() => paddleUrlAusEnv('bon-paddleocr:8000')).toThrow(/OCR_PADDLE_URL/);
		expect(() => paddleUrlAusEnv('///')).toThrow(/OCR_PADDLE_URL/);
	});
});

describe('waehleOcrAnbieter', () => {
	it('liefert bei Standardkonfiguration den Tesseract-Anbieter', () => {
		expect(waehleOcrAnbieter('tesseract').name).toBe('tesseract');
	});

	it('liefert fuer paddleocr den PaddleOCR-Anbieter', () => {
		expect(waehleOcrAnbieter('paddleocr').name).toBe('paddleocr');
	});

	// Die eigentliche Zusicherung: die gewaehlte Engine ist die, die laeuft. Ein
	// Rueckfall auf Tesseract waere hier unsichtbar und machte jede Messung wertlos.
	it('faellt bei paddleocr NICHT auf Tesseract zurueck', () => {
		expect(waehleOcrAnbieter('paddleocr').name).not.toBe('tesseract');
	});
});
