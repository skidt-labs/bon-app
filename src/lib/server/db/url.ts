import { readFileSync } from 'node:fs';

/**
 * Die Verbindungszeichenfolge zur Datenbank — mit dem Passwort aus einer DATEI statt
 * aus der Umgebung.
 *
 * Der Befund dahinter (Abschlusspruefung Phase 1): `bon-db` liest sein Passwort
 * ordentlich aus `secrets/db-password`, `bon-web` und `bon-worker` bekamen es dagegen
 * als Klartext in `DATABASE_URL` mitgegeben — `docker inspect bon-web` zeigte es jedem,
 * der an den Docker-Socket kommt. Dieselbe Inkonsistenz wie beim LLM-Schluessel, nur
 * unbemerkt geblieben.
 *
 * Ein direkt gesetztes `DATABASE_URL` hat weiter Vorrang. Das ist kein Rueckfall,
 * sondern der Weg fuer alles, was von aussen kommt: drizzle-kit vom Host und die
 * DB-Waechter hinter RUN_DB_TESTS. Ohne diesen Vorrang muesste jedes dieser Werkzeuge
 * eine Passwortdatei mitbringen.
 */
const PLATZHALTER = '__PW__';

export function datenbankUrl(): string {
	const direkt = process.env.DATABASE_URL?.trim();
	if (direkt) return direkt;

	const vorlage = process.env.DATABASE_URL_TEMPLATE?.trim();
	if (!vorlage) {
		throw new Error(
			'Weder DATABASE_URL noch DATABASE_URL_TEMPLATE gesetzt — ohne beides gibt es keine Datenbankverbindung.'
		);
	}
	// Eine Vorlage ohne Platzhalter ist ein Tippfehler, kein gueltiger Sonderfall: sonst
	// verbindet sich die Anwendung klaglos ohne Passwort, und der Fehler faellt erst
	// irgendwo anders auf.
	if (!vorlage.includes(PLATZHALTER)) {
		throw new Error(`DATABASE_URL_TEMPLATE enthält keinen Platzhalter ${PLATZHALTER}.`);
	}

	const datei = process.env.DB_PASSWORD_FILE?.trim();
	if (!datei) throw new Error('DB_PASSWORD_FILE ist nicht gesetzt.');

	let roh: string;
	try {
		roh = readFileSync(datei, 'utf-8');
	} catch {
		// Absichtlich ohne den Systemfehler: der traegt den Pfad und manchmal mehr, und
		// diese Meldung kann in einem Log landen.
		throw new Error(`Passwortdatei nicht lesbar: ${datei}`);
	}

	const passwort = roh.trim();
	if (passwort === '') throw new Error(`Passwortdatei ist leer: ${datei}`);

	// Prozentkodiert: ein "@" oder "/" im Passwort beendet fuer den URL-Parser sonst die
	// Zugangsdaten, und der Verbindungsversuch geht an einen Rechner, den es nicht gibt.
	return vorlage.replace(PLATZHALTER, encodeURIComponent(passwort));
}
