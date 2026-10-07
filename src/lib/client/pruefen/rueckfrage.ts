/**
 * Wohin der Fehler einer Papierkorb-Aktion in der Pruefansicht gehoert (1.6, 2.3). Kam die
 * Aktion aus der Rueckfrage, steht er IN ihr — sie bleibt offen, der Mensch sieht ihn dort,
 * wo er geklickt hat. Sonst (Wiederherstellen im Kopf) unten als Meldung. Bei
 * `brauchtRueckfrage` ist der Bon inzwischen bestaetigt (anderer Tab): neu laden, dann ist
 * `bestaetigt` wahr, und der naechste Klick schickt bestaetigtWegnehmen: true — sonst liefe
 * jeder weitere Klick wieder in dieselbe 409.
 */
export function nachKorbFehler(
	r: { meldung: string; brauchtRueckfrage?: boolean },
	ausRueckfrage: boolean
): { rueckfrageFehler: string; meldung: string; neuLaden: boolean } {
	return {
		rueckfrageFehler: ausRueckfrage ? r.meldung : '',
		meldung: ausRueckfrage ? '' : r.meldung,
		neuLaden: r.brauchtRueckfrage === true
	};
}
