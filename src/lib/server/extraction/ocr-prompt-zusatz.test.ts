import { describe, it, expect } from 'vitest';
import { OCR_PROMPT_ZUSATZ, OCR_PROMPT_ZUSATZ_RANDPREIS } from './ocr-prompt-zusatz';

/*
 * Abschlusspruefung 0.12.0, Wichtig 3: der gemessene Block bleibt im Wortlaut wie vor 0.12.0;
 * die Regel zum Randpreis steht in einer eigenen Konstante (wie der Pfand-Zusatz) und
 * verbietet NICHT den Betrag einer eigenen Mengen- oder Gewichtszeile unter dem Artikel —
 * sonst verloere ein Gewichtsartikel („0,756 kg x 1,19 EUR/kg  0,90" unter dem Namen) seinen Preis.
 */
describe('Prompt-Zusatz Randpreis', () => {
	it('der gemessene Block enthaelt die neue Regel nicht', () => {
		expect(OCR_PROMPT_ZUSATZ).not.toContain('WELCHER BETRAG DER PREIS IST');
	});

	it('die Regel steht fuer sich und laesst die eigene Mengen-/Gewichtszeile zu', () => {
		expect(OCR_PROMPT_ZUSATZ_RANDPREIS).toContain('ganz rechts');
		expect(OCR_PROMPT_ZUSATZ_RANDPREIS).toContain('eigene Mengen- oder Gewichtszeile');
		expect(OCR_PROMPT_ZUSATZ_RANDPREIS).not.toContain('nie den Betrag aus einer Nachbarzeile');
	});
});
