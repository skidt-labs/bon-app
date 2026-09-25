/**
 * Number('') ist 0 — und 0 ist endlich. Eine LEERE Preisvariable (genau die Form, in
 * der sie in .env.example steht) haette deshalb die Kosten als 0 gespeichert, also
 * behauptet, der Aufruf sei kostenlos gewesen. Das ist die "eine 0 ist eine
 * Behauptung, null ist eine Leerstelle"-Regel des Projekts, an der einen Stelle, wo
 * JavaScript sie von selbst verletzt. Eine ausdrueckliche "0" bleibt dagegen eine
 * gueltige Angabe: ein kostenloses Modell darf 0 kosten.
 */
export function preisAusEnv(wert: string | undefined): number | null {
	if (wert === undefined || wert.trim() === '') return null;
	const n = Number(wert);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

export type Preise = { einMicro: number | null; ausMicro: number | null };

export function preiseAusEnv(env: NodeJS.ProcessEnv = process.env): Preise {
	return {
		einMicro: preisAusEnv(env.EXTRACTION_PRICE_IN_MICRO),
		ausMicro: preisAusEnv(env.EXTRACTION_PRICE_OUT_MICRO)
	};
}
