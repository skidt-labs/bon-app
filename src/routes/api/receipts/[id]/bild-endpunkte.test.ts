import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({ ergebnis: { ok: true } as unknown, ersetzen: vi.fn(), zurueck: vi.fn(), wirft: null as unknown }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/bons/bild', async () => {
	class BildSpeicherFehler extends Error {
		constructor(readonly systemfehler: boolean) {
			super('x');
		}
	}
	return {
		BildSpeicherFehler,
		bildErsetzen: async (...a: unknown[]) => {
			mocks.ersetzen(...a);
			if (mocks.wirft) throw mocks.wirft;
			return mocks.ergebnis;
		},
		originalWiederherstellen: async (...a: unknown[]) => (mocks.zurueck(...a), mocks.ergebnis)
	};
});

import { POST as bild } from './bild/+server';
import { POST as original } from './bild-original/+server';
import { BildSpeicherFehler } from '$lib/server/bons/bild';

function ereignis(datei: Blob | null, angemeldet = true) {
	const user = angemeldet ? { id: 'u1', householdId: 'h1' } : null;
	const form = new FormData();
	if (datei) form.set('image', datei, 'bon.webp');
	return {
		params: { id: 'r1' },
		request: new Request('http://bon.local/x', { method: 'POST', body: form }),
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
	mocks.wirft = null;
});

describe('POST /api/receipts/[id]/bild', () => {
	it('verlangt eine Anmeldung', async () => {
		expect(isHttpError(await fang(bild(ereignis(new Blob(['x']), false))), 401)).toBe(true);
	});
	it('verlangt das Feld image und eine nicht leere Datei', async () => {
		expect(isHttpError(await fang(bild(ereignis(null))), 400)).toBe(true);
		expect(isHttpError(await fang(bild(ereignis(new Blob([])))), 400)).toBe(true);
	});
	it('lehnt mehr als 12 MB ab', async () => {
		expect(isHttpError(await fang(bild(ereignis(new Blob([new Uint8Array(12 * 1024 * 1024 + 1)])))), 413)).toBe(true);
		expect(mocks.ersetzen).not.toHaveBeenCalled();
	});
	it('reicht die Bytes weiter und antwortet ok', async () => {
		const antwort = (await bild(ereignis(new Blob(['abc'])))) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		expect(mocks.ersetzen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', Buffer.from('abc'));
	});
	it('macht aus Speicherfehlern 503 bzw. 422', async () => {
		mocks.wirft = new BildSpeicherFehler(true);
		expect(isHttpError(await fang(bild(ereignis(new Blob(['abc'])))), 503)).toBe(true);
		mocks.wirft = new BildSpeicherFehler(false);
		expect(isHttpError(await fang(bild(ereignis(new Blob(['abc'])))), 422)).toBe(true);
	});
	it('macht aus einem abgelehnten Ergebnis den passenden Fehler', async () => {
		mocks.ergebnis = { ok: false, status: 409, meldung: 'nein' };
		expect(isHttpError(await fang(bild(ereignis(new Blob(['abc'])))), 409)).toBe(true);
	});
});

describe('POST /api/receipts/[id]/bild-original', () => {
	it('verlangt eine Anmeldung und reicht das Ergebnis durch', async () => {
		expect(isHttpError(await fang(original(ereignis(null, false))), 401)).toBe(true);
		const antwort = (await original(ereignis(null))) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		mocks.ergebnis = { ok: false, status: 409, meldung: 'kein Original' };
		expect(isHttpError(await fang(original(ereignis(null))), 409)).toBe(true);
	});
});
