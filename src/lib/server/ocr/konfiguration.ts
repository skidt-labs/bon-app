import { erzeugeTesseractAnbieter } from './anbieter';
import { erzeugePaddleOcrAnbieter, PADDLE_STANDARD_URL } from './paddle';
import type { OcrAnbieter, OcrEngineName } from './anbieter';
import type { ExecFileImpl } from './lesen';

/** Alle Namen, die der Validator kennt — nicht alle sind schon angeschlossen. */
const BEKANNTE_ENGINES: readonly OcrEngineName[] = ['tesseract', 'paddleocr'];

/**
 * Welche OCR-Engine laufen soll. Standard bleibt Tesseract.
 *
 * Nach demselben Muster wie `zeitlimitAusEnv` in `extraction/index.ts`: NICHT gesetzt
 * ist eine gueltige Aussage und ergibt den Standard — ein GESETZTER, aber unbrauchbarer
 * Wert laesst den Dienst beim Start laut scheitern. Ein stiller Rueckfall waere hier
 * besonders teuer: der Betreiber glaubte, er misst eine andere Engine, und die Zahlen,
 * die er daraufhin vergleicht, waeren beide von derselben.
 *
 * `paddleocr` ist seit Etappe 3 angeschlossen (Dienst `bon-paddleocr`). Bis dahin warf
 * dieser Leser bei diesem Wert ausdruecklich — lieber laut scheitern, als stillschweigend
 * Tesseract zu nehmen und den Betreiber glauben zu lassen, er messe PaddleOCR.
 */
export function ocrEngineAusEnv(wert: string | undefined): OcrEngineName {
	if (wert === undefined || wert.trim() === '') return 'tesseract';
	const name = wert.trim().toLowerCase();

	if (name === 'tesseract') return 'tesseract';
	if (name === 'paddleocr') return 'paddleocr';
	throw new Error(
		`OCR_PROVIDER ist unbrauchbar: ${JSON.stringify(wert)}. ` +
			`Erwartet wird einer von: ${BEKANNTE_ENGINES.join(', ')}.`
	);
}

/**
 * Ob Koordinaten und Confidence eingesammelt werden. Standard aus.
 *
 * Bewusst nur `true`/`false` und sonst ein Fehler: `"1"`, `"yes"`, `"ja"` sehen aus wie
 * ein Ja und waeren bei einer laxen Pruefung ein stilles Nein — also genau die Sorte
 * Einstellung, die jemand vornimmt und die dann nicht wirkt.
 */
export function mitBoxenAusEnv(wert: string | undefined): boolean {
	if (wert === undefined || wert.trim() === '') return false;
	const v = wert.trim().toLowerCase();
	if (v === 'true') return true;
	if (v === 'false') return false;
	throw new Error(
		`OCR_INCLUDE_BOXES ist unbrauchbar: ${JSON.stringify(wert)}. Erwartet wird "true" oder "false".`
	);
}

/**
 * Adresse des PaddleOCR-Dienstes. Nicht gesetzt heisst "der Nachbarcontainer" — das ist
 * der einzige Aufbau, den das Compose dieses Projekts erzeugt.
 *
 * Geprueft wird nur, dass es eine http(s)-Adresse ist — der Anbieter haengt `/ocr` an
 * und ruft `fetch` auf. Keine Erlaubnisliste: der Dienst ist nicht von aussen
 * erreichbar, und eine Adresse, die ins Leere zeigt, meldet sich beim ersten Bon als
 * `werkzeugKaputt` mit genau dieser Adresse im Text.
 *
 * Die Pruefung auf das Schema ist NICHT Formsache: `new URL('bon-paddleocr:8000')`
 * gelingt (Schema `bon-paddleocr:`), und eine vergessene `http://`-Vorsilbe waere damit
 * durchgerutscht und erst beim ersten Bon als kaputter Dienst aufgefallen.
 */
export function paddleUrlAusEnv(wert: string | undefined): string {
	if (wert === undefined || wert.trim() === '') return PADDLE_STANDARD_URL;
	const url = wert.trim();
	let geparst: URL;
	try {
		geparst = new URL(url);
	} catch {
		throw new Error(`OCR_PADDLE_URL ist keine gueltige Adresse: ${JSON.stringify(wert)}.`);
	}
	if (geparst.protocol !== 'http:' && geparst.protocol !== 'https:') {
		throw new Error(
			`OCR_PADDLE_URL muss mit http:// oder https:// beginnen: ${JSON.stringify(wert)}.`
		);
	}
	return url;
}

/**
 * Der Anbieter zur gewaehlten Engine. `deps` gibt es nur, damit Tests denselben
 * Prozessaufruf bzw. dasselbe `fetch` ersetzen koennen wie ueberall sonst in diesem Modul.
 */
export function waehleOcrAnbieter(
	engine: OcrEngineName,
	deps?: { execFileImpl?: ExecFileImpl; paddleUrl?: string; fetchImpl?: typeof fetch }
): OcrAnbieter {
	if (engine === 'tesseract') return erzeugeTesseractAnbieter({ execFileImpl: deps?.execFileImpl });
	if (engine === 'paddleocr') {
		return erzeugePaddleOcrAnbieter({ baseUrl: deps?.paddleUrl, fetchImpl: deps?.fetchImpl });
	}
	// Unerreichbar, solange `ocrEngineAusEnv` der einzige Weg hierher ist — steht hier
	// trotzdem, damit ein kuenftiger Aufrufer, der die Validierung umgeht, nicht
	// stillschweigend eine andere Engine bekommt.
	throw new Error(`Fuer die OCR-Engine ${engine} gibt es noch keinen Anbieter.`);
}

/** Liest alle drei Schalter aus der Umgebung. Wirft, wenn einer unbrauchbar ist. */
export function ocrKonfigurationAusEnv(env: NodeJS.ProcessEnv = process.env): {
	engine: OcrEngineName;
	mitBoxen: boolean;
	paddleUrl: string;
} {
	return {
		engine: ocrEngineAusEnv(env.OCR_PROVIDER),
		mitBoxen: mitBoxenAusEnv(env.OCR_INCLUDE_BOXES),
		paddleUrl: paddleUrlAusEnv(env.OCR_PADDLE_URL)
	};
}
