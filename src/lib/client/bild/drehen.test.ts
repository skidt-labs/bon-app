import { describe, it, expect } from 'vitest';
import { gedrehteGroesse, arbeitsMassstab } from './drehen';

describe('gedrehteGroesse', () => {
	it('tauscht Breite und Hoehe bei Vierteldrehungen', () => {
		expect(gedrehteGroesse(300, 800, 0)).toEqual({ breite: 300, hoehe: 800 });
		expect(gedrehteGroesse(300, 800, 90)).toEqual({ breite: 800, hoehe: 300 });
		expect(gedrehteGroesse(300, 800, 180)).toEqual({ breite: 300, hoehe: 800 });
		expect(gedrehteGroesse(300, 800, -90)).toEqual({ breite: 800, hoehe: 300 });
	});
	it('umschliesst das schraeg gedrehte Bild', () => {
		const g = gedrehteGroesse(100, 100, 45);
		expect(g.breite).toBe(Math.round(100 * Math.SQRT2));
		expect(g.hoehe).toBe(Math.round(100 * Math.SQRT2));
	});
});

// Die Leinwand darf 16 MP nicht ueberschreiten — Safari am iPhone liefert darueber keinen
// Zeichenkontext mehr, und der Bildschirm waere tot (Pruefung 30.09.2026).
describe('arbeitsMassstab', () => {
	it('laesst ein 12-MP-Foto in voller Groesse', () => {
		expect(arbeitsMassstab(4000, 3000, 0)).toBe(1);
	});
	it('verkleinert ein 24-MP-Foto auf 16 MP', () => {
		const f = arbeitsMassstab(6000, 4000, 0);
		expect(6000 * f * 4000 * f).toBeLessThanOrEqual(16_000_000);
		expect(6000 * f * 4000 * f).toBeGreaterThan(15_900_000);
	});
	it('rechnet die Drehung mit ein', () => {
		const f = arbeitsMassstab(3000, 3000, 45);
		const g = gedrehteGroesse(3000 * f, 3000 * f, 45);
		expect(g.breite * g.hoehe).toBeLessThanOrEqual(16_000_000);
	});
});
