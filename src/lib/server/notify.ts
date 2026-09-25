/**
 * K2 (Korrekturrunde 2): Dieser Weg ist der Alarm, mit dem E2 den Preis für E1
 * bezahlt — „Jedes nicht entschlüsselbare Ereignis erzeugt eine Antwort im Chat UND
 * einen Alarm". Bis eben konnte er still tot sein, ohne dass das je auffiel: `fetch`
 * wirft bei HTTP 401/403/404 NICHT, und die Antwort wurde nie ausgewertet — ein
 * widerrufener oder rotierter `MATRIX_TOKEN`, ein falscher `MATRIX_ROOM` oder ein
 * Rauswurf aus „Server Alarme" ergaben eine Funktion, die erfolgreich zurückkehrte
 * und nichts gesendet hatte. Jetzt wird die Antwort ausgewertet und ein Fehlschlag
 * mit Statuscode laut geloggt.
 *
 * Offener Punkt, bewusst nicht stillschweigend gelöst (Ruling Korrekturrunde 2):
 * Fehlen `MATRIX_HOMESERVER`/`MATRIX_ROOM`/`MATRIX_TOKEN`, kehrt diese Funktion
 * weiterhin still zurück — das grundsätzliche „wer bewacht den Wächter" lässt sich
 * über denselben Kanal nicht lösen (ein Alarm über einen kaputten Alarmweg braucht
 * einen ZWEITEN Weg, den es hier nicht gibt). Beide Aufrufer prüfen die drei
 * Variablen deshalb selbst beim eigenen Start und scheitern laut, wenn sie fehlen
 * (analog zu `MATRIX_BOT_TOKEN`): `starteMatrixBot()` in `client.ts` (seit
 * Korrekturrunde 2) und `src/worker/index.ts` (nachgezogen in Korrekturrunde 3,
 * nachdem genau diese Lücke dort gemeldet wurde). Ab dem jeweiligen Start sind die
 * drei Variablen für die Laufzeit des Prozesses garantiert gesetzt — der stille
 * Rückfall hier greift nur noch, falls ein DRITTER Aufrufer künftig dazukommt, ohne
 * dieselbe Prüfung mitzubringen.
 */
export async function notifyMatrix(text: string): Promise<void> {
	const { MATRIX_HOMESERVER, MATRIX_ROOM, MATRIX_TOKEN } = process.env;
	if (!MATRIX_HOMESERVER || !MATRIX_ROOM || !MATRIX_TOKEN) return;
	const url = `${MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(MATRIX_ROOM)}/send/m.room.message/${Date.now()}`;
	try {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { authorization: `Bearer ${MATRIX_TOKEN}`, 'content-type': 'application/json' },
			body: JSON.stringify({ msgtype: 'm.text', body: text })
		});
		if (!res.ok) {
			// K2: genau die Lücke, die den Alarmweg still tot sein liess. `fetch` wirft
			// bei 4xx/5xx nicht — ohne diese Prüfung kehrte die Funktion erfolgreich
			// zurück, obwohl nichts angekommen ist. Response-Body NICHT loggen: Synapse
			// kann darin das Token oder den Raum widerspiegeln.
			console.error(`[notify] Matrix-Alarm abgelehnt: HTTP ${res.status} ${res.statusText}`);
		}
	} catch (err) {
		console.error('[notify] Matrix-Nachricht fehlgeschlagen', err);
	}
}
