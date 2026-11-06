import { error } from '@sveltejs/kit';

/** Welcher Ausweg auf der Seite passt (Entwurf 2026-11-06-pruefhilfen, §4b). */
export type AblehnCode = 'veraltet' | 'status' | 'doppel';

/**
 * Eine 409 beim Speichern oder Bestaetigen — mit Bon-Kennung und Grund im Protokoll (0.12.1).
 * Am 06.11.2026 lehnte ein Bon 22-mal ab, und niemand konnte sehen, warum: SvelteKit
 * protokolliert 4xx nicht. Der Grund nennt nur Zeilennummern/-kennungen und Zustaende, nie
 * Inhalte eines Bons. Die Seite bekommt `textFuerSeite` (Vorgabe: derselbe Grund) und seit
 * 0.13.0 einen `code`, damit sie den passenden Ausweg zeigt statt einer Sackgasse.
 */
export function ablehnen(
	weg: 'speichern' | 'bestaetigen',
	bonId: string,
	grund: string,
	code: AblehnCode,
	textFuerSeite: string = grund
): never {
	console.warn(`[api/receipts] ${weg} ${bonId} abgelehnt (409): ${grund}`);
	error(409, { message: textFuerSeite, code });
}

/** Protokollzeile, wenn „Meine Fassung speichern“ den Bestand ueberschrieben hat. */
export function ueberschriebenProtokollieren(weg: 'speichern' | 'bestaetigen', bonId: string, z: { neu: number; geloescht: number }): void {
	console.warn(`[api/receipts] ${weg} ${bonId} überschrieben (${z.neu} neu, ${z.geloescht} gelöscht)`);
}
