import { relative, resolve, isAbsolute } from 'node:path';

/**
 * DB-Tests nur gegen eine Test-Datenbank (Sammelfassung 0.11.0, Bereich 0).
 *
 * Bis 0.10.0 liefen sie gegen die Produktion: sechs Dateien schrieben dort committete Zeilen,
 * vier gingen per psql fest auf `bon`. Jetzt gibt es `bon_test` im selben Container, und
 * vitest.setup.ts verweigert jeden Lauf mit RUN_DB_TESTS=1, dessen DATABASE_URL nicht auf eine
 * Datenbank zeigt, deren Name auf `_test` endet. Die Meldung nennt nur den Namen, nie die
 * Adresse — in ihr steht das Passwort.
 */
export function datenbankName(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
		const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
		return name === '' || name.includes('/') ? null : name;
	} catch {
		return null;
	}
}

export function istTestDatenbank(url: string): boolean {
	return datenbankName(url)?.endsWith('_test') ?? false;
}

/** Warum ein Testlauf nicht starten darf — null, wenn er darf. */
export function dbTestsVerweigert(env: NodeJS.ProcessEnv): string | null {
	if (env.RUN_DB_TESTS !== '1') return null;
	const url = env.DATABASE_URL?.trim() ?? '';
	if (url === '') return 'RUN_DB_TESTS=1 ohne DATABASE_URL — DB-Tests brauchen DATABASE_URL auf die Test-Datenbank bon_test.';
	if (istTestDatenbank(url)) return null;
	const name = datenbankName(url);
	const wohin = name === null ? 'keine lesbare Datenbank' : `die Datenbank „${name}"`;
	return `RUN_DB_TESTS=1, aber DATABASE_URL zeigt auf ${wohin}. DB-Tests laufen nur gegen eine Datenbank, deren Name auf _test endet (bon_test) — abgebrochen, bevor etwas geschrieben wurde.`;
}

/**
 * Die Bildablage fuer einen Testlauf (Abschlusspruefung 0.11.0). Ohne RECEIPT_DIR schreibt und
 * loescht storage/images.ts in ./data/receipts — im Arbeitsverzeichnis ist das die Ablage der
 * Produktion (compose.yaml haengt sie ein). Ein DB-Test, der das echte loescheBilder erreicht,
 * loeschte dort endgueltig; das Zurueckrollen der Transaktion holt keine Datei zurueck.
 * Darum: fehlt RECEIPT_DIR oder zeigt es in diese Ablage, gilt ein eigenes Verzeichnis.
 */
export function testBildablage(env: NodeJS.ProcessEnv, wurzel: string, neu: () => string): string {
	const dir = env.RECEIPT_DIR?.trim();
	if (!dir) return neu();
	const r = relative(resolve(wurzel, 'data/receipts'), resolve(wurzel, dir));
	const inProduktion = r === '' || (!r.startsWith('..') && !isAbsolute(r));
	return inProduktion ? neu() : dir;
}
