import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({ aktiviert: [] as string[], fehler: null as Error | null }));

vi.mock('$env/dynamic/private', () => ({ env: { SUPERUSER_OIDC_SUB: 'sub-betreiber' } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/betrieb/ki', async () => {
	class NichtGetestet extends Error {}
	class AnbieterAktiv extends Error {}
	class AnbieterNichtGefunden extends Error {}
	class SchluesselFehlt extends Error {}
	return {
		NichtGetestet,
		AnbieterAktiv,
		AnbieterNichtGefunden,
		SchluesselFehlt,
		eingabeAusFormular: vi.fn(),
		anbieterListe: vi.fn(async () => []),
		kiStandLesen: vi.fn(async () => ({ aktivId: null, stand: 0 })),
		geheimnisVorhanden: () => true,
		anbieterAktivieren: vi.fn(async (id: string) => {
			if (mocks.fehler) throw mocks.fehler;
			mocks.aktiviert.push(id);
		}),
		anbieterAnlegen: vi.fn(),
		anbieterAendern: vi.fn(),
		anbieterLoeschen: vi.fn(),
		zurueckAufEnv: vi.fn()
	};
});
vi.mock('$lib/server/betrieb/ki-probe', () => ({
	anbieterTesten: vi.fn(),
	modelleAbrufen: vi.fn(async () => ({ ok: true, modelle: ['m'] })),
	gespeicherterSchluessel: vi.fn(async () => 'sk')
}));

import { load, actions } from './+page.server';
import { anbieterAendern, anbieterAnlegen, eingabeAusFormular, NichtGetestet, zurueckAufEnv } from '$lib/server/betrieb/ki';
import { gespeicherterSchluessel } from '$lib/server/betrieb/ki-probe';
import { BildwegNichtFreigegeben } from '$lib/server/ki/fehler';

const betreiber = { user: { id: 'u1', oidcSub: 'sub-betreiber' } };
const fremder = { user: { id: 'u2', oidcSub: 'sub-x' } };

function ereignis(locals: unknown, form: Record<string, string> = {}) {
	const f = new FormData();
	for (const [k, v] of Object.entries(form)) f.set(k, v);
	return { locals, request: new Request('http://x/betrieb/ki', { method: 'POST', body: f }) } as never;
}
const fang = async (p: unknown) => {
	try {
		await p;
	} catch (err) {
		return err;
	}
};

beforeEach(() => {
	mocks.aktiviert = [];
	mocks.fehler = null;
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

describe('/betrieb/ki', () => {
	it('antwortet allen ausser dem Betreiber mit 404 — Seite und jede Action', async () => {
		expect(isHttpError(await fang(load(ereignis(fremder))), 404)).toBe(true);
		for (const name of Object.keys(actions)) {
			expect(isHttpError(await fang(actions[name as keyof typeof actions](ereignis(fremder, { id: 'a1' }))), 404), name).toBe(true);
		}
	});

	it('aktiviert fuer den Betreiber', async () => {
		await actions.aktivieren(ereignis(betreiber, { id: 'a1' }));
		expect(mocks.aktiviert).toEqual(['a1']);
	});

	it('erklaert, warum ein ungetesteter Anbieter nicht aktiviert wird', async () => {
		mocks.fehler = new NichtGetestet();
		const r = (await actions.aktivieren(ereignis(betreiber, { id: 'a1' }))) as { status: number; data: { grund: string } };
		expect(r.status).toBe(409);
		expect(r.data.grund).toMatch(/Test/);
	});

	it('erklaert, warum ein Bildweg-Anbieter ohne Freigabe nicht aktiviert wird', async () => {
		mocks.fehler = new BildwegNichtFreigegeben('x');
		const r = (await actions.aktivieren(ereignis(betreiber, { id: 'a1' }))) as { status: number; data: { grund: string } };
		expect(r.status).toBe(409);
		expect(r.data.grund).toMatch(/EXTRACTION_BILDWEG_BESTAETIGT/);
	});

	it('verweigert „Zurueck auf .env", solange die .env unvollstaendig ist, und nennt die Variable', async () => {
		vi.stubEnv('EXTRACTION_BASE_URL', 'http://env.invalid/v1');
		vi.stubEnv('EXTRACTION_API_KEY', 'k');
		vi.stubEnv('EXTRACTION_MODEL', '');
		const r = (await actions.zurueck(ereignis(betreiber))) as { status: number; data: { grund: string } };
		expect(r.status).toBe(409);
		expect(r.data.grund).toMatch(/EXTRACTION_MODEL/);
		expect(zurueckAufEnv).not.toHaveBeenCalled();
	});

	it('schaltet mit vollstaendiger .env zurueck', async () => {
		vi.stubEnv('EXTRACTION_BASE_URL', 'http://env.invalid/v1');
		vi.stubEnv('EXTRACTION_API_KEY', 'k');
		vi.stubEnv('EXTRACTION_MODEL', 'm');
		vi.stubEnv('EXTRACTION_TIMEOUT_MS', '');
		await actions.zurueck(ereignis(betreiber));
		expect(zurueckAufEnv).toHaveBeenCalledWith('u1');
	});

	it('bildet einen gesperrten Bildweg beim Anlegen und Aendern auf 409 ab', async () => {
		vi.mocked(eingabeAusFormular).mockReturnValue({ ok: true, eingabe: {} as never });
		vi.mocked(anbieterAnlegen).mockRejectedValueOnce(new BildwegNichtFreigegeben('x'));
		vi.mocked(anbieterAendern).mockRejectedValueOnce(new BildwegNichtFreigegeben('x'));
		for (const r of [
			(await actions.anlegen(ereignis(betreiber))) as { status: number; data: { grund: string } },
			(await actions.aendern(ereignis(betreiber, { id: 'a1' }))) as { status: number; data: { grund: string } }
		]) {
			expect(r.status).toBe(409);
			expect(r.data.grund).toMatch(/EXTRACTION_BILDWEG_BESTAETIGT=ja/);
		}
	});

	it('fragt den gespeicherten Schluessel fuer die eingegebene Basis-URL an', async () => {
		await actions.modelle(ereignis(betreiber, { id: 'a1', baseUrl: 'http://neu.invalid/v1' }));
		expect(gespeicherterSchluessel).toHaveBeenCalledWith('a1', 'http://neu.invalid/v1');
	});
});
