import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Sammelfassung 3.4: Tuerkis als Text (#07889a) hatte auf Weiss nur 4,2:1 — unter der
 * WCAG-Schwelle 4,5:1 fuer normalen Text. Geprueft wird die ECHTE layout.css, damit eine
 * spaetere Farbaenderung nicht still darunter faellt.
 */
const css = readFileSync('src/routes/layout.css', 'utf8');

function farbe(name: string): string {
	const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
	if (!m) throw new Error(`--color-${name} fehlt in layout.css`);
	return m[1];
}

/** Relative Leuchtdichte nach WCAG 2.2. */
function leuchtdichte(hex: string): number {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a: string, b: string): number {
	const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
	return (hell + 0.05) / (dunkel + 0.05);
}

describe('Kontrast der Textfarben (WCAG AA, 4,5:1)', () => {
	it('rechnet wie WCAG', () => {
		expect(kontrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(kontrast('#07889a', '#ffffff')).toBeCloseTo(4.2, 1);
	});

	for (const flaeche of ['papier', 'flaeche', 'tuerkis-flaeche', 'chip']) {
		it(`tuerkis-dunkel auf ${flaeche}`, () => {
			expect(kontrast(farbe('tuerkis-dunkel'), farbe(flaeche))).toBeGreaterThanOrEqual(4.5);
		});
	}

	it('rot-dunkel und gedaempft auf papier', () => {
		expect(kontrast(farbe('rot-dunkel'), farbe('papier'))).toBeGreaterThanOrEqual(4.5);
		expect(kontrast(farbe('gedaempft'), farbe('papier'))).toBeGreaterThanOrEqual(4.5);
	});
});
