import { describe, it, expect } from 'vitest';
import { otsu, findeBon, graubild } from './ecken';
import type { Quad } from '$lib/client/crop';

/** Graubild mit dunklem Grund und einem hellen, beliebigen Viereck (Punkt-im-Polygon). */
function mitViereck(breite: number, hoehe: number, q: Quad, grund = 40, bon = 230): Uint8Array {
	const g = new Uint8Array(breite * hoehe).fill(grund);
	const innen = (x: number, y: number) => {
		let drin = false;
		for (let i = 0, j = 3; i < 4; j = i++) {
			const a = q[i];
			const b = q[j];
			if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) drin = !drin;
		}
		return drin;
	};
	for (let y = 0; y < hoehe; y++) for (let x = 0; x < breite; x++) if (innen(x + 0.5, y + 0.5)) g[y * breite + x] = bon;
	return g;
}

describe('otsu', () => {
	it('trennt zwei Gipfel dazwischen', () => {
		const g = new Uint8Array(1000);
		g.fill(30, 0, 600);
		g.fill(220, 600);
		const t = otsu(g);
		expect(t).toBeGreaterThanOrEqual(30);
		expect(t).toBeLessThan(220);
	});
});

describe('findeBon', () => {
	const q: Quad = [
		{ x: 60, y: 30 },
		{ x: 150, y: 45 },
		{ x: 135, y: 270 },
		{ x: 45, y: 255 }
	];

	it('findet die Ecken eines schraeg liegenden hellen Bons auf dunklem Grund', () => {
		const r = findeBon(mitViereck(200, 300, q), 200, 300);
		expect(r).not.toBeNull();
		r!.forEach((p, i) => {
			expect(Math.hypot(p.x - q[i].x, p.y - q[i].y)).toBeLessThanOrEqual(4);
		});
	});

	it('meldet nichts auf einem ganz hellen Bild', () => {
		expect(findeBon(new Uint8Array(200 * 300).fill(240), 200, 300)).toBeNull();
	});

	it('meldet nichts fuer einen winzigen Fleck', () => {
		const klein: Quad = [
			{ x: 10, y: 10 },
			{ x: 15, y: 10 },
			{ x: 15, y: 15 },
			{ x: 10, y: 15 }
		];
		expect(findeBon(mitViereck(200, 300, klein), 200, 300)).toBeNull();
	});

	it('meldet nichts, wenn der helle Teil fast alles fuellt', () => {
		const gross: Quad = [
			{ x: 0, y: 0 },
			{ x: 199, y: 0 },
			{ x: 199, y: 299 },
			{ x: 0, y: 299 }
		];
		expect(findeBon(mitViereck(200, 300, gross), 200, 300)).toBeNull();
	});
});

// Pruefung 30.09.2026: Alltagsszenen, in denen die Flaechenregel allein falsche Ecken als
// „erkannt" meldete. Lieber keine Aussage (ganzes Bild) als ein verzerrter Upload.
describe('findeBon — Alltagsszenen', () => {
	const q: Quad = [
		{ x: 60, y: 40 },
		{ x: 150, y: 50 },
		{ x: 140, y: 260 },
		{ x: 50, y: 250 }
	];
	/** Zeichnet ein achsparalleles Rechteck in ein Graubild. */
	function rechteck(g: Uint8Array, breite: number, x0: number, y0: number, x1: number, y1: number, wert: number) {
		for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * breite + x] = wert;
	}

	it('meldet nichts auf einem weissen Tisch — die helle Flaeche beruehrt alle Raender', () => {
		const g = mitViereck(200, 300, q, 245, 215);
		for (let y = 60; y < 240; y += 12) rechteck(g, 200, 70, y, 130, y + 4, 60); // Textzeilen
		expect(findeBon(g, 200, 300)).toBeNull();
	});

	it('meldet nichts, wenn eine helle Hand am Bon haengt und zum Bildrand laeuft', () => {
		const g = mitViereck(200, 300, q);
		rechteck(g, 200, 140, 120, 200, 160, 200); // Arm vom Bon zum rechten Rand
		expect(findeBon(g, 200, 300)).toBeNull();
	});

	it('meldet nichts, wenn ein zweiter Zettel den Bon beruehrt', () => {
		const g = mitViereck(200, 300, q);
		rechteck(g, 200, 130, 200, 190, 290, 225);
		expect(findeBon(g, 200, 300)).toBeNull();
	});

	it('erkennt weiter einen Bon mit Text, auch wenn er oben und unten ueber den Rand geht', () => {
		const lang: Quad = [
			{ x: 60, y: 0 },
			{ x: 140, y: 0 },
			{ x: 140, y: 300 },
			{ x: 60, y: 300 }
		];
		const g = mitViereck(200, 300, lang);
		for (let y = 20; y < 280; y += 12) rechteck(g, 200, 70, y, 125, y + 4, 60);
		const r = findeBon(g, 200, 300);
		expect(r).not.toBeNull();
		r!.forEach((p, i) => expect(Math.hypot(p.x - lang[i].x, p.y - lang[i].y)).toBeLessThanOrEqual(4));
	});

	it('erkennt weiter einen schraegen Bon mit Textzeilen', () => {
		const g = mitViereck(200, 300, q);
		for (let y = 70; y < 230; y += 12) rechteck(g, 200, 75, y, 125, y + 4, 60);
		expect(findeBon(g, 200, 300)).not.toBeNull();
	});
});

describe('graubild', () => {
	it('rechnet RGBA in Helligkeit um', () => {
		const g = graubild(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
		expect(Array.from(g)).toEqual([255, 0]);
	});
});
