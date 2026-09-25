import { describe, it, expect } from 'vitest';
import {
	KATEGORIEBAUM,
	SONSTIGES_PFAND_SLUG,
	SONSTIGES_RABATT_SLUG,
	SONSTIGES_UNSORTIERT_SLUG
} from './baum';

describe('Kategoriebaum', () => {
	it('hat 13 Oberkategorien wie im Entwurf', () => {
		expect(KATEGORIEBAUM).toHaveLength(13);
	});

	it('vergibt jeden slug genau einmal', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
		expect(new Set(alle).size).toBe(alle.length);
	});

	// Die Zweistufigkeit ist laut Entwurf fest. Ein Kind mit eigenen Kindern waere eine
	// dritte Ebene und wuerde jede Auswertung ueber Oberkategorien verfaelschen.
	it('bleibt zweistufig', () => {
		for (const o of KATEGORIEBAUM) {
			for (const k of o.kinder) {
				expect(Object.keys(k).sort(), k.slug).toEqual(['name', 'slug']);
			}
		}
	});

	it('enthaelt den Rueckfall der Kaskade', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => o.kinder.map((k) => k.slug));
		expect(alle).toContain(SONSTIGES_UNSORTIERT_SLUG);
	});

	// Review Aufgabe 5, Befund 1/A: kaskade.ts verlaesst sich fuer Pfand/Leergut und
	// Rabatt auf diese beiden Slugs. Sie sind zwar schon dieselbe Quelle wie der Baum
	// (siehe baum.ts), aber ein Tippfehler an DIESER Stelle (Konstante vs. Blatt im
	// Baum) waere sonst still moeglich — dieser Test faengt genau das.
	it('enthaelt die Pfand- und Rabatt-Zweige der Kaskade', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => o.kinder.map((k) => k.slug));
		expect(alle).toContain(SONSTIGES_PFAND_SLUG);
		expect(alle).toContain(SONSTIGES_RABATT_SLUG);
	});

	// Slugs landen in Migrationen und im Prompt. Umlaute und Leerzeichen darin waeren
	// eine Fehlerquelle ohne Gegenwert.
	it('nutzt nur unbedenkliche Zeichen im slug', () => {
		const alle = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
		for (const s of alle) expect(s, s).toMatch(/^[a-z0-9-]+$/);
	});
});
