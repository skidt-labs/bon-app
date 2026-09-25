export type Corner = { x: number; y: number };
export type Quad = [Corner, Corner, Corner, Corner];

export function boundingBox(quad: Quad) {
	const xs = quad.map((c) => c.x);
	const ys = quad.map((c) => c.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function clampQuad(quad: Quad, width: number, height: number): Quad {
	return quad.map((c) => ({
		x: Math.min(Math.max(c.x, 0), width),
		y: Math.min(Math.max(c.y, 0), height)
	})) as Quad;
}

/** Ecken im Uhrzeigersinn ab oben links, mit 5 % Rand. */
export function defaultQuad(width: number, height: number): Quad {
	const mx = width * 0.05;
	const my = height * 0.05;
	return [
		{ x: mx, y: my },
		{ x: width - mx, y: my },
		{ x: width - mx, y: height - my },
		{ x: mx, y: height - my }
	];
}
