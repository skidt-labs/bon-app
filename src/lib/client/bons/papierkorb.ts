/**
 * Die Antwort der drei Papierkorb-Aufrufe. `eingereiht`/`status` kommen nur von
 * „wiederherstellen" (Zielstatus; bei `pending` und `eingereiht: false` steht der Bon schon
 * wieder auf „fehlgeschlagen"), `brauchtRueckfrage` nur vom Verwerfen eines bestaetigten Bons.
 */
export type PapierkorbAntwort =
	| { ok: true; eingereiht?: boolean; status?: string }
	| { ok: false; meldung: string; brauchtRueckfrage?: true };

/** Die drei Papierkorb-Aufrufe fuer Pruefansicht und Bonliste — wie erneutLesen testbar ohne Browser. */
export async function papierkorbAktion(
	id: string,
	aktion: 'verwerfen' | 'wiederherstellen' | 'loeschen',
	rumpf: object = {},
	fetchImpl: typeof fetch = fetch
): Promise<PapierkorbAntwort> {
	let antwort: Response;
	try {
		antwort = await fetchImpl(`/api/receipts/${id}/${aktion}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(rumpf)
		});
	} catch {
		return { ok: false, meldung: 'Keine Verbindung — bitte später noch einmal versuchen.' };
	}
	const j = (await antwort.json().catch(() => null)) as {
		message?: unknown;
		brauchtRueckfrage?: unknown;
		eingereiht?: unknown;
		status?: unknown;
	} | null;
	if (antwort.ok) {
		return {
			ok: true,
			...(typeof j?.eingereiht === 'boolean' ? { eingereiht: j.eingereiht } : {}),
			...(typeof j?.status === 'string' ? { status: j.status } : {})
		};
	}
	const meldung =
		typeof j?.message === 'string' && j.message.trim() !== '' ? j.message : `Das hat nicht geklappt (HTTP ${antwort.status}).`;
	return j?.brauchtRueckfrage === true ? { ok: false, meldung, brauchtRueckfrage: true } : { ok: false, meldung };
}

export type KorbAktion = 'verwerfen' | 'wiederherstellen' | 'loeschen';
export type KorbErgebnis = Awaited<ReturnType<typeof papierkorbAktion>>;
/** Pro Bon: steht die zweite Stufe offen (Bonliste)? */
export type Nachfrage = 'verwerfen' | 'loeschen' | undefined;

export const NICHT_EINGEREIHT_KORB =
	'Aus dem Papierkorb geholt, aber das Lesen ließ sich nicht starten — der Bon steht jetzt unter „Fehlgeschlagen“.';

/**
 * Zweistufig, wo es weh tut: einen bestaetigten Bon verwerfen und endgueltig loeschen. Ob
 * `bestaetigtWegnehmen` mitgeht, haengt an der offenen zweiten Stufe, nicht am Status der
 * Liste — der kann veraltet sein (2.3).
 */
export function korbAnfrage(
	aktion: KorbAktion,
	status: string,
	nachfrage: Nachfrage
): { nachfragen: 'verwerfen' | 'loeschen' } | { rumpf: { bestaetigtWegnehmen?: boolean } } {
	if (aktion === 'loeschen' && nachfrage !== 'loeschen') return { nachfragen: 'loeschen' };
	if (aktion === 'verwerfen' && status === 'confirmed' && nachfrage !== 'verwerfen') return { nachfragen: 'verwerfen' };
	return { rumpf: aktion === 'verwerfen' ? { bestaetigtWegnehmen: nachfrage === 'verwerfen' } : {} };
}

/** 2.11: zurueckgeholt, das Lesen liess sich aber nicht einreihen (Zielstatus war „wartet"). */
export function nichtEingereiht(r: KorbErgebnis): boolean {
	return r.ok && r.status === 'pending' && r.eingereiht === false;
}

/**
 * Was die Bonliste nach der Antwort tut. Bei `brauchtRueckfrage` steht die zweite Stufe offen
 * und sagt selbst, worum es geht — die Meldung des Servers kaeme doppelt.
 */
export function nachKorb(
	aktion: KorbAktion,
	r: KorbErgebnis
): { nachfrage: Nachfrage; meldung: string | null; hinweis: string | null; neuLaden: boolean } {
	if (!r.ok) {
		if (aktion === 'verwerfen' && r.brauchtRueckfrage) {
			return { nachfrage: 'verwerfen', meldung: null, hinweis: null, neuLaden: false };
		}
		return { nachfrage: undefined, meldung: r.meldung, hinweis: null, neuLaden: false };
	}
	return { nachfrage: undefined, meldung: null, hinweis: nichtEingereiht(r) ? NICHT_EINGEREIHT_KORB : null, neuLaden: true };
}
