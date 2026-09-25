import { describe, it, expect } from 'vitest';
import { verbotenImporte } from './tor';

/**
 * Der Waechter selbst braucht einen Test — sonst faellt eine Luecke wie die im
 * ursprünglichen Muster (Alias-Importe gingen durch) niemandem auf, bis jemand sie
 * ausnutzt. Fix-Runde 1, Aufgabe 3.
 *
 * Fix-Runde 2: der Sternchen-Import, der Re-Export und das dynamische `import(...)` —
 * die Nachpruefung fand, dass `import * as schema from '$lib/server/db/schema'` (genau
 * das Muster aus `src/lib/server/db/index.ts`) durch die Runde-1-Fassung rutschte.
 */
describe('verbotenImporte', () => {
	it('erkennt einen einfachen Import', () => {
		expect(verbotenImporte(`import { receipts } from '$lib/server/db/schema';`)).toEqual(['receipts']);
	});

	it('erkennt einen Alias-Import', () => {
		expect(verbotenImporte(`import { receipts as r } from '$lib/server/db/schema';`)).toEqual(['receipts']);
	});

	it('erkennt einen typreinen Import — eine Route braucht die Tabelle auch nicht als Typ', () => {
		expect(verbotenImporte(`import type { receipts } from '$lib/server/db/schema';`)).toEqual(['receipts']);
	});

	it('erkennt einen einzeln typreinen Spezifizierer in einem gemischten Import', () => {
		expect(verbotenImporte(`import { type receipts, categories } from '$lib/server/db/schema';`)).toEqual([
			'receipts'
		]);
	});

	it('trifft bei einem mehrzeiligen, gemischten Import nur die verbotenen Namen', () => {
		const quelltext = `
			import {
				receipts,
				categories,
				budgetKategorien
			} from '$lib/server/db/schema';
		`;
		expect(verbotenImporte(quelltext).sort()).toEqual(['budgetKategorien', 'receipts']);
	});

	it('meldet nichts fuer einen erlaubten Namen', () => {
		expect(verbotenImporte(`import { categories } from '$lib/server/db/schema';`)).toEqual([]);
	});

	it('meldet nichts fuer einen gleichnamigen Import aus einem anderen Modul', () => {
		expect(verbotenImporte(`import { receipts } from './fixtures/receipts';`)).toEqual([]);
	});

	it('erkennt den Sternchen-Import mit Nutzung eines verbotenen Namens (das Muster aus db/index.ts)', () => {
		const quelltext = `
			import * as schema from '$lib/server/db/schema';
			const zeile = await db.select().from(schema.receipts);
		`;
		expect(verbotenImporte(quelltext)).toEqual(['receipts']);
	});

	it('meldet nichts fuer einen Sternchen-Import, der nur erlaubte Namen benutzt', () => {
		const quelltext = `
			import * as schema from '$lib/server/db/schema';
			const zeilen = await db.select().from(schema.categories);
		`;
		expect(verbotenImporte(quelltext)).toEqual([]);
	});

	it('erkennt einen benannten Re-Export', () => {
		expect(verbotenImporte(`export { receipts } from '$lib/server/db/schema';`)).toEqual(['receipts']);
	});

	it('erkennt einen benannten Re-Export mit Alias', () => {
		expect(verbotenImporte(`export { receipts as r } from '$lib/server/db/schema';`)).toEqual(['receipts']);
	});

	it('meldet nichts fuer einen Re-Export eines erlaubten Namens', () => {
		expect(verbotenImporte(`export { categories } from '$lib/server/db/schema';`)).toEqual([]);
	});

	it('erkennt einen Sternchen-Re-Export als vollstaendigen Verstoss', () => {
		const treffer = verbotenImporte(`export * from '$lib/server/db/schema';`);
		expect(treffer.sort()).toEqual(
			['budgetBetraege', 'budgetKategorien', 'budgets', 'receiptItems', 'receipts'].sort()
		);
	});

	it('erkennt einen dynamischen, destrukturierten Import', () => {
		expect(
			verbotenImporte(`const { receipts } = await import('$lib/server/db/schema');`)
		).toEqual(['receipts']);
	});

	it('erkennt einen dynamischen Import ueber einen Namespace-Alias', () => {
		const quelltext = `
			const schema = await import('$lib/server/db/schema');
			const zeile = schema.receipts;
		`;
		expect(verbotenImporte(quelltext)).toEqual(['receipts']);
	});

	it('erkennt einen dynamischen Import mit direktem Zugriff ohne Zwischenvariable', () => {
		const quelltext = `const zeile = (await import('$lib/server/db/schema')).receipts;`;
		expect(verbotenImporte(quelltext)).toEqual(['receipts']);
	});

	it('meldet nichts fuer einen dynamischen Import mit nur erlaubtem Namen', () => {
		expect(
			verbotenImporte(`const { categories } = await import('$lib/server/db/schema');`)
		).toEqual([]);
	});

	it('meldet nichts fuer einen dynamischen Import aus einem anderen Modul', () => {
		expect(verbotenImporte(`const { receipts } = await import('./fixtures/receipts');`)).toEqual([]);
	});
});
