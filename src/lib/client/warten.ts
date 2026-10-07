/**
 * Warten in der Oberflaeche (Sammelfassung 2.6, 2.7). Rein bis auf setTimeout — mit falscher
 * Uhr ohne Browser pruefbar.
 */

/** Takt, in dem die Pruefansicht einen wartenden Bon nachlaedt (2.6). */
export const NACHLADEN_MS = 5000;

/**
 * Laedt alle `ms` nach, bis die Rueckgabe aufgerufen wird. Die naechste Runde startet erst, wenn
 * die vorige fertig ist (kein Stau bei langsamem Netz); ein Fehler beim Laden beendet nichts.
 */
export function nachladenAlle(ms: number, laden: () => Promise<unknown>): () => void {
	let aus = false;
	let uhr: ReturnType<typeof setTimeout> | undefined;
	const runde = () => {
		uhr = setTimeout(async () => {
			try {
				await laden();
			} catch {
				// naechste Runde versucht es wieder
			}
			if (!aus) runde();
		}, ms);
	};
	runde();
	return () => {
		aus = true;
		clearTimeout(uhr);
	};
}

/**
 * 2.7: Der Wartezustand (`busy`, `laufend[id]`) endet erst, wenn auch das anschliessende
 * Neuladen oder Weiterblaettern fertig ist.
 */
export async function mitWartezustand<T>(setze: (an: boolean) => void, f: () => Promise<T>): Promise<T> {
	setze(true);
	try {
		return await f();
	} finally {
		setze(false);
	}
}
