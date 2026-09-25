import { ocrLesen, OCR_ZEITLIMIT_MS } from './lesen';
import type { ExecFileImpl } from './lesen';

/**
 * Die gemeinsame Schnittstelle, hinter der eine OCR-Engine steckt.
 *
 * Warum es sie gibt: Bis zum 2026-09-15 rief der Worker Tesseract direkt auf — es gab
 * keinen Schalter, weil es nur eine Engine gab. Eine Machbarkeitsprobe (Etappe 0 des
 * PaddleOCR-Plans) hat gemessen, dass PaddleOCR auf Bons, bei denen Artikelname und
 * Preis in getrennten Zeilen stehen, deutlich besser liest und zusaetzlich Koordinaten
 * liefert. Diese Schnittstelle ist die Steckdose dafuer; PaddleOCR wird in Etappe 3
 * angeschlossen.
 *
 * WICHTIG fuer jede kuenftige Engine: Der Dreizustand bleibt. Er trennt
 *   - `werkzeugKaputt` (die Engine selbst versagt — VORUEBERGEHEND, der Bon ist heil)
 *   - `nichtsGefunden` (die Engine lief sauber, das Bild gab nichts her)
 *   - `gelesen`        (Text da; ob er als Bon taugt, entscheidet `pruefeOcrQualitaet`)
 * Der Worker haengt an dieser Trennung: sie entscheidet, ob ein Bon wiederholt oder
 * markiert wird. Eine Engine, die alles in einen Fehlertopf wirft, kostet Bons.
 */
export type OcrEngineName = 'tesseract' | 'paddleocr';

/** Rechteck in Bildkoordinaten: x, y der linken oberen Ecke, dann Breite und Hoehe. */
export type OcrBox = [x: number, y: number, breite: number, hoehe: number];

export type OcrWort = {
	text: string;
	/** `null` heisst „die Engine meldet keine Confidence" — nicht „unsicher". */
	confidence: number | null;
	box: OcrBox;
};

export type OcrZeile = {
	text: string;
	confidence: number | null;
	box: OcrBox;
	woerter?: OcrWort[];
};

/**
 * Die gespeicherte Form einer Zeile: ohne die Woerter. `extraction_runs.ocr_zeilen`
 * soll die Zeilen tragen, die ein Mensch im Bild sucht — die Wortrahmen von Tesseract
 * wuerden das JSON verdreifachen, und niemand liest sie.
 */
export type OcrZeileKurz = { text: string; box: OcrBox; confidence: number | null };

export function kurz(zeilen: OcrZeile[]): OcrZeileKurz[] {
	return zeilen.map(({ text, box, confidence }) => ({ text, box, confidence }));
}

/**
 * Was jede Engine ueber ihren eigenen Lauf mitliefert. Steht auf ALLEN drei Zustaenden,
 * auch auf den Fehlerfaellen: „wie lange lief es, bevor es schieflief" ist genau die
 * Frage, die man spaeter stellt, und sie laesst sich nicht nachtraeglich beantworten.
 */
export type OcrLaufDaten = {
	engine: OcrEngineName;
	engineVersion?: string;
	durationMs: number;
	/** Was der Engine tatsaechlich uebergeben wurde — nicht, was konfiguriert ist. */
	options: Record<string, unknown>;
};

export type OcrAnbieterErgebnis =
	| (OcrLaufDaten & {
			status: 'gelesen';
			text: string;
			/** Nur gefuellt, wenn mit `mitBoxen` angefordert UND von der Engine geliefert. */
			zeilen?: OcrZeile[];
			woerter?: OcrWort[];
	  })
	| (OcrLaufDaten & { status: 'nichtsGefunden' })
	| (OcrLaufDaten & {
			status: 'werkzeugKaputt';
			grund: string;
			/**
			 * Ob ein spaeterer Versuch Aussicht auf Erfolg hat. Seit Etappe 3 noetig,
			 * und zwar aus einem konkreten Anlass: ein fehlendes Tesseract-Programm
			 * repariert sich nicht von selbst, ein noch startender PaddleOCR-Container
			 * schon — nach dem Neustart des Hosts braucht er rund drei Minuten. Ohne
			 * diese Unterscheidung wuerden genau die Bons, die in dieses Fenster
			 * fallen, dauerhaft als gescheitert markiert. „Ein Bon ueberlebt und wird
			 * markiert" gilt auch fuer den Fall, in dem gar nicht der Bon das Problem
			 * ist. Fehlt die Angabe, bleibt es beim bisherigen Verhalten (dauerhaft).
			 */
			voruebergehend?: boolean;
	  });

/**
 * Zieht aus einem Ergebnis nur heraus, WOMIT gelesen wurde — ohne Text, ohne Rahmen.
 *
 * Absichtlich ohne `status`: was mit dem Bon passiert ist, steht schon woanders
 * (`extraction_runs.error`, `receipts.status`). Hier steht nur die Herkunft der
 * Zeichen, und die gilt fuer alle drei Zustaende gleichermassen — auch fuer einen
 * Lauf, der schieflief.
 */
export function laufDatenAus(ergebnis: OcrAnbieterErgebnis): OcrLaufDaten {
	return {
		engine: ergebnis.engine,
		// Nur setzen, wenn die Engine eine Version meldet: ein `engineVersion: undefined`
		// im Objekt sieht in einem `toEqual` wie ein vorhandenes Feld aus und wuerde beim
		// Weg in die Datenbank still zu etwas anderem als "nicht gemeldet".
		...(ergebnis.engineVersion === undefined ? {} : { engineVersion: ergebnis.engineVersion }),
		durationMs: ergebnis.durationMs,
		options: ergebnis.options
	};
}

export type OcrLeseOptionen = {
	timeoutMs?: number;
	/**
	 * Koordinaten und Confidence einsammeln. Standard aus: sie kosten bei Tesseract
	 * einen zweiten Prozesslauf und werden heute von niemandem gelesen. Ob sie je an
	 * das Modell gehen, ist eine eigene Entscheidung — Prefill kostet Zeit (gemessen
	 * ~181 Token/s), und ein Bon mit 89 Zeilen brächte sehr viele Zusatz-Tokens mit.
	 */
	mitBoxen?: boolean;
};

export interface OcrAnbieter {
	readonly name: OcrEngineName;
	lies(bildPfadOderPuffer: string | Buffer, opts?: OcrLeseOptionen): Promise<OcrAnbieterErgebnis>;
}

/**
 * Spaltenlage der Tesseract-TSV. `level` 5 kennzeichnet eine Wortzeile; alles darueber
 * (Seite, Block, Absatz, Zeile) sind Rahmen ohne eigenen Text.
 */
const TSV = {
	level: 0,
	block: 2,
	absatz: 3,
	zeile: 4,
	links: 6,
	oben: 7,
	breite: 8,
	hoehe: 9,
	confidence: 10,
	text: 11
} as const;

/**
 * Baut aus der TSV Text, Zeilen und Woerter.
 *
 * Die Zusammenbau-Regel ist NICHT geraten: Woerter innerhalb einer (Block, Absatz,
 * Zeile)-Gruppe werden mit EINEM Leerzeichen verbunden, Gruppen mit einem Zeilenumbruch,
 * und eine Gruppe ohne ein einziges nichtleeres Wort erzeugt gar keine Zeile. Am
 * 2026-09-16 an sechs echten Bons gegen die `stdout`-Ausgabe desselben Aufrufs
 * geprueft — 1251, 1467, 2032, 1942, 1703 und 187 Zeichen, jeweils zeichengenau gleich.
 * Das ist die Bedingung, unter der diese Abstraktion ueberhaupt zulaessig ist: der
 * Text, den das Modell zu sehen bekommt, darf sich nicht veraendern.
 */
function ausTsv(roh: string): { text: string; zeilen: OcrZeile[]; woerter: OcrWort[] } {
	const zeilen: OcrZeile[] = [];
	const alleWoerter: OcrWort[] = [];
	let schluessel: string | null = null;
	let offen: OcrWort[] = [];

	const abschliessen = () => {
		const gefuellt = offen.filter((w) => w.text !== '');
		if (gefuellt.length > 0) zeilen.push(zeileAus(gefuellt));
		offen = [];
	};

	for (const [i, z] of roh.split('\n').entries()) {
		if (i === 0) continue; // Kopfzeile
		const f = z.split('\t');
		if (f.length <= TSV.text || f[TSV.level] !== '5') continue;

		const k = `${f[TSV.block]}/${f[TSV.absatz]}/${f[TSV.zeile]}`;
		if (k !== schluessel) {
			abschliessen();
			schluessel = k;
		}
		// Tesseract schreibt -1, wo es keine Confidence hat. -1 durchzureichen hiesse
		// "sehr unsicher" zu behaupten, wo gar keine Angabe vorliegt — null ist die
		// Leerstelle. Dieselbe Regel wie ueberall sonst in diesem Projekt.
		const roheConfidence = Number(f[TSV.confidence]);
		const wort: OcrWort = {
			text: f[TSV.text],
			confidence: Number.isFinite(roheConfidence) && roheConfidence >= 0 ? roheConfidence : null,
			box: [
				Number(f[TSV.links]),
				Number(f[TSV.oben]),
				Number(f[TSV.breite]),
				Number(f[TSV.hoehe])
			]
		};
		offen.push(wort);
		if (wort.text !== '') alleWoerter.push(wort);
	}
	abschliessen();

	return { text: zeilen.map((z) => z.text).join('\n'), zeilen, woerter: alleWoerter };
}

/** Rahmen einer Zeile ist der umschliessende Rahmen ihrer Woerter. */
function zeileAus(woerter: OcrWort[]): OcrZeile {
	const x = Math.min(...woerter.map((w) => w.box[0]));
	const y = Math.min(...woerter.map((w) => w.box[1]));
	const rechts = Math.max(...woerter.map((w) => w.box[0] + w.box[2]));
	const unten = Math.max(...woerter.map((w) => w.box[1] + w.box[3]));
	const bekannte = woerter.map((w) => w.confidence).filter((c): c is number => c !== null);
	return {
		text: woerter.map((w) => w.text).join(' '),
		// Mittelwert der Woerter, die ueberhaupt eine Angabe haben; keine Angabe -> null.
		confidence: bekannte.length ? bekannte.reduce((a, b) => a + b, 0) / bekannte.length : null,
		box: [x, y, rechts - x, unten - y],
		woerter
	};
}

/**
 * Tesseract hinter der Schnittstelle. Absichtlich eine duenne Huelle um `ocrLesen`:
 * der Aufruf selbst (`tesseract - stdout -l deu --psm 6`, Puffer ueber stdin, das
 * 20-Sekunden-Limit, die Fehlerzuordnung) bleibt Zeile fuer Zeile dort, wo er steht
 * und getestet ist. Die Huelle legt nur die Laufdaten dazu.
 *
 * Genau deshalb liegt sie hier und nicht in `lesen.ts`: `ocrLesen` gibt weiterhin
 * exakt `{status, text}` zurueck, und seine Tests pruefen das mit `toEqual` auf das
 * ganze Objekt. Metadaten dort einzubauen haette jeden dieser Tests gebrochen — fuer
 * nichts, denn der Kern soll sich ja gerade nicht aendern.
 */
export function erzeugeTesseractAnbieter(deps?: { execFileImpl?: ExecFileImpl }): OcrAnbieter {
	return {
		name: 'tesseract',
		async lies(bildPfadOderPuffer, opts) {
			const mitBoxen = opts?.mitBoxen ?? false;
			const options = { sprache: 'deu', psm: 6, mitBoxen };
			const begonnen = Date.now();

			const roh = await ocrLesen(bildPfadOderPuffer, {
				timeoutMs: opts?.timeoutMs ?? OCR_ZEITLIMIT_MS,
				execFileImpl: deps?.execFileImpl,
				format: mitBoxen ? 'tsv' : 'text'
			});
			const lauf: OcrLaufDaten = {
				engine: 'tesseract',
				durationMs: Date.now() - begonnen,
				options
			};

			if (roh.status === 'gelesen') {
				if (!mitBoxen) return { ...lauf, status: 'gelesen', text: roh.text };
				const { text, zeilen, woerter } = ausTsv(roh.text);
				// Eine TSV kann Rahmenzeilen enthalten und trotzdem kein einziges Wort —
				// `ocrLesen` sieht dann eine nichtleere Ausgabe und meldet "gelesen". Das
				// ist aus seiner Sicht richtig (der Lauf war sauber), aus unserer nicht:
				// ohne Wort gibt es nichts zu lesen.
				if (woerter.length === 0) return { ...lauf, status: 'nichtsGefunden' };
				return { ...lauf, status: 'gelesen', text, zeilen, woerter };
			}
			if (roh.status === 'nichtsGefunden') return { ...lauf, status: 'nichtsGefunden' };
			return { ...lauf, status: 'werkzeugKaputt', grund: roh.grund };
		}
	};
}
