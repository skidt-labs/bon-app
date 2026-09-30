import { describe, it, expect } from 'vitest';
import { homographie, abbilden, zielgroesse, entzerre, type Bild } from './entzerren';
import type { Quad } from '$lib/client/crop';

const rechteck = (b: number, h: number): Quad => [
	{ x: 0, y: 0 },
	{ x: b, y: 0 },
	{ x: b, y: h },
	{ x: 0, y: h }
];
const schraeg: Quad = [
	{ x: 8, y: 5 },
	{ x: 34, y: 9 },
	{ x: 30, y: 36 },
	{ x: 4, y: 31 }
];

describe('homographie', () => {
	it('bildet die vier Ecken exakt ab', () => {
		const H = homographie(rechteck(100, 200), schraeg);
		rechteck(100, 200).forEach((p, i) => {
			const q = abbilden(H, p.x, p.y);
			expect(q.x).toBeCloseTo(schraeg[i].x, 6);
			expect(q.y).toBeCloseTo(schraeg[i].y, 6);
		});
	});
	it('bildet die Mitte ins Innere ab', () => {
		const q = abbilden(homographie(rechteck(100, 200), schraeg), 50, 100);
		expect(q.x).toBeGreaterThan(10);
		expect(q.x).toBeLessThan(32);
		expect(q.y).toBeGreaterThan(8);
		expect(q.y).toBeLessThan(34);
	});
});

describe('zielgroesse', () => {
	it('nimmt den Mittelwert gegenueberliegender Kanten', () => {
		expect(zielgroesse(rechteck(300, 800))).toEqual({ breite: 300, hoehe: 800 });
	});
	// Pruefung 30.09.2026: fuer das Lesen entscheidet die BREITE (storage/images.ts). Die
	// Ausgabe darf so gross werden, wie der Server speichert — 1600 × 8000 —, nicht kleiner.
	it('laesst einen langen Bon so breit, wie er ist', () => {
		expect(zielgroesse(rechteck(700, 6000))).toEqual({ breite: 700, hoehe: 6000 });
	});
	it('passt in 1600 × 8000 und haelt das Seitenverhaeltnis', () => {
		expect(zielgroesse(rechteck(700, 9000))).toEqual({ breite: 622, hoehe: 8000 });
		expect(zielgroesse(rechteck(3000, 4000))).toEqual({ breite: 1600, hoehe: 2133 });
	});
});

describe('entzerre', () => {
	// Ein 2×2-Schachbrett (dunkel oben links und unten rechts), schraeg in ein 40×40-Bild gezeichnet.
	function schraegesSchachbrett(): Bild {
		const breite = 40;
		const hoehe = 40;
		const daten = new Uint8ClampedArray(breite * hoehe * 4).fill(255);
		const Hi = homographie(schraeg, rechteck(1, 1));
		for (let y = 0; y < hoehe; y++)
			for (let x = 0; x < breite; x++) {
				const p = abbilden(Hi, x + 0.5, y + 0.5);
				if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
				const dunkel = (p.x < 0.5) === (p.y < 0.5);
				const w = dunkel ? 20 : 235;
				const o = (y * breite + x) * 4;
				daten[o] = daten[o + 1] = daten[o + 2] = w;
			}
		return { daten, breite, hoehe };
	}
	const wert = (b: Bild, x: number, y: number) => b.daten[(y * b.breite + x) * 4];

	it('macht aus dem schraegen Viereck wieder ein gerades Schachbrett', () => {
		const aus = entzerre(schraegesSchachbrett(), schraeg, { breite: 20, hoehe: 20 });
		expect(aus.breite).toBe(20);
		expect(wert(aus, 4, 4)).toBeLessThan(80); // oben links dunkel
		expect(wert(aus, 15, 4)).toBeGreaterThan(180); // oben rechts hell
		expect(wert(aus, 4, 15)).toBeGreaterThan(180); // unten links hell
		expect(wert(aus, 15, 15)).toBeLessThan(80); // unten rechts dunkel
	});
});
