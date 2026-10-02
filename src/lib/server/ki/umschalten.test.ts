import { describe, it, expect, vi } from 'vitest';
import {
	ReserveGestoert,
	istNichtErreichbar,
	grundText,
	modellAufrufMitReserve,
	hauptErreichbar,
	hauptPruefen,
	type Leser,
	type UmschaltDeps
} from './umschalten';
import { ExtractionHttpError, ExtractionSchemaError, ExtractionTruncatedError } from '$lib/server/extraction/types';
import { BonUnlesbarError, OcrWerkzeugKaputtError, type TextModellAntwort, type TextModellZiel } from '$lib/server/extraction/ocr-text-provider';
import { BildwegNichtFreigegeben, KiKonfigurationFehler, KiSchluesselUnlesbar } from './fehler';
import { pruefeOcrQualitaet } from '$lib/server/ocr/qualitaet';

const zeitueber = () => new DOMException('Zeit', 'TimeoutError');
const keineVerbindung = () => new TypeError('fetch failed');

describe('istNichtErreichbar — nur „der Mac ist weg", nicht „der Bon ist schlecht"', () => {
	it('erkennt Verbindungsabbruch, Zeitueberschreitung, 503 und 429', () => {
		expect(istNichtErreichbar(keineVerbindung())).toBe(true);
		expect(istNichtErreichbar(zeitueber())).toBe(true);
		expect(istNichtErreichbar(new ExtractionHttpError(503, 'x'))).toBe(true);
		expect(istNichtErreichbar(new ExtractionHttpError(429, 'x'))).toBe(true);
	});

	// Abschlusspruefung 02.10.: der Mac sitzt hinter HTTPS — ist der MLX-Prozess tot, antwortet
	// der Vorbau mit 502/504. Genau der Ausfall, fuer den es die Reserve gibt.
	it('erkennt auch Gateway-Fehler (502, 504) als „Mac weg“', () => {
		expect(istNichtErreichbar(new ExtractionHttpError(502, 'x'))).toBe(true);
		expect(istNichtErreichbar(new ExtractionHttpError(504, 'x'))).toBe(true);
	});

	it('schaltet bei einem Abbruch von aussen NICHT um (Worker faehrt herunter)', () => {
		expect(istNichtErreichbar(new DOMException('weg', 'AbortError'))).toBe(false);
	});

	it('schaltet bei Konfigurations-, OCR-, Schema- und sonstigen Fehlern nicht um', () => {
		expect(istNichtErreichbar(new ExtractionHttpError(500, 'x'))).toBe(false);
		expect(istNichtErreichbar(new ExtractionHttpError(401, 'x'))).toBe(false);
		expect(istNichtErreichbar(new KiSchluesselUnlesbar('x'))).toBe(false);
		expect(istNichtErreichbar(new BildwegNichtFreigegeben('x'))).toBe(false);
		expect(istNichtErreichbar(new OcrWerkzeugKaputtError('weg', null, true))).toBe(false);
		expect(istNichtErreichbar(new BonUnlesbarError('', pruefeOcrQualitaet('')))).toBe(false);
		expect(istNichtErreichbar(new ExtractionSchemaError('x', {}))).toBe(false);
		expect(istNichtErreichbar(new ExtractionTruncatedError('x', null))).toBe(false);
		expect(istNichtErreichbar(new Error('fetch failed'))).toBe(false);
	});
});

describe('grundText', () => {
	it('nennt den Grund in Worten', () => {
		expect(grundText(zeitueber())).toBe('Zeitüberschreitung');
		expect(grundText(keineVerbindung())).toBe('keine Verbindung');
		expect(grundText(new ExtractionHttpError(503, 'x'))).toBe('HTTP 503');
		expect(grundText(new ExtractionHttpError(429, 'x'))).toBe('HTTP 429');
	});
});

const ANTWORT = (wer: string): TextModellAntwort => ({
	receipt: { merchantName: wer } as never,
	usage: null,
	raw: {},
	servedModel: null,
	warnings: []
});

function ziel(id: string): TextModellZiel {
	return { id, baseUrl: `http://${id}.invalid/v1`, apiKey: '', model: id };
}

function leser(rolle: 'haupt' | 'reserve', zielFn?: () => TextModellZiel): Leser {
	return {
		rolle,
		name: rolle === 'haupt' ? 'Mac' : 'Abacus Reserve',
		modell: rolle,
		kiAnbieterId: rolle === 'haupt' ? null : 'r1',
		preise: { einMicro: 1, ausMicro: 1 },
		ziel: zielFn ?? (() => ziel(rolle))
	};
}

function aufbau(opts: {
	aktivSeit?: Date | null;
	grenze?: boolean;
	haupt?: (z: TextModellZiel) => Promise<TextModellAntwort>;
	reserve?: (z: TextModellZiel) => Promise<TextModellAntwort>;
	reserveZiel?: () => TextModellZiel;
	/** Was umschalten meldet: true = die Reserve darf jetzt lesen. */
	darfReserve?: boolean;
}) {
	const gefragt: string[] = [];
	const gemerkt: string[] = [];
	const frage = vi.fn(async (z: TextModellZiel, text: string, _q?: unknown, _signal?: AbortSignal) => {
		gefragt.push(`${z.id}:${text}`);
		if (z.id === 'haupt') return (opts.haupt ?? (async () => ANTWORT('haupt')))(z);
		return (opts.reserve ?? (async () => ANTWORT('reserve')))(z);
	});
	const deps: UmschaltDeps = {
		reserveAktivSeit: vi.fn(async () => opts.aktivSeit ?? null),
		grenzeErreicht: vi.fn(async () => opts.grenze ?? false),
		umschalten: vi.fn(async () => opts.darfReserve ?? true),
		zurueckschalten: vi.fn(async () => {}),
		grenzeMelden: vi.fn(async () => {}),
		frage
	};
	const aufruf = modellAufrufMitReserve(leser('haupt'), leser('reserve', opts.reserveZiel), deps, (l) => gemerkt.push(l.rolle));
	return { aufruf, deps, gefragt, gemerkt, frage };
}

const Q = pruefeOcrQualitaet('Milch 1,29\nSumme 1,29\n01.01.2026');

describe('modellAufrufMitReserve', () => {
	it('fragt nur den Mac, wenn er antwortet', async () => {
		const a = aufbau({});
		const r = await a.aufruf('TEXT', Q, undefined);
		expect(r.receipt.merchantName).toBe('haupt');
		expect(a.gefragt).toEqual(['haupt:TEXT']);
		expect(a.gemerkt).toEqual(['haupt']);
		expect(a.deps.umschalten).not.toHaveBeenCalled();
	});

	it('schaltet bei Zeitueberschreitung um und gibt DENSELBEN Text an die Reserve', async () => {
		const a = aufbau({ haupt: async () => Promise.reject(zeitueber()) });
		const r = await a.aufruf('TEXT', Q, undefined);
		expect(r.receipt.merchantName).toBe('reserve');
		expect(a.deps.umschalten).toHaveBeenCalledTimes(1);
		expect(a.deps.umschalten).toHaveBeenCalledWith('Zeitüberschreitung');
		expect(a.gefragt).toEqual(['haupt:TEXT', 'reserve:TEXT']);
		expect(a.gemerkt.at(-1)).toBe('reserve');
	});

	it('fragt den Mac gar nicht, solange die Reserve aktiv ist', async () => {
		const a = aufbau({ aktivSeit: new Date() });
		const r = await a.aufruf('TEXT', Q, undefined);
		expect(r.receipt.merchantName).toBe('reserve');
		expect(a.gefragt).toEqual(['reserve:TEXT']);
		expect(a.deps.umschalten).not.toHaveBeenCalled();
	});

	it('Reserve aktiv, Grenze erreicht: meldet, fragt den Mac und schaltet zurueck, wenn er antwortet', async () => {
		const a = aufbau({ aktivSeit: new Date(), grenze: true });
		const r = await a.aufruf('TEXT', Q, undefined);
		expect(r.receipt.merchantName).toBe('haupt');
		expect(a.deps.grenzeMelden).toHaveBeenCalled();
		expect(a.deps.zurueckschalten).toHaveBeenCalledWith('Mac antwortete im Auftrag');
		expect(a.gefragt).toEqual(['haupt:TEXT']);
	});

	it('Reserve aktiv, Grenze erreicht, Mac weg: Fehler, die Reserve wird nicht gefragt', async () => {
		const fehler = keineVerbindung();
		const a = aufbau({ aktivSeit: new Date(), grenze: true, haupt: async () => Promise.reject(fehler) });
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
		expect(a.gefragt).toEqual(['haupt:TEXT']);
		expect(a.deps.umschalten).not.toHaveBeenCalled();
	});

	it('Mac weg, Grenze erreicht: meldet die Grenze, wirft, schaltet nicht um', async () => {
		const fehler = new ExtractionHttpError(503, 'x');
		const a = aufbau({ grenze: true, haupt: async () => Promise.reject(fehler) });
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
		expect(a.deps.grenzeMelden).toHaveBeenCalled();
		expect(a.deps.umschalten).not.toHaveBeenCalled();
		expect(a.gefragt).toEqual(['haupt:TEXT']);
	});

	it('Abbruch von aussen und Schemafehler werden durchgereicht, ohne umzuschalten', async () => {
		for (const fehler of [new DOMException('weg', 'AbortError'), new ExtractionSchemaError('x', {})]) {
			const a = aufbau({ haupt: async () => Promise.reject(fehler) });
			await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
			expect(a.deps.umschalten).not.toHaveBeenCalled();
		}
	});

	// Abschlusspruefung 02.10.: eine KAPUTTE Reserve (Schluessel widerrufen, Guthaben leer, Modell
	// umbenannt, Abacus gestoert) darf einen Bon nicht endgueltig scheitern lassen — ohne Reserve
	// haette er auf den Mac gewartet. Ihre Stoerung wird voruebergehend (KiKonfigurationFehler).
	it('macht aus einer gestoerten Reserve einen voruebergehenden Fehler', async () => {
		for (const fehler of [keineVerbindung(), zeitueber(), new ExtractionHttpError(401, 'x'), new ExtractionHttpError(402, 'x'), new ExtractionHttpError(404, 'x'), new ExtractionHttpError(500, 'x')]) {
			const a = aufbau({ aktivSeit: new Date(), reserve: async () => Promise.reject(fehler) });
			const f = await a.aufruf('TEXT', Q, undefined).catch((e: unknown) => e);
			expect(f, String(fehler)).toBeInstanceOf(ReserveGestoert);
			expect(f).toBeInstanceOf(KiKonfigurationFehler);
			expect((f as Error).cause).toBe(fehler);
		}
	});

	it('eine Antwort der Reserve, die nicht passt, bleibt ein Fehler des Bons', async () => {
		for (const fehler of [new ExtractionSchemaError('x', {}), new ExtractionTruncatedError('x', null)]) {
			const a = aufbau({ aktivSeit: new Date(), reserve: async () => Promise.reject(fehler) });
			await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
		}
	});

	it('ein Abbruch von aussen waehrend der Reserve bleibt ein Abbruch', async () => {
		const fehler = new DOMException('weg', 'AbortError');
		const a = aufbau({ aktivSeit: new Date(), reserve: async () => Promise.reject(fehler) });
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
	});

	it('auch nach dem Umschalten wird eine gestoerte Reserve voruebergehend', async () => {
		const a = aufbau({ haupt: async () => Promise.reject(zeitueber()), reserve: async () => Promise.reject(keineVerbindung()) });
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBeInstanceOf(ReserveGestoert);
		expect(a.deps.umschalten).toHaveBeenCalledTimes(1);
	});

	// Abschlusspruefung 02.10.: wurde die Reserve entfernt (oder eine andere festgelegt), waehrend
	// der Mac-Aufruf hing, darf der Text NICHT mehr an die alte Karte gehen.
	it('fragt die Reserve nicht, wenn das Umschalten sie nicht (mehr) erlaubt', async () => {
		const fehler = zeitueber();
		const a = aufbau({ haupt: async () => Promise.reject(fehler), darfReserve: false });
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBe(fehler);
		expect(a.gefragt).toEqual(['haupt:TEXT']);
	});

	it('ein unlesbarer Reserve-Schluessel kommt laut durch', async () => {
		const a = aufbau({
			aktivSeit: new Date(),
			reserveZiel: () => {
				throw new KiSchluesselUnlesbar('Schluessel weg');
			}
		});
		await expect(a.aufruf('TEXT', Q, undefined)).rejects.toBeInstanceOf(KiSchluesselUnlesbar);
	});

	it('gibt das Signal an den Modellaufruf weiter', async () => {
		const a = aufbau({});
		const signal = new AbortController().signal;
		await a.aufruf('TEXT', Q, signal);
		expect(a.frage.mock.calls[0][3]).toBe(signal);
	});
});

describe('hauptErreichbar', () => {
	it('fragt /models mit dem Schluessel und nimmt 2xx als erreichbar', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
		expect(await hauptErreichbar({ ...ziel('mac'), apiKey: 'k1' }, fetchImpl)).toBe(true);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('http://mac.invalid/v1/models');
		expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k1');
	});

	it('503 und ein werfendes fetch sind nicht erreichbar', async () => {
		expect(await hauptErreichbar(ziel('mac'), vi.fn<typeof fetch>(async () => new Response('', { status: 503 })))).toBe(false);
		expect(await hauptErreichbar(ziel('mac'), vi.fn<typeof fetch>(async () => Promise.reject(keineVerbindung())))).toBe(false);
	});
});

describe('hauptPruefen — der Zeitplan-Auftrag', () => {
	it('tut nichts, solange die Reserve nicht aktiv ist', async () => {
		const probe = vi.fn(async () => true);
		const zurueckschalten = vi.fn(async () => {});
		expect(await hauptPruefen({ reserveAktivSeit: async () => null, probe, zurueckschalten })).toBe('nichts');
		expect(probe).not.toHaveBeenCalled();
	});

	it('schaltet zurueck, wenn der Mac antwortet', async () => {
		const zurueckschalten = vi.fn(async () => {});
		expect(await hauptPruefen({ reserveAktivSeit: async () => new Date(), probe: async () => true, zurueckschalten })).toBe('zurueck');
		expect(zurueckschalten).toHaveBeenCalledWith('Zeitplan');
	});

	it('bleibt bei der Reserve, wenn der Mac nicht antwortet', async () => {
		const zurueckschalten = vi.fn(async () => {});
		expect(await hauptPruefen({ reserveAktivSeit: async () => new Date(), probe: async () => false, zurueckschalten })).toBe('weiter');
		expect(zurueckschalten).not.toHaveBeenCalled();
	});
});
