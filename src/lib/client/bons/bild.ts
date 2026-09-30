/** Aufrufe fuer „Bild bearbeiten" und „Original wiederherstellen" — ohne Browser testbar. */
type Ergebnis = { ok: true } | { ok: false; meldung: string };

async function auswerten(antwort: Response): Promise<Ergebnis> {
	if (antwort.ok) return { ok: true };
	let meldung = `Das hat nicht geklappt (HTTP ${antwort.status}).`;
	try {
		const j = (await antwort.json()) as { message?: unknown };
		if (typeof j.message === 'string' && j.message.trim() !== '') meldung = j.message;
	} catch {
		// kein JSON — der Statussatz bleibt
	}
	return { ok: false, meldung };
}

const OFFLINE: Ergebnis = { ok: false, meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' };

export async function bildHochladen(id: string, blob: Blob, fetchImpl: typeof fetch = fetch): Promise<Ergebnis> {
	const form = new FormData();
	form.set('image', blob, 'bon.webp');
	try {
		return await auswerten(await fetchImpl(`/api/receipts/${id}/bild`, { method: 'POST', body: form }));
	} catch {
		return OFFLINE;
	}
}

export async function originalHolen(id: string, fetchImpl: typeof fetch = fetch): Promise<Ergebnis> {
	try {
		return await auswerten(await fetchImpl(`/api/receipts/${id}/bild-original`, { method: 'POST' }));
	} catch {
		return OFFLINE;
	}
}
