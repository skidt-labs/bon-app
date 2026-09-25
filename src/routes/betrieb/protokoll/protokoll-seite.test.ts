import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({ env: { SUPERUSER_OIDC_SUB: 'sub-betreiber' } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/betrieb/protokoll', () => ({
	protokollLesen: vi.fn(async () => [{ id: 'p1', zeit: new Date(), wer: 'erika', aktion: 'ki.aktiviert', ziel: 'MLX', details: null }])
}));

import { load } from './+page.server';
import * as protokollMod from '$lib/server/betrieb/protokoll';

const fang = async (p: unknown) => {
	try {
		await p;
	} catch (err) {
		return err;
	}
};

describe('/betrieb/protokoll', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('antwortet allen ausser dem Betreiber mit 404', async () => {
		expect(isHttpError(await fang(load({ locals: { user: { id: 'u', oidcSub: 'x' } } } as never)), 404)).toBe(true);
	});
	it('zeigt dem Betreiber die letzten 200 Eintraege', async () => {
		const r = (await load({ locals: { user: { id: 'u', oidcSub: 'sub-betreiber' } } } as never)) as { eintraege: unknown[] };
		expect(r.eintraege).toHaveLength(1);
		expect(vi.mocked(protokollMod.protokollLesen)).toHaveBeenCalledWith(200);
	});
});
