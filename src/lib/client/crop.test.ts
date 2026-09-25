import { describe, it, expect } from 'vitest';
import { boundingBox, clampQuad, defaultQuad } from './crop';
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
