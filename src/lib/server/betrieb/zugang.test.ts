import { describe, it, expect, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({ env: { SUPERUSER_OIDC_SUB: 'sub-betreiber' } }));
import { nurBetreiber } from './zugang';

const fang = (f: () => unknown) => {
	try {
		f();
	} catch (err) {
		return err;
	}
};

describe('nurBetreiber', () => {
	it('schickt Unangemeldete zur Anmeldung', () => {
		expect(isRedirect(fang(() => nurBetreiber({} as App.Locals)))).toBe(true);
	});
	it('antwortet allen anderen mit 404, nicht 403', () => {
		const err = fang(() => nurBetreiber({ user: { id: 'u', oidcSub: 'sub-x' } } as App.Locals));
		expect(isHttpError(err, 404)).toBe(true);
	});
	it('laesst den Betreiber durch', () => {
		const user = { id: 'u', oidcSub: 'sub-betreiber' };
		expect(nurBetreiber({ user } as App.Locals)).toBe(user);
	});
});
