import { KATEGORIEBAUM, SONSTIGES_UNSORTIERT_SLUG } from './baum';
import { stripCodeFence } from '$lib/server/extraction/openai-compat';
import type { ExtractionUsage } from '$lib/server/extraction/types';
import type { ZuOrdnendeZeile } from './kaskade';

/**
 * Die Modellstufe der Kategorie-Kaskade: was das Gedaechtnis nicht kennt, wird EINMAL
 * fuer den ganzen Bon gefragt.
 *
 * Zwei Regeln bestimmen alles hier:
 *
 * 1. **Ein Aufruf fuer alle offenen Zeilen.** Bei vierzehn Positionen waere ein Aufruf
 *    je Zeile der Unterschied zwischen 0,6 und 8 Cent — und vierzehnmal die Wartezeit.
 * 2. **Das Modell darf keine Kategorien erfinden.** Der Baum geht als feste
 *    Auswahlliste mit, und jeder Slug der Antwort wird gegen ihn geprueft. Ein
 *    unbekannter Slug wird verworfen; die Zeile bleibt offen und faellt auf Unsortiert,
 *    statt eine erfundene Kategorie in die Auswertung zu tragen.
 *
 * Verworfenes und unlesbare Antworten verschwinden NICHT still, sondern stehen im
 * Ergebnis — ein Rueckfall, den niemand bemerken kann, ist selbst ein Defekt.
 */

export type ModellDeps = {
	frageModell: (prompt: string) => Promise<{ text: string; usage: ExtractionUsage }>;
};

export type ModellErgebnis = {
	/** Zeilen-Id → Kategorie-Slug, nur geprüfte Slugs. */
	vorschlaege: Record<string, string>;
	/** Was das Modell vorschlug, das es nicht gibt. */
	verworfen: { itemId: string; slug: string }[];
	/** Warum gar nichts herauskam, wenn gefragt wurde. null = alles in Ordnung. */
	fehler: string | null;
	usage: ExtractionUsage;
};

/** Alle gueltigen Slugs — Ober- UND Unterkategorien, beide sind waehlbar. */
function gueltigeSlugs(): Set<string> {
	const s = new Set<string>();
	for (const ober of KATEGORIEBAUM) {
		s.add(ober.slug);
		for (const kind of ober.kinder) s.add(kind.slug);
	}
	return s;
}

/**
 * Die Auswahlliste fuer den Prompt, aus dem Baum erzeugt — nicht daneben gepflegt.
 * Zwei Listen wuerden auseinanderlaufen, und das Modell duerfte dann Kategorien
 * vorschlagen, die es in der Datenbank nicht gibt (siehe baum.ts).
 */
export function auswahlliste(): string {
	const zeilen: string[] = [];
	for (const ober of KATEGORIEBAUM) {
		zeilen.push(`${ober.slug} — ${ober.name}`);
		for (const kind of ober.kinder) zeilen.push(`${kind.slug} — ${ober.name} › ${kind.name}`);
	}
	return zeilen.join('\n');
}

function prompt(zeilen: ZuOrdnendeZeile[]): string {
	// Kurze Nummern als Schluessel, NICHT die Positions-Ids.
	//
	// Gemessen am 17.09.2026: mit den echten 36-stelligen UUIDs als Schluessel antwortete
	// Qwen3.5-9B auf einen Bon mit 20 offenen Zeilen mit einem leeren Objekt — drei
	// Ausgabe-Token, kein Fehler, kein Vorschlag. Mit „i1", „i2" in derselben Lage
	// ordnete dasselbe Modell sauber zu. Zwanzig UUIDs fehlerfrei abzuschreiben ist fuer
	// ein 9B-Modell eine eigene, schwere Aufgabe neben der eigentlichen — und sie kostet
	// obendrein mehr Token als die Antwort selbst.
	const posten = zeilen.map((z, i) => `${i + 1}: ${z.rawText}`).join('\n');
	return [
		'Ordne JEDEN Posten eines deutschen Kassenbons genau einer Kategorie zu.',
		'',
		'Erlaubte Kategorien (nur diese Kennungen sind gültig):',
		auswahlliste(),
		'',
		'Posten:',
		posten,
		'',
		'Antworte ausschließlich mit einem JSON-Objekt: die Nummer des Postens als',
		`Schlüssel (als Text), die Kategorie-Kennung als Wert — für alle ${zeilen.length} Posten.`,
		// Der Unsicherheit einen NAMEN geben, statt sie zum Weglassen einzuladen: die
		// erste Fassung schrieb „lass ihn weg", und das Modell liess alle zwanzig weg.
		// So ist „weiss ich nicht" eine Antwort, die man sehen und nachzaehlen kann.
		`Bist du dir bei einem Posten nicht sicher, nimm "${SONSTIGES_UNSORTIERT_SLUG}" —`,
		'aber lass keinen Posten aus.',
		'',
		'Beispiel: {"1": "lebensmittel-obst-gemuese", "2": "haushalt-reinigung"}'
	].join('\n');
}

export async function ordneMitModell(
	zeilen: ZuOrdnendeZeile[],
	deps: ModellDeps
): Promise<ModellErgebnis> {
	// Nichts offen: gar nicht erst fragen. Ein Aufruf, der nichts zu fragen hat, kostet
	// Zeit und Geld fuer eine leere Antwort.
	if (zeilen.length === 0) {
		return { vorschlaege: {}, verworfen: [], fehler: null, usage: null };
	}

	const { text, usage } = await deps.frageModell(prompt(zeilen));

	let roh: unknown;
	try {
		roh = JSON.parse(stripCodeFence(text));
	} catch {
		return {
			vorschlaege: {},
			verworfen: [],
			fehler: 'Die Antwort des Modells war kein lesbares JSON.',
			usage
		};
	}
	if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) {
		return {
			vorschlaege: {},
			verworfen: [],
			fehler: 'Die Antwort des Modells war kein Objekt.',
			usage
		};
	}

	const erlaubt = gueltigeSlugs();
	const vorschlaege: Record<string, string> = {};
	const verworfen: { itemId: string; slug: string }[] = [];

	for (const [schluessel, wert] of Object.entries(roh as Record<string, unknown>)) {
		// Die Nummer zurueck auf die Position. Was sich nicht auf eine gefragte Zeile
		// abbilden laesst, ist kein Vorschlag, sondern ein Missverstaendnis — es darf
		// keiner fremden Position eine Kategorie geben. (Qwen schickt gelegentlich einen
		// Schluessel "." mit.)
		const nr = Number(schluessel);
		if (!Number.isInteger(nr) || nr < 1 || nr > zeilen.length) continue;
		const itemId = zeilen[nr - 1].id;
		if (typeof wert !== 'string') continue;
		if (erlaubt.has(wert)) vorschlaege[itemId] = wert;
		else verworfen.push({ itemId, slug: wert });
	}

	return { vorschlaege, verworfen, fehler: null, usage };
}

/**
 * Der echte Modellaufruf — an DIESELBE Adresse, an die schon die Auslesung geht
 * (EXTRACTION_BASE_URL). Das ist der MLX-Server auf eigener Hardware; Bontext verlaesst
 * den eigenen Bereich nicht, und es gibt hier bewusst keinen zweiten, getrennt
 * konfigurierbaren Weg, ueber den er es doch koennte.
 *
 * Erst beim Aufruf gelesen, nicht beim Import: sonst braeuchte jeder Test, der dieses
 * Modul anfasst, die Umgebungsvariablen.
 */
export function echteModellDeps(opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): ModellDeps {
	const doFetch = opts.fetchImpl ?? fetch;
	return {
		async frageModell(inhalt) {
			const baseUrl = process.env.EXTRACTION_BASE_URL;
			const apiKey = process.env.EXTRACTION_API_KEY;
			const model = process.env.EXTRACTION_MODEL;
			if (!baseUrl || !apiKey || !model) throw new Error('Modellzugang ist nicht konfiguriert.');

			const antwort = await doFetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${apiKey}`,
					'user-agent': 'bon-app/1.0'
				},
				body: JSON.stringify({
					model,
					temperature: 0,
					response_format: { type: 'json_object' },
					messages: [{ role: 'user', content: inhalt }]
				})
			});
			if (!antwort.ok) {
				// Der rohe Rumpf geht NIE in die Meldung: manche Fehlerantworten echoen
				// Teile der Anfrage zurueck, samt Authorization-Kopfzeile. Dieselbe Regel
				// wie in extraction/openai-compat.ts.
				throw new Error(`Modell antwortete mit HTTP ${antwort.status}`);
			}
			const json = (await antwort.json()) as {
				choices?: { message?: { content?: unknown } }[];
				usage?: { prompt_tokens?: number; completion_tokens?: number };
			};
			const text = json.choices?.[0]?.message?.content;
			if (typeof text !== 'string') throw new Error('Modellantwort ohne Inhalt');
			return {
				text,
				usage: json.usage
					? {
							inputTokens: json.usage.prompt_tokens ?? 0,
							outputTokens: json.usage.completion_tokens ?? 0
						}
					: null
			};
		}
	};
}
