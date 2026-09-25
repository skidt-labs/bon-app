import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ protokoll: [] as { aktion: string; ziel: string; details: unknown }[] }));

vi.mock('$env/dynamic/private', () => ({ env: { SUPERUSER_OIDC_SUB: 'sub-betreiber' } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/betrieb/protokoll', () => ({
	protokolliere: vi.fn(async (_db: unknown, e: { aktion: string; ziel: string; details: unknown }) => {
		mocks.protokoll.push({ aktion: e.aktion, ziel: e.ziel, details: e.details });
	})
}));
vi.mock('$lib/server/betrieb/verwaltung', () => ({
	HaushaltNichtLeer: class extends Error {},
	SelbstSperrung: class extends Error {},
	haushalteUebersicht: vi.fn(),
	nutzerUebersicht: vi.fn(),
	haushaltAnlegenMitEinladung: vi.fn(),
	haushaltLoeschen: vi.fn(),
	nutzerSperren: vi.fn(),
	nutzerEntsperren: vi.fn(),
	selbstbedienungLesen: vi.fn(),
	selbstbedienungSetzen: vi.fn(),
	offeneEinladungen: vi.fn(),
	haushaltsName: vi.fn(async () => 'Familie Beispiel'),
	nutzerName: vi.fn(async () => 'Erika')
}));

import { actions } from './+page.server';

const betreiber = { user: { id: 'u1', oidcSub: 'sub-betreiber' } };
function ereignis(form: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(form)) f.set(k, v);
	return { locals: betreiber, request: new Request('http://x/betrieb', { method: 'POST', body: f }) } as never;
}

beforeEach(() => {
	mocks.protokoll = [];
});

describe('/betrieb: Protokoll nennt das Ziel beim Namen', () => {
	it('beim Loeschen eines Haushalts: Name im ziel, ID in den details', async () => {
		await actions.haushaltLoeschen(ereignis({ householdId: 'h-uuid' }));
		expect(mocks.protokoll).toEqual([{ aktion: 'haushalt.geloescht', ziel: 'Familie Beispiel', details: { householdId: 'h-uuid' } }]);
	});

	it('beim Sperren und Entsperren: displayName im ziel, ID in den details', async () => {
		await actions.sperren(ereignis({ userId: 'n-uuid', an: 'ja' }));
		await actions.sperren(ereignis({ userId: 'n-uuid', an: 'nein' }));
		expect(mocks.protokoll).toEqual([
			{ aktion: 'nutzer.gesperrt', ziel: 'Erika', details: { userId: 'n-uuid' } },
			{ aktion: 'nutzer.entsperrt', ziel: 'Erika', details: { userId: 'n-uuid' } }
		]);
	});
});
