import { describe, it, expect } from 'vitest';
import { erzeugeTesseractAnbieter } from './anbieter';
import type { ExecFileImpl } from './lesen';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function fakeExec(stdout: string): ExecFileImpl {
	return async () => ({ stdout, stderr: '' });
}

describe('tesseractAnbieter', () => {
	it('heisst tesseract', () => {
		expect(erzeugeTesseractAnbieter().name).toBe('tesseract');
	});

	// Der Kern (`ocrLesen`) bleibt unveraendert; die Huelle legt die Metadaten dazu.
	// Deshalb muss der Text ZEICHENGENAU derselbe sein wie ohne Huelle — sonst haette
	// die Abstraktion still veraendert, was das Modell zu sehen bekommt.
	it('liefert denselben Text wie der ungekapselte Aufruf', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec('  Bioland Broccoli 2,29 A\n\n') });

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		expect(ergebnis.status).toBe('gelesen');
		if (ergebnis.status !== 'gelesen') return;
		expect(ergebnis.text).toBe('Bioland Broccoli 2,29 A');
	});

	it('legt Engine, Dauer und uebergebene Optionen dazu', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec('Text') });

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		expect(ergebnis.engine).toBe('tesseract');
		expect(ergebnis.durationMs).toBeGreaterThanOrEqual(0);
		// Was der Engine wirklich uebergeben wurde — spaeter in extraction_runs.ocr_options,
		// damit nachvollziehbar bleibt, unter welchen Bedingungen ein Bon gelesen wurde.
		expect(ergebnis.options).toEqual({ sprache: 'deu', psm: 6, mitBoxen: false });
	});

	it('reicht den Dreizustand unveraendert durch: nichtsGefunden', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec('   \n  ') });

		const ergebnis = await anbieter.lies('/bilder/leer.webp');

		expect(ergebnis.status).toBe('nichtsGefunden');
		expect(ergebnis.engine).toBe('tesseract');
	});

	it('reicht den Dreizustand unveraendert durch: werkzeugKaputt mit Grund', async () => {
		const enoent: NodeJS.ErrnoException = new Error('spawn tesseract ENOENT');
		enoent.code = 'ENOENT';
		const anbieter = erzeugeTesseractAnbieter({
			execFileImpl: async () => {
				throw enoent;
			}
		});

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		expect(ergebnis.status).toBe('werkzeugKaputt');
		if (ergebnis.status !== 'werkzeugKaputt') return;
		expect(ergebnis.grund).toContain('nicht installiert');
		// Auch im Fehlerfall messbar: wie lange es gedauert hat, bis es schieflief.
		expect(ergebnis.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('reicht einen Puffer durch, ohne eine temporaere Datei anzulegen', async () => {
		let gesehen: { args: string[]; stdin?: Buffer } | undefined;
		const anbieter = erzeugeTesseractAnbieter({
			execFileImpl: async (_file, args, _opts, stdin) => {
				gesehen = { args, stdin };
				return { stdout: 'Text', stderr: '' };
			}
		});

		await anbieter.lies(Buffer.from('bilddaten'));

		expect(gesehen?.args[0]).toBe('-');
		expect(gesehen?.stdin?.toString()).toBe('bilddaten');
	});

	// Umlaute und deutsche Dezimaltrennzeichen duerfen den Weg durch die Huelle nicht
	// veraendern — an genau dieser Stelle waere ein Zeichensatz-Fehler unsichtbar und
	// wuerde erst spaeter als falsch gelesener Betrag auffallen.
	it('laesst Umlaute und Komma-Betraege unveraendert', async () => {
		const roh = 'Crème Fraîche Natur 0,99 x 2 1,98 A\nGröße: 3XL\nZu zahlen 13,61';
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec(roh) });

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		expect(ergebnis.status).toBe('gelesen');
		if (ergebnis.status !== 'gelesen') return;
		expect(ergebnis.text).toBe(roh);
	});

	it('gibt ohne mitBoxen keine Zeilen und keine Woerter zurueck', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec('Text') });

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.zeilen).toBeUndefined();
		expect(ergebnis.woerter).toBeUndefined();
	});
});

describe('tesseractAnbieter mit Boxen', () => {
	const tsv = readFileSync(join('tests', 'fixtures', 'ocr', 'lidl-kurz-448px.tsv'), 'utf8');
	const erwartet = readFileSync(
		join('tests', 'fixtures', 'ocr', 'lidl-kurz-448px.tsv.erwartet.txt'),
		'utf8'
	).trimEnd();

	it('haengt "tsv" ans Ende der Argumente — die Ausgabeform ist bei tesseract eine Konfigurationsangabe, kein Schalter', async () => {
		let gesehen: string[] | undefined;
		const anbieter = erzeugeTesseractAnbieter({
			execFileImpl: async (_f, args) => {
				gesehen = args;
				return { stdout: tsv, stderr: '' };
			}
		});

		await anbieter.lies('/bilder/bon.webp', { mitBoxen: true });

		expect(gesehen).toEqual(['/bilder/bon.webp', 'stdout', '-l', 'deu', '--psm', '6', 'tsv']);
	});

	// Der Kern der Sache: aus TSV zusammengebauter Text MUSS derselbe sein wie der aus
	// `stdout`. Am 2026-09-15 an sechs echten Bons gemessen — 1251, 1467, 2032, 1942,
	// 1703 und 187 Zeichen, jeweils zeichengenau gleich. Dieser Test friert die
	// Zusammenbau-Regel ein, damit sie nicht spaeter still abdriftet.
	it('baut aus TSV zeichengenau denselben Text zusammen', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec(tsv) });

		const ergebnis = await anbieter.lies('/bilder/bon.webp', { mitBoxen: true });

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet: ' + ergebnis.status);
		expect(ergebnis.text).toBe(erwartet);
	});

	it('liefert Zeilen mit Rahmen und Confidence', async () => {
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec(tsv) });

		const ergebnis = await anbieter.lies('/bilder/bon.webp', { mitBoxen: true });

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.zeilen?.length).toBe(erwartet.split('\n').length);
		const broccoli = ergebnis.zeilen?.find((z) => z.text.includes('Broccoli'));
		expect(broccoli).toBeDefined();
		expect(broccoli!.box).toHaveLength(4);
		expect(broccoli!.box.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
		expect(broccoli!.confidence).toBeGreaterThan(0);
		expect(ergebnis.woerter?.length).toBeGreaterThan(ergebnis.zeilen!.length);
	});

	// Tesseract schreibt -1 in die Confidence-Spalte, wo es keine hat. -1 als Zahl
	// durchzureichen hiesse "sehr unsicher" zu behaupten, wo in Wahrheit gar keine
	// Angabe vorliegt — null ist die Leerstelle, -1 waere eine Behauptung.
	it('macht aus Confidence -1 ein null, keine negative Zahl', async () => {
		const kopf =
			'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
		const eigen = [kopf, '5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t-1\tText'].join('\n');
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec(eigen) });

		const ergebnis = await anbieter.lies('/bilder/bon.webp', { mitBoxen: true });

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.woerter?.[0].confidence).toBeNull();
	});

	it('liefert nichtsGefunden bei einer TSV ohne ein einziges Wort', async () => {
		const kopf =
			'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
		const leer = [kopf, '1\t1\t0\t0\t0\t0\t0\t0\t448\t2048\t-1\t'].join('\n');
		const anbieter = erzeugeTesseractAnbieter({ execFileImpl: fakeExec(leer) });

		const ergebnis = await anbieter.lies('/bilder/leer.webp', { mitBoxen: true });

		expect(ergebnis.status).toBe('nichtsGefunden');
	});
});
