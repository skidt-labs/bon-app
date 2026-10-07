import { describe, it, expect } from 'vitest';
import { boundingBox, clampQuad, defaultQuad, istKonvex, zugErlaubt } from './crop';
import type { Quad } from './crop';

const quad: Quad = [
	{ x: 20, y: 10 },
	{ x: 180, y: 30 },
	{ x: 170, y: 380 },
	{ x: 30, y: 360 }
];

describe('boundingBox', () => {
	it('umschließt alle vier Ecken', () => {
		expect(boundingBox(quad)).toEqual({ x: 20, y: 10, width: 160, height: 370 });
	});
});

describe('clampQuad', () => {
	it('zieht Ecken in das Bild zurück', () => {
		const out: Quad = [
			{ x: -50, y: -50 },
			{ x: 500, y: -10 },
			{ x: 500, y: 500 },
			{ x: -10, y: 500 }
		];
		const clamped = clampQuad(out, 200, 400);
		expect(clamped[0]).toEqual({ x: 0, y: 0 });
		expect(clamped[2]).toEqual({ x: 200, y: 400 });
	});
});

describe('defaultQuad', () => {
	it('lässt rundum einen Rand von 5 Prozent', () => {
		const q = defaultQuad(200, 400);
		expect(q[0]).toEqual({ x: 10, y: 20 });
		expect(q[2]).toEqual({ x: 190, y: 380 });
	});
	it('liefert die Ecken im Uhrzeigersinn ab oben links', () => {
		const q = defaultQuad(200, 400);
		expect(q[1].x).toBeGreaterThan(q[0].x);
		expect(q[3].y).toBeGreaterThan(q[0].y);
	});
});

describe('istKonvex', () => {
	it('nimmt ein ordentliches Viereck im Uhrzeigersinn', () => {
		expect(istKonvex(defaultQuad(200, 400))).toBe(true);
		expect(istKonvex(quad)).toBe(true);
	});
	it('lehnt eine nach innen gezogene Ecke ab', () => {
		expect(istKonvex([{ x: 150, y: 300 }, quad[1], quad[2], quad[3]])).toBe(false);
	});
	// 2.14c: ueber Kreuz gezogene Ecken entzerrten das Bild gespiegelt.
	it('lehnt ueber Kreuz liegende Ecken ab', () => {
		expect(istKonvex([quad[1], quad[0], quad[2], quad[3]])).toBe(false);
		expect(istKonvex([{ x: 190, y: 380 }, quad[1], quad[2], quad[3]])).toBe(false);
	});
	it('lehnt die gespiegelte Reihenfolge und drei Ecken auf einer Linie ab', () => {
		expect(istKonvex([...quad].reverse() as Quad)).toBe(false);
		expect(istKonvex([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 300 }])).toBe(false);
	});
});

describe('zugErlaubt', () => {
	it('uebernimmt einen Zug, der das Viereck konvex laesst', () => {
		expect(zugErlaubt(quad, [{ x: 25, y: 15 }, quad[1], quad[2], quad[3]])).toBe(true);
	});
	it('verwirft einen Zug, der es ueber Kreuz legen wuerde', () => {
		expect(zugErlaubt(quad, [{ x: 190, y: 380 }, quad[1], quad[2], quad[3]])).toBe(false);
	});
	// Liefert die Erkennung einmal ein schiefes Viereck, muss es sich von Hand richten lassen.
	it('laesst ein schon kaputtes Viereck reparieren', () => {
		const kaputt: Quad = [quad[1], quad[0], quad[2], quad[3]];
		expect(zugErlaubt(kaputt, [quad[1], { x: 60, y: 10 }, quad[2], quad[3]])).toBe(true);
	});
});
