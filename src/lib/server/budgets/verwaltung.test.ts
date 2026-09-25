import { describe, it, expect } from 'vitest';
import { letzterTagVorMonat, monatsErster, budgetSchema, aenderungSchema } from './verwaltung';

describe('Monatsrechnung', () => {
	it('macht aus einem Monat seinen Ersten', () => {
		expect(monatsErster('2026-09')).toBe('2026-09-01');
		expect(monatsErster('quatsch')).toBeNull();
		expect(monatsErster('2026-13')).toBeNull();
	});

	// „Loesen ab Oktober" heisst: im September gilt die Zuordnung noch, im Oktober nicht
	// mehr. `gilt_bis` ist der letzte Tag, an dem sie zaehlt.
	it('findet den letzten Tag vor einem Monat, auch ueber den Jahreswechsel', () => {
		expect(letzterTagVorMonat('2026-10')).toBe('2026-09-30');
		expect(letzterTagVorMonat('2026-03')).toBe('2026-02-28');
		expect(letzterTagVorMonat('2026-01')).toBe('2025-12-31');
		expect(letzterTagVorMonat('2024-03')).toBe('2024-02-29'); // Schaltjahr
		expect(letzterTagVorMonat('quatsch')).toBeNull();
	});
});

describe('budgetSchema', () => {
	it('nimmt einen Namen an und schneidet Leerraum ab', () => {
		expect(budgetSchema.parse({ name: '  Lebensmittel ' }).name).toBe('Lebensmittel');
	});

	it('lehnt einen leeren Namen ab — ein Topf ohne Namen ist keiner', () => {
		expect(budgetSchema.safeParse({ name: '   ' }).success).toBe(false);
		expect(budgetSchema.safeParse({}).success).toBe(false);
	});
});

describe('aenderungSchema', () => {
	it('kennt die vier Aenderungen', () => {
		expect(aenderungSchema.safeParse({ art: 'umbenennen', name: 'Neu' }).success).toBe(true);
		expect(
			aenderungSchema.safeParse({ art: 'betrag', monat: '2026-09', amountCents: 25000 }).success
		).toBe(true);
		expect(
			aenderungSchema.safeParse({ art: 'zuordnen', categoryId: '11111111-2222-4333-8444-555555555555', abMonat: '2026-09' }).success
		).toBe(true);
		expect(
			aenderungSchema.safeParse({ art: 'loesen', categoryId: '11111111-2222-4333-8444-555555555555', abMonat: '2026-10' }).success
		).toBe(true);
	});

	// Geld ist ueberall ganzzahliger Cent. "250.00" waere 25000 oder 250 — und ein Fehler
	// um Faktor 100 sieht plausibel aus.
	it('lehnt Bruchzahlen-Cent und negative Betraege ab', () => {
		expect(aenderungSchema.safeParse({ art: 'betrag', monat: '2026-09', amountCents: 250.5 }).success).toBe(false);
		expect(aenderungSchema.safeParse({ art: 'betrag', monat: '2026-09', amountCents: '25000' }).success).toBe(false);
		// Ein negatives Budget ergibt keinen Sinn — man kann sich nicht vornehmen,
		// Geld einzunehmen.
		expect(aenderungSchema.safeParse({ art: 'betrag', monat: '2026-09', amountCents: -100 }).success).toBe(false);
	});

	it('lehnt einen unbrauchbaren Monat ab, statt ihn zu raten', () => {
		expect(aenderungSchema.safeParse({ art: 'betrag', monat: '2026-9', amountCents: 100 }).success).toBe(false);
		expect(aenderungSchema.safeParse({ art: 'betrag', monat: '2026-13', amountCents: 100 }).success).toBe(false);
	});

	it('lehnt eine unbekannte Aenderungsart ab', () => {
		expect(aenderungSchema.safeParse({ art: 'sonstwas' }).success).toBe(false);
	});
});
