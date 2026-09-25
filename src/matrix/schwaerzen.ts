/**
 * Schwärzt Bot-Token und Authorization-Header aus einem Fehler, bevor er geloggt
 * wird (Korrekturrunde 1, W1). `matrix-bot-sdk` wirft bei einer Nicht-2xx-Antwort
 * OHNE `errcode`-Feld das ROHE HTTP-Antwortobjekt der `request`-Bibliothek
 * (`http.js`: `throw response;`, Zeile ~105) — das trägt über
 * `response.request.headers.Authorization` das Bot-Token im Klartext, vom Prüfer
 * empirisch bestätigt. Das Bot-Token ist ein Geheimnis wie der LLM-Schlüssel: darf
 * nie in einen Alarm, eine Chat-Antwort oder — hier relevant — ins Log geraten.
 *
 * Bewusst KEIN rekursiver Durchlauf durch den ganzen Objektgraphen: Node-HTTP-
 * Antwortobjekte sind typischerweise zirkulär (`response.request.response ===
 * response`) und tragen Sockets/TLS-Zustand — ein blinder Rundgang könnte selbst
 * zur Fehlerquelle werden (Endlosschleife, Zugriff auf Getter mit
 * Seiteneffekten). Stattdessen: bei einer echten `Error`-Instanz nur die
 * Nachricht auf ein Token-Muster prüfen (MatrixError trägt ohnehin nur
 * errcode/error/statusCode, keine Header — siehe SDK-Quelltext); sonst eine
 * kleine, gezielt zusammengestellte Zusammenfassung (Statuscode, Methode, URL)
 * statt des Rohobjekts.
 */
export function schwaerzeFehler(err: unknown): unknown {
	if (err instanceof Error) {
		if (!GEHEIMES_MUSTER.test(err.message)) return err;
		const kopie = new Error(schwaerzeText(err.message));
		kopie.name = err.name;
		kopie.stack = err.stack;
		return kopie;
	}
	return sichereZusammenfassung(err);
}

/** Bearer-Token oder `access_token=…`, auch mitten in einem längeren Text. */
const GEHEIMES_MUSTER = /(bearer\s+)[\w.-]{8,}|(access_token=)[^&\s"']+/gi;

function schwaerzeText(text: string): string {
	return text.replace(GEHEIMES_MUSTER, (_treffer, bearer, query) =>
		bearer ? `${bearer}[REDACTED]` : `${query}[REDACTED]`
	);
}

/**
 * Zieht aus einem rohen (vermutlich `request`-)Antwortobjekt nur eine Handvoll
 * bekannt unbedenklicher Felder heraus, statt es komplett zu loggen. Fehlt eines
 * der Felder, bleibt es einfach weg — nie ein roher Objektzugriff, der selbst
 * werfen könnte.
 */
function sichereZusammenfassung(wert: unknown): unknown {
	if (typeof wert === 'string') return schwaerzeText(wert);
	if (typeof wert !== 'object' || wert === null) return wert;
	const w = wert as {
		statusCode?: unknown;
		statusMessage?: unknown;
		request?: { method?: unknown; href?: unknown; uri?: { href?: unknown } };
	};
	const url = w.request?.href ?? w.request?.uri?.href;
	return {
		hinweis: 'HTTP-Fehler von matrix-bot-sdk (Header/Zugangsdaten entfernt)',
		statusCode: w.statusCode,
		statusMessage: w.statusMessage,
		methode: w.request?.method,
		url: typeof url === 'string' ? schwaerzeText(url) : undefined
	};
}
