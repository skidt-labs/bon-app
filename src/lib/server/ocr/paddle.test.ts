import { describe, it, expect } from 'vitest';
import { erzeugePaddleOcrAnbieter, alsProzent, PADDLE_ZEITLIMIT_MS } from './paddle';

type Erkennung = { text: string; confidence: number; box: [number, number, number, number] };

function dienstGibt(
	erkennungen: Erkennung[],
	zusatz?: Record<string, unknown>
): typeof fetch {
	return (async () =>
		new Response(
			JSON.stringify({
				erkennungen,
				durationMs: 4200,
				engineVersion: '2.9.1',
				options: { sprache: 'german', detLimitSideLen: 8000, detLimitType: 'max' },
				...zusatz
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as unknown as typeof fetch;
}

const ZWEI: Erkennung[] = [
	{ text: 'Bioland Broccoli', confidence: 0.97, box: [10, 20, 200, 30] },
	{ text: '2,29 A', confidence: 0.93, box: [300, 22, 80, 28] }
];

describe('paddleOcrAnbieter', () => {
	it('heisst paddleocr', () => {
		expect(erzeugePaddleOcrAnbieter().name).toBe('paddleocr');
	});

	it('setzt den Text aus den Erkennungen zusammen — eine Erkennung, eine Zeile', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet: ' + ergebnis.status);
		expect(ergebnis.text).toBe('Bioland Broccoli\n2,29 A');
	});

	// Der wichtigste Test dieser Datei. PaddleOCR meldet 0..1, Tesseract 0..100 — beide
	// landen in DEMSELBEN Feld. Unumgerechnet stuende 0,97 ("fast wertlos") neben 96
	// ("sehr sicher"), und jeder Mittelwert ueber beide Engines waere still unsinnig.
	it('rechnet die Confidence auf Tesseracts Skala um (0..1 -> 0..100)', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies(Buffer.from('bild'), { mitBoxen: true });

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.zeilen?.[0].confidence).toBeCloseTo(97);
		expect(ergebnis.woerter?.[1].confidence).toBeCloseTo(93);
		expect(alsProzent(0.5)).toBe(50);
	});

	it('gibt ohne mitBoxen keine Zeilen und keine Woerter zurueck', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.zeilen).toBeUndefined();
		expect(ergebnis.woerter).toBeUndefined();
	});

	it('uebernimmt Rahmen und Version unveraendert', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies(Buffer.from('bild'), { mitBoxen: true });

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.zeilen?.[0].box).toEqual([10, 20, 200, 30]);
		expect(ergebnis.engineVersion).toBe('2.9.1');
	});

	// Die Groessengrenze steht FEST im Dienst (Auflage 2). Sie hier nochmal zu setzen
	// waere die Gelegenheit, unter der falschen Bedingung zu messen — stattdessen wird
	// uebernommen, was der Dienst meldet, und landet so in extraction_runs.ocr_options.
	it('uebernimmt die Optionen des Dienstes, statt eigene zu behaupten', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		expect(ergebnis.options).toEqual({
			sprache: 'german',
			detLimitSideLen: 8000,
			detLimitType: 'max',
			mitBoxen: false
		});
	});

	it('meldet nichtsGefunden bei einer leeren Erkennungsliste', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt([]) });

		const ergebnis = await anbieter.lies(Buffer.from('leer'));

		expect(ergebnis.status).toBe('nichtsGefunden');
		expect(ergebnis.engine).toBe('paddleocr');
	});

	// Ein Kasten ohne Text ist keine Zeile. Wuerde er eine, entstuenden Leerzeilen im
	// Text, den das Modell zu sehen bekommt — dieselbe Regel wie bei der TSV.
	it('laesst leere Erkennungen weg, statt Leerzeilen zu erzeugen', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({
			fetchImpl: dienstGibt([
				{ text: 'Milch', confidence: 0.9, box: [0, 0, 1, 1] },
				{ text: '   ', confidence: 0.3, box: [0, 0, 1, 1] },
				{ text: '1,09', confidence: 0.9, box: [0, 0, 1, 1] }
			])
		});

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		if (ergebnis.status !== 'gelesen') throw new Error('unerwartet');
		expect(ergebnis.text).toBe('Milch\n1,09');
	});

	it('meldet werkzeugKaputt, wenn der Dienst nicht erreichbar ist', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({
			fetchImpl: (async () => {
				throw new TypeError('fetch failed');
			}) as unknown as typeof fetch
		});

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		expect(ergebnis.status).toBe('werkzeugKaputt');
		if (ergebnis.status !== 'werkzeugKaputt') return;
		expect(ergebnis.grund).toContain('nicht erreichbar');
		expect(ergebnis.durationMs).toBeGreaterThanOrEqual(0);
		// Der Dienst kann gerade starten — nach einem Host-Neustart rund drei Minuten.
		// Ohne diese Einstufung wuerden genau die Bons in diesem Fenster dauerhaft als
		// gescheitert markiert, obwohl mit ihnen nichts ist.
		expect(ergebnis.voruebergehend).toBe(true);
	});

	it('meldet werkzeugKaputt mit Status und Grund bei HTTP 500', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({
			fetchImpl: (async () =>
				new Response('{"fehler":"RuntimeError: kaputt"}', { status: 500 })) as unknown as typeof fetch
		});

		const ergebnis = await anbieter.lies(Buffer.from('bild'));

		if (ergebnis.status !== 'werkzeugKaputt') throw new Error('unerwartet');
		expect(ergebnis.grund).toContain('HTTP 500');
		expect(ergebnis.grund).toContain('RuntimeError');
		expect(ergebnis.voruebergehend).toBe(true);
	});

	// 4xx liegt an der Anfrage selbst — die ist beim naechsten Versuch dieselbe, und
	// ein Wiederholen verbrennt nur Wiederholungsbudget.
	it('stuft 4xx als dauerhaft ein, 5xx als voruebergehend', async () => {
		for (const [status, erwartet] of [
			[413, false],
			[400, false],
			[500, true],
			[503, true]
		] as const) {
			const anbieter = erzeugePaddleOcrAnbieter({
				fetchImpl: (async () => new Response('{}', { status })) as unknown as typeof fetch
			});
			const ergebnis = await anbieter.lies(Buffer.from('bild'));
			if (ergebnis.status !== 'werkzeugKaputt') throw new Error('unerwartet');
			expect(ergebnis.voruebergehend, String(status)).toBe(erwartet);
		}
	});

	// Der Dienst laeuft in einem eigenen Container und sieht das Dateisystem des
	// Workers nicht. Ein Pfad waere dort schlicht nicht da — als Fehler sichtbar besser
	// als ein stiller Leerlauf.
	it('lehnt einen Dateipfad ausdruecklich ab, statt ins Leere zu laufen', async () => {
		const anbieter = erzeugePaddleOcrAnbieter({ fetchImpl: dienstGibt(ZWEI) });

		const ergebnis = await anbieter.lies('/bilder/bon.webp');

		if (ergebnis.status !== 'werkzeugKaputt') throw new Error('unerwartet');
		expect(ergebnis.grund).toContain('Bildpuffer');
		// Ein Programmierfehler im Aufrufer waere beim naechsten Versuch derselbe.
		expect(ergebnis.voruebergehend).toBe(false);
	});

	it('schickt den Puffer unveraendert an /ocr', async () => {
		let gesehen: { url: string; body: unknown } | undefined;
		const anbieter = erzeugePaddleOcrAnbieter({
			baseUrl: 'http://dienst:8000/',
			fetchImpl: (async (url: string, init: RequestInit) => {
				gesehen = { url, body: init.body };
				return new Response(JSON.stringify({ erkennungen: [], durationMs: 1, options: {} }), {
					status: 200
				});
			}) as unknown as typeof fetch
		});

		await anbieter.lies(Buffer.from('bilddaten'));

		// Der abschliessende Schraegstrich der Basis-Adresse darf keinen doppelten
		// erzeugen — sonst antwortet FastAPI mit 404 und es saehe wie ein kaputter
		// Dienst aus.
		expect(gesehen?.url).toBe('http://dienst:8000/ocr');
		expect(Buffer.from(gesehen?.body as Uint8Array).toString()).toBe('bilddaten');
	});

	// Gemessen an allen neun echten Bons: 3,7 s bis 15,6 s. Die Grenze soll einen
	// regulaeren Lauf nie treffen — mit Abstand, nicht knapp.
	it('haelt beim Zeitlimit deutlichen Abstand zum gemessenen Spitzenwert', () => {
		expect(PADDLE_ZEITLIMIT_MS).toBeGreaterThanOrEqual(15_600 * 3);
	});
});
