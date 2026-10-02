import { KATEGORIEBAUM, SONSTIGES_UNSORTIERT_SLUG } from './baum';
import { stripCodeFence, parseUsage } from '$lib/server/extraction/openai-compat';
import type { TextModellZiel } from '$lib/server/extraction/ocr-text-provider';
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

function summe(a: ExtractionUsage, b: ExtractionUsage): ExtractionUsage {
	if (a === null) return b;
	if (b === null) return a;
	return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

/**
 * Wie ordneMitModell, aber Zeilen ohne gueltigen Vorschlag (uebersprungen oder mit erfundener
 * Kategorie) werden EIN zweites Mal gefragt — nur sie. Gemessen am 27.09.2026: von 13
 * unsortierten Positionen hatte das Modell 10 gar nicht beantwortet. Was es ausdruecklich
 * „sonstiges-unsortiert" nannte, ist eine Antwort und wird nicht nachgefragt. Scheitert schon
 * der erste Aufruf, gibt es keinen zweiten; scheitert der zweite, bleibt die erste Antwort.
 */
export async function ordneMitNachfrage(zeilen: ZuOrdnendeZeile[], deps: ModellDeps): Promise<ModellErgebnis> {
	const erst = await ordneMitModell(zeilen, deps);
	if (erst.fehler !== null) return erst;
	const offen = zeilen.filter((z) => !(z.id in erst.vorschlaege));
	if (offen.length === 0) return erst;
	let zweit: ModellErgebnis;
	try {
		zweit = await ordneMitModell(offen, deps);
	} catch (err) {
		return { ...erst, fehler: `Nachfrage fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
	}
	return {
		vorschlaege: { ...erst.vorschlaege, ...zweit.vorschlaege },
		// Ein erfundener Slug bleibt im Protokoll, solange seine Zeile keinen gueltigen hat.
		verworfen: [
			...erst.verworfen.filter((v) => !(v.itemId in zweit.vorschlaege)),
			...zweit.verworfen.filter((v) => !(v.itemId in erst.vorschlaege))
		],
		fehler: zweit.fehler === null ? null : `Nachfrage: ${zweit.fehler}`,
		usage: summe(erst.usage, zweit.usage)
	};
}

/**
 * Der echte Modellaufruf — an das Modell, das den Bon GERADE GELESEN hat (`ziel`): im Normalfall
 * der MLX-Server auf eigener Hardware, bei einem Ausfall die Cloud-Reserve. Dann geht auch der
 * Kategorie-Text in die Cloud — nur Text, nie das Bild, und nur, wenn eine Reserve eingerichtet
 * ist und gelesen hat (Entwurf 2026-10-01-cloud-reserve; der Bon traegt dann einen Vermerk).
 * Ohne `ziel` gilt die .env wie bisher (EXTRACTION_BASE_URL).
 *
 * Erst beim Aufruf gelesen, nicht beim Import: sonst braeuchte jeder Test, der dieses
 * Modul anfasst, die Umgebungsvariablen.
 */
export function echteModellDeps(
	opts: { ziel?: TextModellZiel | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): ModellDeps {
	const doFetch = opts.fetchImpl ?? opts.ziel?.fetchImpl ?? fetch;
	return {
		async frageModell(inhalt) {
			const baseUrl = opts.ziel?.baseUrl ?? process.env.EXTRACTION_BASE_URL;
			const apiKey = opts.ziel ? opts.ziel.apiKey : process.env.EXTRACTION_API_KEY;
			const model = opts.ziel?.model ?? process.env.EXTRACTION_MODEL;
			// Ein Ziel darf ohne Schluessel sein (MLX ohne Schutz); die .env wie bisher nicht.
			if (!baseUrl || !model || (opts.ziel ? apiKey === undefined : !apiKey)) throw new Error('Modellzugang ist nicht konfiguriert.');

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
				usage?: unknown;
			};
			const text = json.choices?.[0]?.message?.content;
			if (typeof text !== 'string') throw new Error('Modellantwort ohne Inhalt');
			// parseUsage kennt beide Schreibweisen (Abacus: input_tokens, Mac: prompt_tokens) und
			// sagt null statt einer erfundenen 0 — sonst saehe die Reserve kostenlos aus und die
			// Monatsgrenze zaehlte zu wenig.
			return { text, usage: parseUsage(json.usage) };
		}
	};
}
