import { error } from '@sveltejs/kit';
import type { Erwartet } from '$lib/server/bons/vergleich';

/**
 * Der Status, den die Gegenueberstellung bei den Bons gesehen hat (Abschlusspruefung 0.12.0,
 * Wichtig 1). Fehlt das Feld, wird nicht geprueft; ist es kaputt, 400 statt einer stillen Annahme.
 */
export function leseErwartet(roh: unknown): Erwartet | undefined {
	if (roh === undefined) return undefined;
	if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) error(400, 'Feld "erwartet" ungültig');
	for (const wert of Object.values(roh)) if (typeof wert !== 'string') error(400, 'Feld "erwartet" ungültig');
	return roh as Erwartet;
}
