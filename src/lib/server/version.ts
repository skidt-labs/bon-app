import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Version des Programms — mit package.json als EINZIGER Quelle.
 *
 * Kein Build-Argument, keine erzeugte Datei, kein ENV im Abbild. Das Laufzeit-Abbild
 * kopiert package.json ohnehin mit (siehe Dockerfile), also kann das Programm seine
 * eigene Version zur Laufzeit aus der eigenen Datei lesen. Jede zweite Stelle waere
 * eine Stelle, die auseinanderlaufen kann — und eine Versionsnummer, die luegt, ist
 * schlimmer als gar keine: sie schickt jede Fehlersuche in die falsche Richtung.
 */
export function versionAusPaket(inhalt: string): string {
	const roh: unknown = JSON.parse(inhalt)?.version;
	// "latest" oder "" waeren gueltiges JSON und trotzdem nutzlos. Lieber werfen,
	// als in der Oberflaeche etwas anzuzeigen, worauf sich niemand berufen kann.
	if (typeof roh !== 'string' || !/^\d+\.\d+\.\d+/.test(roh)) {
		throw new Error(`package.json enthaelt keine brauchbare version: ${JSON.stringify(roh)}`);
	}
	return roh;
}

/**
 * Gelesen wird relativ zum Arbeitsverzeichnis: im Container /app, in der Entwicklung
 * die Projektwurzel — in beiden Faellen liegt package.json genau dort.
 *
 * Scheitert das Lesen, steht "unbekannt" in der Oberflaeche. Das ist bewusst KEIN
 * stiller Rueckfall: der Wert ist sichtbar falsch und niemand haelt ihn fuer eine
 * echte Nummer. Ein abstuerzendes Programm waere die schlechtere Antwort — an einer
 * fehlenden Versionsanzeige ist noch nie ein Bon verloren gegangen.
 */
function lies(): string {
	try {
		return versionAusPaket(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
	} catch {
		return 'unbekannt';
	}
}

export const VERSION = lies();
