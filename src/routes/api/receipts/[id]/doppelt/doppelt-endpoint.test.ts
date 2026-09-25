import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// Die Regeln selbst (welcher Zustand welche Entscheidung zulaesst, Sichtbarkeit) prueft
// bons/doppelt.db.test.ts gegen die echte Datenbank. Hier geht es nur um den Endpunkt:
// Anmeldung, Rumpf, und dass ein „keine Zeile getroffen" eine ehrliche Antwort bekommt.
const mocks = vi.hoisted(() => ({
	getroffen: true,
	bon: null as { status: string } | null,
	aufrufe: [] as string[]
}));

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/bons/doppelt', () => ({
	doppeltEntscheiden: vi.fn(async (_d: unknown, _k: unknown, _id: string, e: string) => {
		mocks.aufrufe.push(e);
		return mocks.getroffen;
	})
}));
vi.mock('$lib/server/bons/liste', () => ({ bonLaden: vi.fn(async () => mocks.bon) }));

import { POST } from './+server';

function ereignis(rumpf: unknown, angemeldet = true) {
	return {
		params: { id: 'r1' },
		request: new Request('http://x/api/receipts/r1/doppelt', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(rumpf)
		}),
		locals: angemeldet
			? { user: { id: 'u1' }, zugriff: { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' } }
			: {}
	} as never;
}

async function fehlerVon(p: unknown): Promise<unknown> {
	try {
		await p;
	} catch (err) {
		return err;
	}
	return null;
}

beforeEach(() => {
	mocks.getroffen = true;
	mocks.bon = null;
	mocks.aufrufe = [];
});

describe('POST /api/receipts/[id]/doppelt', () => {
	it('lehnt ohne Anmeldung mit 401 ab', async () => {
		expect(isHttpError(await fehlerVon(POST(ereignis({ entscheidung: 'doppelt' }, false))), 401)).toBe(true);
	});

	it('lehnt eine unbekannte Entscheidung ab, ohne etwas zu schreiben', async () => {
		expect(isHttpError(await fehlerVon(POST(ereignis({ entscheidung: 'loeschen' }))), 400)).toBe(true);
		expect(mocks.aufrufe).toHaveLength(0);
	});

	it.each(['doppelt', 'eigenerEinkauf', 'wiederherstellen'])('reicht „%s" durch', async (e) => {
		const res = await POST(ereignis({ entscheidung: e }));
		expect(res.status).toBe(200);
		expect(mocks.aufrufe).toEqual([e]);
	});

	it('meldet 404, wenn der Bon nicht sichtbar ist', async () => {
		mocks.getroffen = false;
		mocks.bon = null;
		expect(isHttpError(await fehlerVon(POST(ereignis({ entscheidung: 'doppelt' }))), 404)).toBe(true);
	});

	it('meldet 409, wenn der Bon sichtbar ist, aber im falschen Zustand', async () => {
		// Zum Beispiel ein zweiter Klick, nachdem der erste schon entschieden hat.
		mocks.getroffen = false;
		mocks.bon = { status: 'doppelt' };
		expect(isHttpError(await fehlerVon(POST(ereignis({ entscheidung: 'doppelt' }))), 409)).toBe(true);
	});
});
