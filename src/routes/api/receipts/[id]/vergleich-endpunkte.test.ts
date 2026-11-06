import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mocks = vi.hoisted(() => {
	class BildSpeicherFehler extends Error {
		constructor(readonly systemfehler: boolean) {
			super(systemfehler ? 'Bild konnte gerade nicht gespeichert werden' : 'Bild nicht verarbeitbar');
		}
	}
	return {
		ergebnis: { ok: true } as unknown,
		wirft: null as unknown,
		behalten: vi.fn(),
		uebernehmen: vi.fn(),
		BildSpeicherFehler
	};
});
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/bons/vergleich', () => ({
	behalten: async (...a: unknown[]) => (mocks.behalten(...a), mocks.ergebnis)
}));
vi.mock('$lib/server/bons/bild', () => ({
	BildSpeicherFehler: mocks.BildSpeicherFehler,
	bildUebernehmen: async (...a: unknown[]) => {
		mocks.uebernehmen(...a);
		if (mocks.wirft) throw mocks.wirft;
		return mocks.ergebnis;
	}
}));

import { POST as behalten } from './behalten/+server';
import { POST as bildUebernehmen } from './bild-uebernehmen/+server';

function ereignis(body: string | null, angemeldet = true) {
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

const meldung = (e: unknown) => (e as { body: { message: string } }).body.message;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ergebnis = { ok: true };
	mocks.wirft = null;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/receipts/[id]/behalten', () => {
	it('verlangt eine Anmeldung', async () => {
		expect(isHttpError(await fang(behalten(ereignis('{"weg":"r2"}', false))), 401)).toBe(true);
		expect(mocks.behalten).not.toHaveBeenCalled();
	});

	it('verlangt den anderen Bon', async () => {
		for (const body of [null, '{}', '{"weg":""}', '{"weg":3}', 'kaputt']) {
			expect(isHttpError(await fang(behalten(ereignis(body))), 400)).toBe(true);
		}
		expect(mocks.behalten).not.toHaveBeenCalled();
	});

	it('reicht Status und Meldung durch', async () => {
		mocks.ergebnis = { ok: false, status: 409, meldung: 'Einer der beiden Bons wird noch gelesen.' };
		const e = await fang(behalten(ereignis('{"weg":"r2"}')));
		expect(isHttpError(e, 409)).toBe(true);
		expect(meldung(e)).toBe('Einer der beiden Bons wird noch gelesen.');
	});

	it('behaelt diesen und antwortet ok', async () => {
		const antwort = (await behalten(ereignis('{"weg":"r2"}'))) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		expect(mocks.behalten).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', 'r2', { erwartet: undefined });
	});

	// Abschlusspruefung 0.12.0, Wichtig 1: der gesehene Status geht mit, der Server prueft ihn.
	it('reicht den gesehenen Status weiter', async () => {
		await behalten(ereignis('{"weg":"r2","erwartet":{"r1":"review","r2":"confirmed"}}'));
		expect(mocks.behalten).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', 'r2', {
			erwartet: { r1: 'review', r2: 'confirmed' }
		});
	});

	it('lehnt einen kaputten gesehenen Status ab', async () => {
		await expect(behalten(ereignis('{"weg":"r2","erwartet":{"r2":7}}'))).rejects.toMatchObject({ status: 400 });
		await expect(behalten(ereignis('{"weg":"r2","erwartet":"confirmed"}'))).rejects.toMatchObject({ status: 400 });
	});
});

describe('POST /api/receipts/[id]/bild-uebernehmen', () => {
	it('verlangt eine Anmeldung', async () => {
		expect(isHttpError(await fang(bildUebernehmen(ereignis('{"quelle":"r2"}', false))), 401)).toBe(true);
		expect(mocks.uebernehmen).not.toHaveBeenCalled();
	});

	it('verlangt die Quelle', async () => {
		for (const body of [null, '{}', '{"quelle":""}', '{"weg":"r2"}']) {
			expect(isHttpError(await fang(bildUebernehmen(ereignis(body))), 400)).toBe(true);
		}
		expect(mocks.uebernehmen).not.toHaveBeenCalled();
	});

	it('reicht den 409-Satz durch', async () => {
		mocks.ergebnis = { ok: false, status: 409, meldung: 'Das Bild lässt sich nur auf einen bestätigten Bon übernehmen.' };
		const e = await fang(bildUebernehmen(ereignis('{"quelle":"r2"}')));
		expect(isHttpError(e, 409)).toBe(true);
		expect(meldung(e)).toBe('Das Bild lässt sich nur auf einen bestätigten Bon übernehmen.');
	});

	it('Systemfehler beim Speichern → 503, unlesbares Bild → 422', async () => {
		mocks.wirft = new mocks.BildSpeicherFehler(true);
		expect(isHttpError(await fang(bildUebernehmen(ereignis('{"quelle":"r2"}'))), 503)).toBe(true);
		mocks.wirft = new mocks.BildSpeicherFehler(false);
		expect(isHttpError(await fang(bildUebernehmen(ereignis('{"quelle":"r2"}'))), 422)).toBe(true);
	});

	it('uebernimmt und antwortet ok', async () => {
		const antwort = (await bildUebernehmen(ereignis('{"quelle":"r2"}'))) as Response;
		expect(await antwort.json()).toEqual({ ok: true });
		expect(mocks.uebernehmen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', 'r2', undefined, undefined);
	});

	it('reicht den gesehenen Status weiter', async () => {
		await bildUebernehmen(ereignis('{"quelle":"r2","erwartet":{"r1":"confirmed","r2":"review"}}'));
		expect(mocks.uebernehmen).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'r1', 'r2', undefined, {
			r1: 'confirmed',
			r2: 'review'
		});
	});
});
