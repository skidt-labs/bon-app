/** Groesse des Rechtecks, das ein um `grad` gedrehtes Bild umschliesst (fuer den Canvas). */
export function gedrehteGroesse(breite: number, hoehe: number, grad: number): { breite: number; hoehe: number } {
	const r = (grad * Math.PI) / 180;
	const c = Math.abs(Math.cos(r));
	const s = Math.abs(Math.sin(r));
	return { breite: Math.round(breite * c + hoehe * s), hoehe: Math.round(breite * s + hoehe * c) };
}

/** Groesste Leinwand, die Safari am iPhone noch zeichnet (≈ 16,7 MP), mit etwas Luft. */
export const MAX_FLAECHE = 16_000_000;

/** Verkleinerung, damit das GEDREHTE Arbeitsbild hoechstens `maxFlaeche` Pixel hat (nie > 1). */
export function arbeitsMassstab(breite: number, hoehe: number, grad: number, maxFlaeche = MAX_FLAECHE): number {
	const g = gedrehteGroesse(breite, hoehe, grad);
	// Etwas unter der Wurzel bleiben: gedrehteGroesse rundet auf ganze Pixel.
	return Math.min(1, Math.sqrt(maxFlaeche / (g.breite * g.hoehe)) * 0.999);
}
