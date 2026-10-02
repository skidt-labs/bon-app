/**
 * „Mac, sonst Reserve" (Entwurf docs/superpowers/specs/2026-10-01-cloud-reserve-design.md).
 *
 * Umgeschaltet wird beim MODELLAUFRUF, nicht davor: die OCR ist dann schon gelaufen, und
 * derselbe Text geht an die Reserve. Umgeschaltet wird NUR, wenn der Mac nicht erreichbar ist —
 * ein schlechter Bon, eine kaputte Einstellung oder ein Abbruch von aussen sind kein Grund, Text
 * in die Cloud zu schicken. Alles mit Seiteneffekt (Zustand, Matrix, Protokoll) steckt in
 * `UmschaltDeps`; diese Datei entscheidet nur.
 */
import { ExtractionHttpError, ExtractionSchemaError, ExtractionTruncatedError } from '$lib/server/extraction/types';
import { KiKonfigurationFehler } from './fehler';
import {
	frageTextModell,
	type TextModellAufruf,
	type TextModellZiel
} from '$lib/server/extraction/ocr-text-provider';
import type { Preise } from './preise';

/**
 * HTTP-Codes, die „der Mac ist gerade nicht da" heissen: beschaeftigt (503, 429) — und die
 * Gateway-Fehler des HTTPS-Vorbaus, wenn der MLX-Prozess dahinter tot ist oder haengt (502, 504;
 * Abschlusspruefung 02.10.2026). Dieselbe Liste gilt fuer „voruebergehend" im Worker.
 */
export const NICHT_ERREICHBAR_HTTP = new Set([429, 502, 503, 504]);

/** Keine Verbindung, Zeitueberschreitung, NICHT_ERREICHBAR_HTTP — „der Mac ist weg", sonst nichts. */
export function istNichtErreichbar(err: unknown): boolean {
	if (err instanceof TypeError && err.message === 'fetch failed') return true;
	if (err instanceof DOMException) return err.name === 'TimeoutError';
	if (err instanceof ExtractionHttpError) return NICHT_ERREICHBAR_HTTP.has(err.status);
	return false;
}

/**
 * Die Reserve ist gestoert (Schluessel widerrufen, Guthaben leer, Modell umbenannt, Abacus weg).
 * Ein KONFIGURATIONSfehler, kein Fehler des Bons: der Worker haelt ihn fuer voruebergehend, und
 * der Bon wartet wie ohne Reserve auf den Mac (Abschlusspruefung 02.10.2026). Die Ursache haengt
 * als `cause` daran.
 */
export class ReserveGestoert extends KiKonfigurationFehler {}

/** Der Grund fuer die Matrix-Meldung und das Protokoll. */
export function grundText(err: unknown): string {
	if (err instanceof DOMException && err.name === 'TimeoutError') return 'Zeitüberschreitung';
	if (err instanceof ExtractionHttpError) return `HTTP ${err.status}`;
	if (err instanceof TypeError) return 'keine Verbindung';
	return err instanceof Error ? err.message : String(err);
}

/**
 * Wer liest. `ziel` ist FAUL: bei der Reserve entschluesselt es den Schluessel erst beim Aufruf
 * und wirft dann `KiSchluesselUnlesbar` — eine kaputte Reserve haelt den Mac nicht auf.
 */
export type Leser = {
	rolle: 'haupt' | 'reserve';
	name: string;
	modell: string;
	kiAnbieterId: string | null;
	preise: Preise;
	ziel: () => TextModellZiel;
};

export type UmschaltDeps = {
	reserveAktivSeit(): Promise<Date | null>;
	grenzeErreicht(): Promise<boolean>;
	/**
	 * Bedingt umschalten; nur wer wirklich umgeschaltet hat, meldet. true = die Reserve darf jetzt
	 * lesen (umgeschaltet, oder schon aktiv mit DIESER Karte). false = sie ist inzwischen entfernt
	 * oder eine andere — dann geht kein Text an sie.
	 */
	umschalten(grund: string): Promise<boolean>;
	/** Bedingt zurueckschalten; nur wer wirklich zurueckgeschaltet hat, meldet. */
	zurueckschalten(anlass: string): Promise<void>;
	/** Hoechstens einmal je Monat. */
	grenzeMelden(): Promise<void>;
	frage?: typeof frageTextModell;
};

export function modellAufrufMitReserve(
	haupt: Leser,
	reserve: Leser,
	deps: UmschaltDeps,
	merke: (l: Leser) => void
): TextModellAufruf {
	const frage = deps.frage ?? frageTextModell;
	return async (text, qualitaet, signal) => {
		// Vor dem Aufruf merken: scheitert er, traegt auch der Fehlschlag-Lauf die richtige Rolle.
		const lies = (l: Leser) => {
			merke(l);
			return frage(l.ziel(), text, qualitaet, signal);
		};
		// Was die Reserve nicht ueber die ANTWORT sagt (Netz, Zeit, HTTP), ist ihre Stoerung, nicht
		// die des Bons. Eine Antwort, die nicht passt, und ein Abbruch von aussen bleiben, was sie sind.
		const liesReserve = async () => {
			try {
				return await lies(reserve);
			} catch (err) {
				const zurAntwort = err instanceof ExtractionSchemaError || err instanceof ExtractionTruncatedError;
				const vonAussen = err instanceof DOMException && err.name === 'AbortError';
				if (zurAntwort || vonAussen || err instanceof KiKonfigurationFehler) throw err;
				if (istNichtErreichbar(err) || err instanceof ExtractionHttpError) {
					throw new ReserveGestoert(`Reserve „${reserve.name}" nicht nutzbar (${grundText(err)}) — der Bon wartet auf den Mac.`, { cause: err });
				}
				throw err;
			}
		};
		const aktivSeit = await deps.reserveAktivSeit();
		if (aktivSeit) {
			if (!(await deps.grenzeErreicht())) return liesReserve();
			await deps.grenzeMelden();
		}
		try {
			const antwort = await lies(haupt);
			if (aktivSeit) await deps.zurueckschalten('Mac antwortete im Auftrag');
			return antwort;
		} catch (err) {
			if (!istNichtErreichbar(err)) throw err;
			if (await deps.grenzeErreicht()) {
				await deps.grenzeMelden();
				throw err;
			}
			if (!(await deps.umschalten(grundText(err)))) throw err;
			return liesReserve();
		}
	};
}

/** Antwortet der Hauptanbieter? `GET /models`, 10 s — fuer den Zeitplan-Auftrag. */
export async function hauptErreichbar(ziel: TextModellZiel, fetchImpl: typeof fetch = fetch): Promise<boolean> {
	try {
		const antwort = await fetchImpl(`${ziel.baseUrl}/models`, {
			headers: { authorization: `Bearer ${ziel.apiKey}`, 'user-agent': 'bon-app/1.0' },
			signal: AbortSignal.timeout(10_000)
		});
		return antwort.ok;
	} catch {
		return false;
	}
}

/** Der Zeitplan-Auftrag: nur solange die Reserve liest, den Mac anfragen und ggf. zurueck. */
export async function hauptPruefen(deps: {
	reserveAktivSeit(): Promise<Date | null>;
	probe(): Promise<boolean>;
	zurueckschalten(anlass: string): Promise<void>;
}): Promise<'nichts' | 'zurueck' | 'weiter'> {
	if (!(await deps.reserveAktivSeit())) return 'nichts';
	if (!(await deps.probe())) return 'weiter';
	await deps.zurueckschalten('Zeitplan');
	return 'zurueck';
}
