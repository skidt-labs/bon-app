/** „Doch ein Bon, lesen" als Aufruf — wie papierkorbAktion ohne Browser testbar. */
export async function dochEinBonAnfrage(
	id: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: true } | { ok: false; meldung: string }> {
	let antwort: Response;
	try {
		antwort = await fetchImpl(`/api/receipts/${id}/kein-bon`, { method: 'POST' });
	} catch {
		return { ok: false, meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' };
	}
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
