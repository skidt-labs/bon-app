import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { datenbankUrl } from './url';

const tmp: string[] = [];
afterEach(() => {
	for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

function passwortDatei(inhalt: string): string {
	const d = mkdtempSync(join(tmpdir(), 'pw-'));
	tmp.push(d);
	const f = join(d, 'db-password');
	writeFileSync(f, inhalt);
	return f;
}

describe('datenbankUrl', () => {
	it('setzt das Passwort aus der Datei ein', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('geheim123'));
		expect(datenbankUrl()).toBe('postgres://bon:geheim123@bon-db:5432/bon');
	});

	// Ein Zeilenumbruch am Dateiende ist der Normalfall und darf das Passwort nicht
	// verfaelschen — sonst scheitert die Anmeldung mit einer Meldung, die nach einem
	// falschen Passwort aussieht statt nach einem Leerzeichen zu viel.
	it('schneidet Leerraum am Dateiende ab', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('geheim123\n'));
		expect(datenbankUrl()).toContain('geheim123@');
	});

	// Sonderzeichen muessen prozentkodiert werden, sonst zerfaellt die URL: ein "@" im
	// Passwort beendet fuer den Parser die Zugangsdaten, und der Verbindungsversuch geht
	// an einen Rechner, den es nicht gibt.
	it('kodiert Sonderzeichen im Passwort', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('a/b@c:d'));
		const url = datenbankUrl();
		expect(url).toContain('a%2Fb%40c%3Ad@bon-db');
		// Gegenprobe: die URL bleibt zerlegbar, und das Passwort kommt heil wieder heraus.
		expect(decodeURIComponent(new URL(url).password)).toBe('a/b@c:d');
	});

	/**
	 * Ein direkt gesetztes DATABASE_URL gewinnt. Das ist kein Rueckfall, sondern der
	 * Weg fuer alles, was VON AUSSEN auf die Datenbank geht: drizzle-kit vom Host, die
	 * DB-Waechter hinter RUN_DB_TESTS. Ohne diesen Vorrang muesste jedes dieser
	 * Werkzeuge eine Passwortdatei mitbringen.
	 */
	it('nimmt ein direkt gesetztes DATABASE_URL unveraendert', () => {
		vi.stubEnv('DATABASE_URL', 'postgres://bon:direkt@127.0.0.1:55432/bon');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('ausdatei'));
		expect(datenbankUrl()).toBe('postgres://bon:direkt@127.0.0.1:55432/bon');
	});

	// Fehlt beides, ist das ein Aufbaufehler und kein Grund weiterzulaufen: eine
	// Verbindung ohne Passwort scheitert spaeter mit einer Meldung, die woanders hinzeigt.
	it('sagt deutlich, wenn weder URL noch Vorlage da sind', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', '');
		expect(() => datenbankUrl()).toThrow(/DATABASE_URL/);
	});

	it('sagt deutlich, wenn die Vorlage da ist, die Passwortdatei aber fehlt', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', '/gibt/es/nicht');
		expect(() => datenbankUrl()).toThrow(/Passwortdatei/);
	});

	// Eine Vorlage ohne Platzhalter ist ein Tippfehler, kein gueltiger Sonderfall —
	// sonst verbindet sich die Anwendung klaglos ohne Passwort.
	it('verlangt den Platzhalter in der Vorlage', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('geheim'));
		expect(() => datenbankUrl()).toThrow(/__PW__/);
	});

	it('laesst eine leere Passwortdatei nicht als Passwort durchgehen', () => {
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_URL_TEMPLATE', 'postgres://bon:__PW__@bon-db:5432/bon');
		vi.stubEnv('DB_PASSWORD_FILE', passwortDatei('   \n'));
		expect(() => datenbankUrl()).toThrow(/leer/i);
	});
});
