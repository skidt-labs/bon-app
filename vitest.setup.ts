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
 * RUN_DB_TESTS setzen es auf der Kommandozeile und muessen weiter gegen die laufende
 * Datenbank arbeiten koennen.
 */
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test-attrappe';
