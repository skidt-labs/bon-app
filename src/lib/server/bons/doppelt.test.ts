import { describe, it, expect } from 'vitest';
import { DOPPEL_TOLERANZ_MINUTEN, suchfenster, vermutetesOriginal } from './doppelt';

describe('suchfenster', () => {
	it('reicht fuenf Minuten vor und nach der Kaufzeit', () => {
		const zeit = new Date('2026-08-05T17:20:00Z');
		const { von, bis } = suchfenster(zeit);
		expect(DOPPEL_TOLERANZ_MINUTEN).toBe(5);
		expect(von.toISOString()).toBe('2026-08-05T17:15:00.000Z');
		expect(bis.toISOString()).toBe('2026-08-05T17:25:00.000Z');
	});
});

describe('vermutetesOriginal', () => {
	// Ohne Endsumme oder ohne Kaufzeit gibt es nichts zu vergleichen. Die Datenbank darf
	// dann gar nicht erst gefragt werden: eine Suche "gleiche Summe, irgendwann" wuerde
	// jeden zweiten 1,19-€-Bon zum Doppel erklaeren.
	const keineDatenbank = new Proxy({}, {
		get() {
			throw new Error('Die Datenbank haette nicht gefragt werden duerfen');
		}
	}) as never;
	const bon = {
		id: '00000000-0000-0000-0000-000000000001',
		householdId: '00000000-0000-0000-0000-000000000002',
		uploadedBy: '00000000-0000-0000-0000-000000000003'
	};

	it('sucht nicht, wenn keine Endsumme gelesen wurde', async () => {
		const r = await vermutetesOriginal(keineDatenbank, { ...bon, totalGrossCents: null, purchasedAt: new Date() });
		expect(r).toBeNull();
	});

	it('sucht nicht, wenn keine Kaufzeit gelesen wurde', async () => {
		const r = await vermutetesOriginal(keineDatenbank, { ...bon, totalGrossCents: 1217, purchasedAt: null });
		expect(r).toBeNull();
	});
});
