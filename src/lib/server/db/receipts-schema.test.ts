import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { merchants, receipts, receiptItems, extractionRuns, receiptStatus, lineType } from './schema';

describe('Bon-Schema', () => {
	it('legt die Bon-Tabellen an', () => {
		expect(getTableName(merchants)).toBe('merchants');
		expect(getTableName(receipts)).toBe('receipts');
		expect(getTableName(receiptItems)).toBe('receipt_items');
		expect(getTableName(extractionRuns)).toBe('extraction_runs');
	});
	it('kennt genau die sechs Server-Status', () => {
		expect(receiptStatus.enumValues).toEqual([
			'pending', 'extracting', 'review', 'confirmed', 'failed', 'doppelt'
		]);
	});
	it('kennt alle sechs Zeilentypen', () => {
		expect(lineType.enumValues).toEqual([
			'article', 'deposit', 'deposit_return', 'discount', 'loyalty', 'info'
		]);
	});
	it('speichert Beträge als Integer-Cent', () => {
		expect(receipts.totalGrossCents.dataType).toBe('number');
		expect(receiptItems.totalPriceCents.dataType).toBe('number');
	});
	it('haelt die Kostenspalte ganzzahlig', () => {
		expect(extractionRuns.costMicroEuros.dataType).toBe('number');
		expect(extractionRuns.accuracyVsConfirmed.dataType).toBe('number');
	});
});
