/**
 * Entzerren: ein beliebiges Viereck im Foto auf ein gerades Rechteck umrechnen (Entwurf
 * docs/superpowers/specs/2026-09-27-zuschneiden-drehen-design.md). Bis zum 30.09.2026 schnitt
 * das Scannen nur das umschliessende Rechteck der vier Punkte aus — ein schraeg
 * fotografierter Bon blieb schraeg, und eine nach innen gezogene Ecke aenderte oft nichts.
 *
 * Rein: arbeitet auf RGBA-Feldern, damit es sich ohne Browser pruefen laesst.
 */
import type { Corner, Quad } from '$lib/client/crop';

export type Bild = { daten: Uint8ClampedArray; breite: number; hoehe: number };

/** Loest A·x = b (Gauss mit Spaltenpivot). A ist n×n. */
function loese(A: number[][], b: number[]): number[] {
	const n = b.length;
	const M = A.map((zeile, i) => [...zeile, b[i]]);
	for (let s = 0; s < n; s++) {
		let p = s;
		for (let z = s + 1; z < n; z++) if (Math.abs(M[z][s]) > Math.abs(M[p][s])) p = z;
		[M[s], M[p]] = [M[p], M[s]];
		const d = M[s][s];
		if (Math.abs(d) < 1e-12) throw new Error('Viereck ist entartet');
		for (let z = s + 1; z < n; z++) {
			const f = M[z][s] / d;
			for (let k = s; k <= n; k++) M[z][k] -= f * M[s][k];
		}
	}
	const x = new Array<number>(n).fill(0);
	for (let z = n - 1; z >= 0; z--) {
		let summe = M[z][n];
		for (let k = z + 1; k < n; k++) summe -= M[z][k] * x[k];
		x[z] = summe / M[z][z];
	}
	return x;
}

/** Die projektive Abbildung, die die vier Ecken von `von` auf die von `nach` legt (h33 = 1). */
export function homographie(von: Quad, nach: Quad): number[] {
	const A: number[][] = [];
	const b: number[] = [];
	for (let i = 0; i < 4; i++) {
		const { x, y } = von[i];
		const { x: u, y: v } = nach[i];
		A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
		b.push(u);
		A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
		b.push(v);
	}
	return [...loese(A, b), 1];
}

export function abbilden(H: number[], x: number, y: number): Corner {
	const w = H[6] * x + H[7] * y + H[8];
	return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/**
 * Groesse des geraden Bons: Mittel gegenueberliegender Kanten, eingepasst in die Grenze, die
 * auch der Server speichert (storage/images.ts, 1600 × 8000). Nie groesser als die Quelle.
 * Bis zur Pruefung am 30.09.2026 stand hier „lange Seite ≤ 3000" — das machte lange Bons
 * schmaler als vorher, und fuer das Lesen entscheidet die Breite.
 */
export function zielgroesse(q: Quad, grenze = { breite: 1600, hoehe: 8000 }): { breite: number; hoehe: number } {
	const d = (a: Corner, b: Corner) => Math.hypot(a.x - b.x, a.y - b.y);
	const breite = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
	const hoehe = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
	const f = Math.min(1, grenze.breite / breite, grenze.hoehe / hoehe);
	return { breite: Math.max(1, Math.round(breite * f)), hoehe: Math.max(1, Math.round(hoehe * f)) };
}

/** Bilineare Abtastung ueber alle Zielpunkte; ausserhalb des Fotos wird weiss gefuellt. */
export function entzerre(quelle: Bild, quad: Quad, ziel: { breite: number; hoehe: number }): Bild {
	const { breite: B, hoehe: Hz } = ziel;
	const H = homographie(
		[
			{ x: 0, y: 0 },
			{ x: B, y: 0 },
			{ x: B, y: Hz },
			{ x: 0, y: Hz }
		],
		quad
	);
	const { daten: q, breite: qb, hoehe: qh } = quelle;
	const aus = new Uint8ClampedArray(B * Hz * 4);
	const px = (x: number, y: number, c: number) => {
		const xx = x < 0 ? 0 : x >= qb ? qb - 1 : x;
		const yy = y < 0 ? 0 : y >= qh ? qh - 1 : y;
		return q[(yy * qb + xx) * 4 + c];
	};
	for (let y = 0; y < Hz; y++) {
		for (let x = 0; x < B; x++) {
			const s = abbilden(H, x + 0.5, y + 0.5);
			const o = (y * B + x) * 4;
			if (s.x < 0 || s.y < 0 || s.x > qb || s.y > qh) {
				aus[o] = aus[o + 1] = aus[o + 2] = aus[o + 3] = 255;
				continue;
			}
			const fx = s.x - 0.5;
			const fy = s.y - 0.5;
			const x0 = Math.floor(fx);
			const y0 = Math.floor(fy);
			const ax = fx - x0;
			const ay = fy - y0;
			for (let c = 0; c < 4; c++) {
				const oben = px(x0, y0, c) * (1 - ax) + px(x0 + 1, y0, c) * ax;
				const unten = px(x0, y0 + 1, c) * (1 - ax) + px(x0 + 1, y0 + 1, c) * ax;
				aus[o + c] = oben * (1 - ay) + unten * ay;
			}
		}
	}
	return { daten: aus, breite: B, hoehe: Hz };
}
