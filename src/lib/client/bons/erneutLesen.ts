/**
 * Der Knopf "Erneut lesen" als Funktion. Ruft den bestehenden Endpunkt
 * POST /api/receipts/[id]/reprocess (Aufgabe 4 Teil B), der einen Bon aus `failed`
 * zurueck in die Warteschlange stellt. Den Endpunkt gab es; der Knopf fehlte — am
 * 17.09. musste ein zu Unrecht verworfener Bon deshalb von der Kommandozeile
 * zurueckgeholt werden.
 *
 * `fetchImpl` ist einsetzbar, damit die Faelle (200, 409 mit Meldung, 5xx ohne, Netz weg)
 * ohne Browser testbar sind.
 */
export async function erneutLesen(
	id: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: true } | { ok: false; meldung: string }> {
	let antwort: Response;
	try {
		antwort = await fetchImpl(`/api/receipts/${id}/reprocess`, { method: 'POST' });
	} catch {
		return { ok: false, meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' };
	}
	if (antwort.ok) {
		// 200 heisst nicht immer „eingereiht": scheiterte das Einreihen, steht der Bon wieder
		// auf fehlgeschlagen, und die Antwort sagt queued:false.
		const j = (await antwort.json().catch(() => null)) as { queued?: unknown } | null;
		if (j?.queued === false) {
			return { ok: false, meldung: 'Konnte nicht eingereiht werden — bitte später noch einmal versuchen.' };
		}
		return { ok: true };
	}

	// SvelteKit antwortet auf error(status, text) mit {"message": text}: der Satz fuer
	// den Menschen. Traegt der Rumpf keinen, bleibt wenigstens der Status stehen.
	let meldung = `Erneut lesen nicht möglich (HTTP ${antwort.status}).`;
	const text = await antwort.text().catch(() => '');
	try {
		const json = JSON.parse(text) as { message?: unknown };
		if (typeof json.message === 'string' && json.message.trim() !== '') meldung = json.message;
	} catch {
		// kein JSON — der Statussatz bleibt
	}
	return { ok: false, meldung };
}
