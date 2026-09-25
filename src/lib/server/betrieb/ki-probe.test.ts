import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';

const mocks = vi.hoisted(() => ({
	zeile: null as unknown,
	gespeichert: [] as { ok: boolean; text: string; stand: string }[],
	nochAktuell: true
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => (mocks.zeile ? [mocks.zeile] : []) }) })
	}
}));
vi.mock('./ki', () => ({
	AnbieterNichtGefunden: class extends Error {},
	testErgebnisSpeichern: vi.fn(async (_id: string, ok: boolean, text: string, _u: string, stand: string) => {
		mocks.gespeichert.push({ ok, text, stand });
		return mocks.nochAktuell;
	})
}));

import { anbieterTesten, gespeicherterSchluessel, kuerzeUndSchwaerze, modelleAbrufen } from './ki-probe';
import { TESTBON_SUMME_CENTS } from '$lib/server/ki/testbon/text';
import { verschluesseln } from '$lib/server/ki/geheimnis';

const env = { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;

function antwort(summeCents: number, modell = 'qwen') {
	// Minimal gueltige Modellantwort im Format, das ocr-text-provider.ts erwartet
	// (response_format json_schema). Felder wie in extraction/schema.ts.
	const bon = {
		merchantName: 'TESTMARKT',
		merchantAddress: null,
		purchasedAt: '2026-09-23T10:15:00',
		totalGrossCents: summeCents,
		items: [{ lineNo: 1, rawText: 'Vollmilch', lineType: 'article', quantity: 1, unitPriceCents: summeCents, totalPriceCents: summeCents, vatClass: 'A', appliesToLine: null }]
	};
	return new Response(
		JSON.stringify({
			model: modell,
			choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(bon) } }],
			usage: { prompt_tokens: 800, completion_tokens: 120 }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

const zeile = (teil: Record<string, unknown> = {}) => ({
	id: 'a1',
	name: 'MLX',
	weg: 'text',
	baseUrl: 'http://mlx.invalid/v1',
	modell: 'qwen',
	schluesselEnc: null,
	zeitlimitMs: 60_000,
	preisEinMicro: 0,
	preisAusMicro: 0,
	stand: '2026-09-23 10:00:00.123456+00',
	...teil
});

beforeEach(() => {
	mocks.gespeichert = [];
	mocks.nochAktuell = true;
	mocks.zeile = zeile();
	vi.restoreAllMocks();
});

describe('kuerzeUndSchwaerze', () => {
	it('macht den Schluessel und Bearer-Angaben unkenntlich und kuerzt auf 500 Zeichen', () => {
		const t = kuerzeUndSchwaerze(`Fehler: key sk-geheim-a3f9 abgelehnt, Authorization: Bearer abc.def ${'x'.repeat(900)}`, 'sk-geheim-a3f9');
		expect(t).not.toContain('sk-geheim');
		expect(t).not.toContain('abc.def');
		expect(t.length).toBeLessThanOrEqual(500);
	});
});

describe('anbieterTesten', () => {
	it('meldet Erfolg, wenn die Summe des erfundenen Bons stimmt', async () => {
		const fetchImpl = vi.fn(async () => antwort(TESTBON_SUMME_CENTS));
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: fetchImpl as never, env });
		expect(r.ok).toBe(true);
		expect(mocks.gespeichert[0].ok).toBe(true);
		// Der Textweg-Test ueberspringt die OCR: genau EIN Aufruf, und zwar ans Modell.
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('/chat/completions');
	});

	it('meldet Misserfolg bei falscher Summe', async () => {
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: (async () => antwort(999)) as never, env });
		expect(r.ok).toBe(false);
		expect(r.text).toMatch(/Summe/);
	});

	it('meldet Misserfolg, wenn ein anderes Modell geantwortet hat', async () => {
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: (async () => antwort(TESTBON_SUMME_CENTS, 'anderes')) as never, env });
		expect(r.ok).toBe(false);
		expect(r.text).toMatch(/anderes/);
	});

	it('meldet einen nicht erreichbaren Anbieter als Misserfolg, ohne zu werfen', async () => {
		const r = await anbieterTesten('a1', 'u1', {
			fetchImpl: (async () => {
				throw new TypeError('fetch failed');
			}) as never,
			env
		});
		expect(r).toMatchObject({ ok: false });
		expect(mocks.gespeichert[0].ok).toBe(false);
	});

	it('testet einen Bildweg-Anbieter ohne Freigabe gar nicht erst', async () => {
		mocks.zeile = zeile({ weg: 'bild' });
		const fetchImpl = vi.fn();
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: fetchImpl as never, env });
		expect(r.ok).toBe(false);
		expect(r.text).toMatch(/Bildweg/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('schwaerzt den Schluessel in einer Fehlermeldung des Anbieters', async () => {
		mocks.zeile = zeile({ schluesselEnc: verschluesseln('sk-geheim-a3f9', 'a1', env) });
		const r = await anbieterTesten('a1', 'u1', {
			fetchImpl: (async () => new Response('invalid key sk-geheim-a3f9', { status: 401 })) as never,
			env
		});
		expect(r.ok).toBe(false);
		expect(r.text).not.toContain('sk-geheim');
	});

	it('laeuft mit dem Zeitlimit des Anbieters, nicht mit festen 30 s', async () => {
		// Ein lokales Modell braucht fuer den Testbon ~45 s. Jedes Zeitlimit, das auf dem
		// Weg gesetzt wird (Signal des Tests UND das des Providers), muss das der Zeile sein.
		mocks.zeile = zeile({ zeitlimitMs: 120_000 });
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: (async () => antwort(TESTBON_SUMME_CENTS)) as never, env });
		expect(r.ok).toBe(true);
		const limits = timeout.mock.calls.map((c) => c[0]);
		expect(limits.length).toBeGreaterThanOrEqual(2);
		expect(new Set(limits)).toEqual(new Set([120_000]));
	});

	it('gibt den gelesenen Stand an testErgebnisSpeichern und meldet eine Aenderung waehrend des Tests', async () => {
		mocks.nochAktuell = false;
		const r = await anbieterTesten('a1', 'u1', { fetchImpl: (async () => antwort(TESTBON_SUMME_CENTS)) as never, env });
		expect(mocks.gespeichert[0].stand).toBe('2026-09-23 10:00:00.123456+00');
		expect(r).toEqual({ ok: false, text: 'Der Anbieter wurde während des Tests geändert — bitte erneut testen.' });
	});
});

describe('gespeicherterSchluessel', () => {
	it('gibt den Schluessel nur fuer die gespeicherte Basis-URL heraus', async () => {
		mocks.zeile = zeile({ schluesselEnc: verschluesseln('sk-geheim-a3f9', 'a1', env) });
		expect(await gespeicherterSchluessel('a1', 'http://mlx.invalid/v1', env)).toBe('sk-geheim-a3f9');
		expect(await gespeicherterSchluessel('a1', ' http://mlx.invalid/v1/ ', env)).toBe('sk-geheim-a3f9');
		expect(await gespeicherterSchluessel('a1', 'http://anders.invalid/v1', env)).toBe('');
		expect(await gespeicherterSchluessel('a1', 'http://mlx.invalid/v2', env)).toBe('');
	});
});

describe('modelleAbrufen', () => {
	it('liest die Modellliste im OpenAI-Format', async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] })));
		expect(await modelleAbrufen('http://m.invalid/v1', 'k', fetchImpl as never)).toEqual({ ok: true, modelle: ['a', 'b'] });
		expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('http://m.invalid/v1/models');
	});
	it('meldet einen Anbieter ohne Liste als Misserfolg, nicht als Fehler', async () => {
		const r = await modelleAbrufen('http://m.invalid/v1', '', (async () => new Response('nope', { status: 404 })) as never);
		expect(r.ok).toBe(false);
	});
});
