/**
 * Ob die Symbolleiste am Desktop ausgeklappt ist (216 px mit Namen) oder nicht (64 px).
 *
 * Der Zustand liegt im Browser und bleibt, bis man ihn aendert — Entscheidung des
 * Betreibers (Runde 3): "die Moeglichkeit haben, das Menue auszuklappen, um die Namen
 * zu sehen". Der Speicher wird uebergeben statt global gelesen, damit die Funktionen
 * ohne Browser testbar sind und serverseitig (kein localStorage) sauber den Standard
 * liefern.
 */
export type SpeicherWieStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const LEISTE_SCHLUESSEL = 'bon-leiste';

export function leisteOffen(speicher: SpeicherWieStorage | null): boolean {
	if (!speicher) return false;
	try {
		return speicher.getItem(LEISTE_SCHLUESSEL) === 'offen';
	} catch {
		// Ein Speicher, der beim Lesen wirft, ist wie keiner: Standard, kein Fehler.
		return false;
	}
}

export function leisteSetzen(speicher: SpeicherWieStorage | null, offen: boolean): void {
	if (!speicher) return;
	try {
		speicher.setItem(LEISTE_SCHLUESSEL, offen ? 'offen' : 'zu');
	} catch {
		// Nicht merken koennen ist kein Grund, die Seite scheitern zu lassen.
	}
}
