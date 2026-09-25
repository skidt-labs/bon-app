import { describe, it, expect } from 'vitest';
import { leisteOffen, leisteSetzen, LEISTE_SCHLUESSEL } from './zustand';

function speicher(): Pick<Storage, 'getItem' | 'setItem'> & { daten: Map<string, string> } {
	const daten = new Map<string, string>();
	return {
		daten,
		getItem: (k) => daten.get(k) ?? null,
		setItem: (k, v) => void daten.set(k, v)
	};
}

describe('Symbolleiste: ausgeklappt oder nicht', () => {
	it('ist eingeklappt, wenn nichts gemerkt wurde', () => {
		expect(leisteOffen(speicher())).toBe(false);
	});

	it('merkt sich das Ausklappen und das Einklappen', () => {
		const s = speicher();
		leisteSetzen(s, true);
		expect(leisteOffen(s)).toBe(true);
		leisteSetzen(s, false);
		expect(leisteOffen(s)).toBe(false);
		expect(s.daten.get(LEISTE_SCHLUESSEL)).toBe('zu');
	});

	// Serverseitig und in privaten Fenstern gibt es keinen Speicher. Dann gilt der
	// Standard — ohne Fehler, und ohne dass die Seite anders rendert als sonst.
	it('vertraegt fehlenden Speicher', () => {
		expect(leisteOffen(null)).toBe(false);
		expect(() => leisteSetzen(null, true)).not.toThrow();
	});

	// Ein Speicher, der wirft (Safari in bestimmten Einstellungen), darf die Seite
	// nicht mitreissen.
	it('vertraegt einen Speicher, der wirft', () => {
		const kaputt = {
			getItem: () => {
				throw new Error('QuotaExceeded');
			},
			setItem: () => {
				throw new Error('QuotaExceeded');
			}
		};
		expect(leisteOffen(kaputt)).toBe(false);
		expect(() => leisteSetzen(kaputt, true)).not.toThrow();
	});
});
