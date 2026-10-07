/**
 * „Doch ein Bon, lesen" als Aufruf — wie papierkorbAktion ohne Browser testbar. `eingereiht`
 * ist nur bei einem fehlgeschlagenen Bon aussagekraeftig: beim gelesenen faellt bloss der
 * Hinweis weg, eingereiht wird dort nie. Fehlt das Feld, gilt es als eingereiht — gemeldet
 * wird nur, was der Server ausdruecklich verneint (wie queued:false bei erneutLesen).
 */
export async function dochEinBonAnfrage(
	id: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; eingereiht: boolean } | { ok: false; meldung: string }> {
	let antwort: Response;
	try {
		antwort = await fetchImpl(`/api/receipts/${id}/kein-bon`, { method: 'POST' });
	} catch {
		return { ok: false, meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' };
	}
	const j = (await antwort.json().catch(() => null)) as { message?: unknown; eingereiht?: unknown } | null;
	if (antwort.ok) return { ok: true, eingereiht: j?.eingereiht !== false };
	const meldung =
		typeof j?.message === 'string' && j.message.trim() !== '' ? j.message : `Das hat nicht geklappt (HTTP ${antwort.status}).`;
	return { ok: false, meldung };
}

export type DochEinBonAntwort = Awaited<ReturnType<typeof dochEinBonAnfrage>>;

export const NICHT_EINGEREIHT_DOCH_EIN_BON =
	'Das Lesen ließ sich nicht starten — der Bon bleibt fehlgeschlagen. Bitte später noch einmal versuchen.';

/**
 * Was nach „Doch ein Bon" folgt (2.11). Nur ein fehlgeschlagener Bon wird eingereiht; sagt die
 * Antwort `eingereiht: false`, steht er wieder auf „fehlgeschlagen" — das ist kein Erfolg.
 * `liest`: er wartet jetzt aufs Lesen.
 */
export function nachDochEinBon(vorher: string, r: DochEinBonAntwort): { liest: boolean; meldung: string | null } {
	if (!r.ok) return { liest: false, meldung: r.meldung };
	if (vorher !== 'failed') return { liest: false, meldung: null };
	if (r.eingereiht === false) return { liest: false, meldung: NICHT_EINGEREIHT_DOCH_EIN_BON };
	return { liest: true, meldung: null };
}
