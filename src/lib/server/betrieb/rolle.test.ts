import { describe, it, expect, vi, beforeEach } from 'vitest';

const setzeVariable = (wert: string | undefined) =>
	vi.doMock('$env/dynamic/private', () => ({ env: { SUPERUSER_OIDC_SUB: wert } }));

describe('istBetreiber', () => {
	beforeEach(() => vi.resetModules());

	it('erkennt das eingetragene Konto am oidc_sub', async () => {
		setzeVariable('sub-erika');
		const { istBetreiber } = await import('./rolle');
		expect(istBetreiber({ oidcSub: 'sub-erika' })).toBe(true);
	});

	it('erkennt jedes andere Konto NICHT', async () => {
		setzeVariable('sub-erika');
		const { istBetreiber } = await import('./rolle');
		expect(istBetreiber({ oidcSub: 'sub-tabea' })).toBe(false);
		expect(istBetreiber(null)).toBe(false);
		expect(istBetreiber({ oidcSub: null })).toBe(false);
	});

	it('kennt ohne gesetzte Variable ueberhaupt keinen Betreiber', async () => {
		// Ein gueltiger Zustand: eine Instanz fuer einen einzigen Haushalt braucht keinen.
		// Wichtig ist nur, dass „nicht gesetzt" nicht versehentlich auf JEDEN passt —
		// ein leerer Vergleichswert gegen ein leeres Feld waere genau das.
		setzeVariable(undefined);
		const { istBetreiber } = await import('./rolle');
		expect(istBetreiber({ oidcSub: 'sub-erika' })).toBe(false);
		expect(istBetreiber({ oidcSub: '' })).toBe(false);
	});

	it('laesst sich nicht mit Leerraum ueberlisten', async () => {
		setzeVariable('   ');
		const { istBetreiber } = await import('./rolle');
		expect(istBetreiber({ oidcSub: '   ' })).toBe(false);
	});
});
