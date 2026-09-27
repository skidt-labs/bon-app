import { describe, it, expect } from 'vitest';
import { darfBonVerwerfen } from './kontext';

describe('darfBonVerwerfen', () => {
	const mitglied = { haushaltId: 'h1', nutzerId: 'u1', rolle: 'mitglied' as const };
	it('laesst den zu, der den Bon hochgeladen hat', () => {
		expect(darfBonVerwerfen(mitglied, 'u1')).toBe(true);
	});
	it('laesst ein anderes Mitglied nicht zu, auch wenn es den Bon sieht', () => {
		expect(darfBonVerwerfen(mitglied, 'u2')).toBe(false);
	});
	it('laesst den Verwalter jeden Bon des Haushalts verwerfen', () => {
		expect(darfBonVerwerfen({ ...mitglied, rolle: 'verwalter' }, 'u2')).toBe(true);
	});
});
