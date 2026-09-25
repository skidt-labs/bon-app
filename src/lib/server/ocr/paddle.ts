import type { OcrAnbieter, OcrAnbieterErgebnis, OcrLaufDaten, OcrWort, OcrZeile } from './anbieter';

/**
 * Zeitlimit fuer einen einzelnen PaddleOCR-Lauf.
 *
 * Gemessen am 2026-09-16 an allen neun echten Bons im Bestand: 3,7 s bis 15,6 s.
 * Die Grenze liegt bewusst weit darueber — sie soll einen regulaeren Lauf NIE treffen,
 * sondern einen haengenden Dienst beenden, bevor er einen Worker-Slot dauerhaft
 * blockiert. Dieselbe Regel und derselbe Grund wie bei OCR_ZEITLIMIT_MS (Tesseract,
 * 20 s bei ~1 s Messwert); PaddleOCR ist schlicht langsamer, also ist die Grenze hoeher.
 *
 * Sie kommt zur Modellzeit HINZU (OCR laeuft vor dem Modellaufruf) — siehe die
 * Fristen-Ordnung in `queue/fristen.ts`.
 */
export const PADDLE_ZEITLIMIT_MS = 60_000;

export const PADDLE_STANDARD_URL = 'http://bon-paddleocr:8000';

/**
 * Was der Dienst zurueckgibt. Bewusst als eigener Typ und nicht als `any` durchgereicht:
 * er ist die Grenze zwischen zwei Sprachen, und an Grenzen entstehen die Fehler, die
 * hinterher niemand mehr zuordnen kann.
 */
type DienstErkennung = {
	text: string;
	/** 0..1 — der Dienst reicht PaddleOCRs eigene Skala durch. Siehe `alsProzent`. */
	confidence: number;
	box: [number, number, number, number];
};

type DienstAntwort = {
	erkennungen: DienstErkennung[];
	durationMs: number;
	engineVersion?: string;
	options: Record<string, unknown>;
};

/**
 * PaddleOCR meldet Confidence als 0..1, Tesseract als 0..100.
 *
 * Beide Zahlen landen in DEMSELBEN Feld (`OcrWort.confidence`). Unumgerechnet waere
 * eine Paddle-Confidence von 0,97 neben einer Tesseract-Confidence von 96 die Aussage
 * "fast wertlos" neben "sehr sicher" — und jeder Mittelwert ueber beide Engines waere
 * still unsinnig, ohne dass irgendwo etwas rot wird. Genau die Sorte Fehler, die dieses
 * Projekt teuer bezahlt hat.
 *
 * Umgerechnet wird PADDLE nach Tesseract und nicht umgekehrt, weil Tesseracts Skala
 * bereits in den eingefrorenen Vorlagen und in den bestehenden Tests steht.
 */
export function alsProzent(confidence: number): number {
	return confidence * 100;
}

function zeileAus(e: DienstErkennung): OcrZeile {
	const wort: OcrWort = { text: e.text, confidence: alsProzent(e.confidence), box: e.box };
	// Eine Erkennung ist bei PaddleOCR ein Textkasten, kein Wort. Sie taucht deshalb
	// als Zeile UND als ihr einziges Wort auf: die Zeile ist, was das Modell zu sehen
	// bekommt, das Wort traegt denselben Rahmen fuer alles, was Koordinaten auswertet.
	return { text: e.text, confidence: wort.confidence, box: e.box, woerter: [wort] };
}

/**
 * PaddleOCR hinter derselben Schnittstelle wie Tesseract.
 *
 * Der Zuschnitt (Etappe 3): der Python-Dienst LIEST und gibt Erkennungen zurueck; das
 * Zusammensetzen zum Bon-Text und die Dreizustands-Zuordnung passieren hier. Grund wie
 * bei `ausTsv`: die Zusammenbau-Regel ist die Stelle, an der sich still etwas
 * verschieben kann, und sie gehoert dorthin, wo Tests sie festhalten.
 *
 * **Eine Erkennung = eine Zeile.** Gemessen an den neun echten Bons ergibt das 85 bis
 * 171 Zeilen je Bon, deutlich mehr als bei Tesseract — Artikelname und Preis stehen
 * dann getrennt. Genau deshalb liest PaddleOCR den Jack-Wolfskin-Bon richtig, an dem
 * Tesseract den Preis zerstoert. Kaesten anhand ihrer y-Lage zusammenzuziehen waere
 * moeglich und vielleicht besser fuer das Modell — das ist eine Aenderung mit messbarer
 * Folge und gehoert hinter die Messung (Etappe 4), nicht davor.
 */
export function erzeugePaddleOcrAnbieter(deps?: {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}): OcrAnbieter {
	const baseUrl = (deps?.baseUrl ?? PADDLE_STANDARD_URL).replace(/\/+$/, '');
	const doFetch = deps?.fetchImpl ?? fetch;

	return {
		name: 'paddleocr',
		async lies(bildPfadOderPuffer, opts) {
			const mitBoxen = opts?.mitBoxen ?? false;
			const begonnen = Date.now();
			// `options` wird unten durch die Angabe des Dienstes ERSETZT, sobald er
			// geantwortet hat: was der Engine wirklich uebergeben wurde, weiss nur er
			// (die Groessengrenze steht fest im Dienst, nicht in der Anfrage). Dies hier
			// ist nur der Rueckfall fuer den Fall, dass es nie zu einer Antwort kam.
			const lauf = (
				zusatz?: { engineVersion?: string; options?: Record<string, unknown> }
			): OcrLaufDaten => ({
				engine: 'paddleocr',
				durationMs: Date.now() - begonnen,
				options: { mitBoxen },
				...zusatz
			});

			if (typeof bildPfadOderPuffer === 'string') {
				// Bewusst keine Datei-Unterstuetzung: der Dienst laeuft in einem eigenen
				// Container und sieht das Dateisystem des Workers nicht. Ein Pfad waere
				// dort schlicht nicht vorhanden — als Fehler sichtbar besser als ein
				// stiller Leerlauf.
				return {
					...lauf(),
					status: 'werkzeugKaputt',
					grund:
						'PaddleOCR laeuft in einem eigenen Container und kann keinen Dateipfad des ' +
						'Workers lesen. Den Bildpuffer uebergeben, nicht den Pfad.',
					// Kein Wiederholen: das ist ein Programmierfehler im Aufrufer und
					// waere beim naechsten Versuch derselbe.
					voruebergehend: false
				};
			}

			let antwort: Response;
			try {
				antwort = await doFetch(`${baseUrl}/ocr`, {
					method: 'POST',
					headers: { 'content-type': 'application/octet-stream' },
					body: new Uint8Array(bildPfadOderPuffer),
					signal: AbortSignal.timeout(opts?.timeoutMs ?? PADDLE_ZEITLIMIT_MS)
				});
			} catch (err) {
				// Dienst nicht erreichbar, abgestuerzt, Zeitlimit: das WERKZEUG hat
				// versagt, der Bon ist heil. Dieselbe Trennung wie bei Tesseract —
				// davon haengt ab, ob ein Bon wiederholt oder markiert wird.
				const grund =
					err instanceof Error && err.name === 'TimeoutError'
						? `Zeitlimit nach ${opts?.timeoutMs ?? PADDLE_ZEITLIMIT_MS} ms ueberschritten`
						: `Dienst ${baseUrl} nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`;
				// Nicht erreichbar oder Zeitlimit: der Dienst kann gerade starten (nach
				// einem Host-Neustart rund drei Minuten, bis das Modell geladen und das
				// Probebild gelesen ist) oder neu gestartet werden. Ein spaeterer Versuch
				// hat Aussicht — ohne diese Einstufung wuerden genau die Bons, die in
				// dieses Fenster fallen, dauerhaft als gescheitert markiert.
				return { ...lauf(), status: 'werkzeugKaputt', grund, voruebergehend: true };
			}

			if (!antwort.ok) {
				// Der Rumpf kann den Python-Fehlertext tragen; gekuerzt, damit eine
				// entgleiste Antwort nicht die halbe Fehlerspalte fuellt.
				const rumpf = await antwort.text().catch(() => '');
				return {
					...lauf(),
					status: 'werkzeugKaputt',
					grund: `Dienst antwortete mit HTTP ${antwort.status}: ${rumpf.slice(0, 300)}`,
					// 5xx heisst "der Dienst hat sich verschluckt" (auch 503 beim Start,
					// solange das Probebild noch nicht gelesen ist) — das kann beim
					// naechsten Mal anders sein. 4xx liegt an der Anfrage selbst, und die
					// ist beim naechsten Versuch dieselbe.
					voruebergehend: antwort.status >= 500
				};
			}

			const daten = (await antwort.json()) as DienstAntwort;
			const erkennungen = (daten.erkennungen ?? []).filter((e) => e.text.trim() !== '');
			const fertig = lauf({
				engineVersion: daten.engineVersion,
				// Was der Engine TATSAECHLICH uebergeben wurde, vom Dienst selbst
				// gemeldet — nicht, was hier konfiguriert ist. Damit traegt jede
				// Messung die Bedingung mit, unter der sie entstand (insbesondere die
				// Groessengrenze aus Auflage 2).
				options: { ...daten.options, mitBoxen }
			});

			if (erkennungen.length === 0) return { ...fertig, status: 'nichtsGefunden' };

			const zeilen = erkennungen.map(zeileAus);
			const text = zeilen.map((z) => z.text).join('\n');
			if (!mitBoxen) return { ...fertig, status: 'gelesen', text };
			return {
				...fertig,
				status: 'gelesen',
				text,
				zeilen,
				woerter: zeilen.flatMap((z) => z.woerter ?? [])
			};
		}
	};
}
