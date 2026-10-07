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

/**
 * Streng konvex und im Uhrzeigersinn auf dem Bildschirm (y nach unten) — die Reihenfolge, die
 * defaultQuad und die Erkennung liefern. Ueber Kreuz liegende Ecken entzerrten gespiegelt (2.14c).
 */
export function istKonvex(q: Quad): boolean {
	for (let i = 0; i < 4; i++) {
		const a = q[i];
		const b = q[(i + 1) % 4];
		const c = q[(i + 2) % 4];
		if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
	}
	return true;
}

/** Ein Eckzug, der das Viereck nicht-konvex MACHEN wuerde, zaehlt nicht; ein schon schiefes darf repariert werden. */
export function zugErlaubt(alt: Quad, neu: Quad): boolean {
	return !istKonvex(alt) || istKonvex(neu);
}
