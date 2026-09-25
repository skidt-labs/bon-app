import { MONETAER, type EditorZeile } from './editor';

/**
 * Die Rechenprobe einer Position: passt Menge × Einzelpreis zum Gesamtbetrag?
 *
 * Sie ergaenzt den Bildabgleich (abweichung.ts), und zwar an der anderen Fehlerart.
 * Der Bildabgleich findet Werte, die vom BON abweichen. Die Rechenprobe findet Werte,
 * die sich SELBST widersprechen — auch dann, wenn im Bild gar nichts dazu steht.
 *
 * Der Anlass, ALDI-Bon vom 17.09.2026: im Bild steht „COLA MIX/ZERO1,5". Die 1,5 ist
 * die Gebindegroesse, die PaddleOCR ohne Leerzeichen an den Namen geklebt hat; das
 * Modell machte daraus einen Einzelpreis von 1,50 EUR, waehrend der Bon 0,65 EUR
 * druckt. Auf dem Bon steht gar kein Literpreis — nur ein Endpreis. Die richtige
 * Antwort ist deshalb eine Leerstelle, keine gerechnete Zahl.
 */

/** Runden darf einen Cent kosten: 2,5 × 2,49 = 6,225, gespeichert sind 6,22. */
const SPIELRAUM_CENT = 1;

/**
 * Die Menge als Zahl. `quantity` ist Freitext, weil auf Bons alles Moegliche steht
 * („2,5 kg", „3 Stk", „ca."). Was sich nicht eindeutig lesen laesst, ist `null` — nicht
 * 0: eine Null waere eine Behauptung, und die Rechenprobe baute daraus einen falschen
 * Hinweis. Null und negative Mengen zaehlen ebenfalls als unlesbar.
 */
export function mengeAlsZahl(quantity: string | null): number | null {
	if (!quantity) return null;
	const treffer = /-?\d+(?:[.,]\d+)?/.exec(quantity.trim());
	if (!treffer) return null;
	const n = Number(treffer[0].replace(',', '.'));
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

/**
 * `{ erwartet }` mit dem Betrag, den Menge × Einzelpreis ergibt, wenn er nicht zum
 * Gesamtbetrag passt — sonst `null`.
 *
 * Verglichen werden die BETRAEGE ohne Vorzeichen: ein Rabatt traegt beide Werte negativ,
 * und das Vorzeichen ist nicht der Punkt der Probe.
 */
export function rechenprobe(z: EditorZeile): { erwartet: number } | null {
	if (!MONETAER.includes(z.lineType)) return null;
	if (z.unitPriceCents === null) return null;
	const menge = mengeAlsZahl(z.quantity);
	if (menge === null) return null;

	const erwartet = Math.round(menge * Math.abs(z.unitPriceCents));
	if (Math.abs(erwartet - Math.abs(z.totalPriceCents)) <= SPIELRAUM_CENT) return null;
	return { erwartet };
}
