import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { TESTBON_TEXT, TESTBON_SUMME_CENTS } from './text';
import { testbonBild } from './bild';
import { pruefeOcrQualitaet } from '$lib/server/ocr/qualitaet';

describe('Erfundener Testbon', () => {
	it('besteht die OCR-Qualitaetspruefung — sonst meldete jeder Textweg-Test „unlesbar"', () => {
		expect(pruefeOcrQualitaet(TESTBON_TEXT).brauchbar).toBe(true);
	});
	it('traegt seine Summe im Text', () => {
		expect(TESTBON_SUMME_CENTS).toBe(1037);
		expect(TESTBON_TEXT).toContain('10,37');
	});
	it('ist erkennbar erfunden', () => {
		expect(TESTBON_TEXT).toContain('TESTMARKT');
	});
	it('liefert ein PNG fuer den Bildweg', async () => {
		const meta = await sharp(await testbonBild()).metadata();
		expect(meta.format).toBe('png');
		expect(meta.width).toBeGreaterThan(200);
	});
});
