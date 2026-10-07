import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { datenbankName, dbTestsVerweigert, istTestDatenbank, testBildablage } from './testwaechter';

const TEST = 'postgres://bon:geheim@127.0.0.1:55432/bon_test';
const PROD = 'postgres://bon:geheim@127.0.0.1:55432/bon';

describe('datenbankName', () => {
	it('liest den Namen aus der Adresse, ohne Abfrageteil', () => {
		expect(datenbankName(TEST)).toBe('bon_test');
		expect(datenbankName(`${TEST}?sslmode=disable`)).toBe('bon_test');
		expect(datenbankName('postgresql://bon:a%2Fb@bon-db:5432/bon')).toBe('bon');
	});
	it('liefert null ohne Namen oder ohne postgres-Adresse', () => {
		expect(datenbankName('postgres://bon@127.0.0.1:55432/')).toBeNull();
		expect(datenbankName('postgres://bon@127.0.0.1:55432')).toBeNull();
		expect(datenbankName('mysql://bon@127.0.0.1/bon_test')).toBeNull();
		expect(datenbankName('kein url')).toBeNull();
		expect(datenbankName('')).toBeNull();
	});
});

describe('istTestDatenbank', () => {
	it('nur ein Name, der auf _test endet', () => {
		expect(istTestDatenbank(TEST)).toBe(true);
		expect(istTestDatenbank(PROD)).toBe(false);
		expect(istTestDatenbank('postgres://bon@127.0.0.1:55432/bon_test_alt')).toBe(false);
		expect(istTestDatenbank('postgres://bon@127.0.0.1:55432/bontest')).toBe(false);
		expect(istTestDatenbank(`${PROD}?application_name=x_test`)).toBe(false);
	});
});

describe('dbTestsVerweigert', () => {
	it('laesst ohne RUN_DB_TESTS alles durch — die normale Suite braucht keine Datenbank', () => {
		expect(dbTestsVerweigert({ DATABASE_URL: PROD })).toBeNull();
		expect(dbTestsVerweigert({})).toBeNull();
	});
	it('laesst RUN_DB_TESTS=1 gegen die Test-Datenbank zu', () => {
		expect(dbTestsVerweigert({ RUN_DB_TESTS: '1', DATABASE_URL: TEST })).toBeNull();
	});
	it('verweigert RUN_DB_TESTS=1 gegen die Produktion, ohne das Passwort zu nennen', () => {
		const m = dbTestsVerweigert({ RUN_DB_TESTS: '1', DATABASE_URL: PROD });
		expect(m).toContain('„bon"');
		expect(m).toContain('_test');
		expect(m).not.toContain('geheim');
	});
	it('verweigert RUN_DB_TESTS=1 ohne DATABASE_URL', () => {
		expect(dbTestsVerweigert({ RUN_DB_TESTS: '1' })).toContain('ohne DATABASE_URL');
		expect(dbTestsVerweigert({ RUN_DB_TESTS: '1', DATABASE_URL: '  ' })).toContain('ohne DATABASE_URL');
	});
});

// Abschlusspruefung 0.11.0: der Waechter schuetzte die Datenbank, nicht die Bilder. Ohne
// RECEIPT_DIR loeschte loescheBilder in ./data/receipts — im Arbeitsverzeichnis die Ablage der
// Produktion. Ein Rollback holt keine Datei zurueck.
describe('testBildablage', () => {
	const neu = () => '/tmp/bon-tests/bilder-1';
	it('nimmt ohne RECEIPT_DIR ein eigenes Verzeichnis', () => {
		expect(testBildablage({}, '/srv/bon', neu)).toBe('/tmp/bon-tests/bilder-1');
	});
	it('ersetzt die Bildablage der Produktion, auch relativ oder mit Schraegstrich', () => {
		expect(testBildablage({ RECEIPT_DIR: './data/receipts' }, '/srv/bon', neu)).toBe('/tmp/bon-tests/bilder-1');
		expect(testBildablage({ RECEIPT_DIR: '/srv/bon/data/receipts/' }, '/srv/bon', neu)).toBe('/tmp/bon-tests/bilder-1');
		expect(testBildablage({ RECEIPT_DIR: '/srv/bon/data/receipts/2026' }, '/srv/bon', neu)).toBe('/tmp/bon-tests/bilder-1');
	});
	it('laesst ein eigenes Testverzeichnis stehen', () => {
		expect(testBildablage({ RECEIPT_DIR: '/tmp/eigen' }, '/srv/bon', neu)).toBe('/tmp/eigen');
	});
	it('gilt in dieser Suite: keine Testdatei sieht die Ablage der Produktion', () => {
		const dir = process.env.RECEIPT_DIR;
		expect(dir).toBeDefined();
		expect(resolve(dir!).startsWith(resolve('data/receipts'))).toBe(false);
	});
});
