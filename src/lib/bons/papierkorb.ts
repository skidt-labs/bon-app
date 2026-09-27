/** Wie lange ein verworfener Bon wiederherstellbar bleibt (Entscheidung 27.09.2026). */
export const PAPIERKORB_TAGE = 30;
const TAG_MS = 24 * 60 * 60 * 1000;

/** Ganze Tage, bis der Bon endgueltig geloescht wird; angebrochene zaehlen voll, nie < 0. */
export function restTage(verworfenAm: Date | string, jetzt: Date): number {
	const ende = new Date(verworfenAm).getTime() + PAPIERKORB_TAGE * TAG_MS;
	return Math.max(0, Math.ceil((ende - jetzt.getTime()) / TAG_MS));
}
