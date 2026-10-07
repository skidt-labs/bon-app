import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({ ergebnis: { ok: true } as unknown, aufruf: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/bons/kein-bon-entscheidung', () => ({
	dochEinBon: async (...a: unknown[]) => (mocks.aufruf(...a), mocks.ergebnis)
}));

import { POST } from './kein-bon/+server';

function ereignis(angemeldet = true) {
	const user = angemeldet ? { id: 'u1', householdId: 'h1' } : null;
	return {
		params: { id: 'r1' },
		request: new Request('http://bon.local/x', { method: 'POST' }),
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

describe('POST /api/receipts/[id]/kein-bon', () => {
	it('verlangt eine Anmeldung', async () => {
		expect(isHttpError(await fang(POST(ereignis(false))), 401)).toBe(true);
		expect(mocks.aufruf).not.toHaveBeenCalled();
	});
	it('antwortet ok und nennt die Id', async () => {
		const antwort = (await POST(ereignis())) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		expect(mocks.aufruf).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1');
	});
	it('macht aus einem abgelehnten Ergebnis den passenden Fehler', async () => {
		mocks.ergebnis = { ok: false, status: 409, meldung: 'Dazu ist schon entschieden worden.' };
		expect(isHttpError(await fang(POST(ereignis())), 409)).toBe(true);
	});

	// 2.13: ein Bon, den es fuer diesen Menschen nicht gibt, ist 404 — nicht 409, nicht 500.
	it('meldet einen unbekannten Bon als 404', async () => {
		mocks.ergebnis = { ok: false, status: 404, meldung: 'Bon nicht gefunden' };
		const e = await fang(POST(ereignis()));
		expect(isHttpError(e, 404)).toBe(true);
		expect((e as { body: { message: string } }).body.message).toBe('Bon nicht gefunden');
	});

	// 2.11: vorher hiess jeder Erfolg { ok: true }, auch wenn das Einreihen scheiterte.
	it('reicht eingereiht durch', async () => {
		mocks.ergebnis = { ok: true, eingereiht: false };
		const antwort = (await POST(ereignis())) as Response;
		expect(await antwort.json()).toEqual({ ok: true, eingereiht: false });
	});
});
