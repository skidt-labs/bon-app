import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dbTestsVerweigert, testBildablage } from './src/lib/server/db/testwaechter';

/**
 * DB-Tests nur gegen eine Test-Datenbank (Sammelfassung 0.11.0, Bereich 0): mit RUN_DB_TESTS=1
 * muss DATABASE_URL auf eine Datenbank zeigen, deren Name auf _test endet (bon_test). Sonst
 * wirft diese Datei — vitest bricht jede Testdatei ab, bevor sie geladen ist, also bevor
 * irgendein Test etwas schreibt. Steht VOR der Attrappe unten: ein fehlendes DATABASE_URL soll
 * als fehlend gemeldet werden.
 */
const verweigert = dbTestsVerweigert(process.env);
if (verweigert) throw new Error(verweigert);

/**
 * Und nie die Bilder der Produktion (Abschlusspruefung 0.11.0): ohne RECEIPT_DIR waere die
 * Ablage ./data/receipts — im Arbeitsverzeichnis die echte. Ein Verzeichnis je Arbeitsprozess;
 * angelegt wird es erst, wenn ein Test wirklich ein Bild schreibt.
 */
process.env.RECEIPT_DIR = testBildablage(process.env, process.cwd(), () => join(tmpdir(), 'bon-tests', `bilder-${process.pid}`));

/**
 * In Tests gibt es keine Datenbank. Die Module sollen sich trotzdem laden lassen —
 * $lib/server/db baut seine Verbindungszeichenfolge beim Import zusammen und wirft
 * seit der Passwort-Haertung, wenn weder DATABASE_URL noch DATABASE_URL_TEMPLATE da
 * sind. Diese Strenge ist gewollt: im Betrieb soll ein fehlendes Passwort sofort und
 * deutlich scheitern, statt spaeter mit einer Meldung, die woanders hinzeigt.
 *
 * Verbunden wird hier nie — jeder Test, der die Datenbank braucht, ersetzt sie durch
 * eine Nachbildung. Der Port 1 ist bewusst unbrauchbar: sollte doch einmal jemand
 * versehentlich verbinden, scheitert es sofort statt gegen eine echte Datenbank zu
 * laufen.
 *
 * `||=`: ein echtes DATABASE_URL bleibt unangetastet. Die Live-Waechter hinter
 * RUN_DB_TESTS setzen es auf der Kommandozeile und arbeiten gegen die Test-Datenbank
 * bon_test (siehe oben).
 */
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test-attrappe';
