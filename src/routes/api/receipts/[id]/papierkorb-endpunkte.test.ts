import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
	ergebnis: { ok: true } as unknown,
	legen: vi.fn(),
	holen: vi.fn(),
	loeschen: vi.fn()
}));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/bons/papierkorb', () => ({
	inPapierkorbLegen: async (...a: unknown[]) => (mocks.legen(...a), mocks.ergebnis),
	ausPapierkorbHolen: async (...a: unknown[]) => (mocks.holen(...a), mocks.ergebnis),
	endgueltigLoeschen: async (...a: unknown[]) => (mocks.loeschen(...a), mocks.ergebnis)
}));

import { POST as verwerfen } from './verwerfen/+server';
import { POST as wiederherstellen } from './wiederherstellen/+server';
import { POST as loeschen } from './loeschen/+server';

function ereignis(body: string | null = '{}', angemeldet = true) {
	const user = angemeldet ? { id: 'u1', householdId: 'h1' } : null;
	return {
		params: { id: 'r1' },
		request: new Request('http://bon.local/x', {
			method: 'POST',
			...(body === null ? {} : { headers: { 'content-type': 'application/json' }, body })
		}),
		locals: { user, zugriff: user ? { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } : null }
	} as never;
}

async function fang(p: unknown) {
	try {
		await p;
	} catch (e) {
		return e;
	}
	return null;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ergebnis = { ok: true };
});

describe('Papierkorb-Endpunkte', () => {
	it('verlangen eine Anmeldung', async () => {
		for (const h of [verwerfen, wiederherstellen, loeschen]) {
			expect(isHttpError(await fang(h(ereignis('{}', false))), 401)).toBe(true);
		}
		expect(mocks.legen).not.toHaveBeenCalled();
	});

	it('reicht die Rueckfrage beim Verwerfen durch und antwortet ok', async () => {
		const antwort = (await verwerfen(ereignis('{"bestaetigtWegnehmen":true}'))) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		expect(mocks.legen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', true);
	});

	it('nimmt ohne Rumpf „nicht bestaetigt" an', async () => {
		await verwerfen(ereignis(null));
		expect(mocks.legen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', false);
	});

	it('nimmt nur ein echtes true als Bestaetigung', async () => {
		await verwerfen(ereignis('{"bestaetigtWegnehmen":"ja"}'));
		expect(mocks.legen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', false);
	});

	it('macht aus einem abgelehnten Ergebnis den passenden Fehler mit Meldung', async () => {
		mocks.ergebnis = { ok: false, status: 403, meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.' };
		const e = await fang(loeschen(ereignis()));
		expect(isHttpError(e, 403)).toBe(true);
		expect((e as { body: { message: string } }).body.message).toContain('hochgeladen');
	});

	it('ruft beim Wiederherstellen die richtige Funktion mit der Id', async () => {
		await wiederherstellen(ereignis());
		expect(mocks.holen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1');
	});
});
