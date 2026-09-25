/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/matrix/pairing.db.test.ts
 *
 * Bewacht zwei Eigenschaften, die der Mock in pairing.test.ts NICHT prüfen kann:
 *
 * 1. Von N gleichzeitigen Einlösungen DESSELBEN Codes darf nur eine durchkommen —
 *    die FOR-UPDATE-Sperre in der Transaktion muss jeden weiteren Aufrufer so lange
 *    blockieren, bis der Gewinner committet hat, und ihm danach sauber 'verbraucht'
 *    zurückgeben statt eines rohen Datenbankfehlers (Korrekturrunde 1).
 * 2. Der Fehlversuchszähler darf unter Nebenläufigkeit keine Updates verlieren —
 *    N gleichzeitige Fehlversuche DESSELBEN Absenders müssen den Zähler exakt bis
 *    MAX_FEHLVERSUCHE steigen lassen (nicht weniger durch verlorene Schreibvorgänge,
 *    nicht mehr, weil ab dort jeder weitere Versuch geblockt wird), und dürfen
 *    NIEMALS werfen (Korrekturrunde 2).
 *
 * Bewusst OHNE eigene Transaktion um die Wettläufe: ein Rollback-Test würde sie gerade
 * wegdefinieren, zwei Anweisungen derselben Transaktion laufen nie gleichzeitig. Es
 * braucht echte parallele Verbindungen (vgl. household.db.test.ts) — genau die, die
 * db.transaction() aus dem Pool zieht.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db } from '../db';
import {
	households,
	users,
	householdMembers,
	matrixPairingCodes,
	matrixLinks,
	matrixPairingAttempts
} from '../db/schema';
import { codeAnlegen, codeEinloesen, erzeugeCode, MAX_FEHLVERSUCHE } from './pairing';

const RUN = process.env.RUN_DB_TESTS === '1';
const TAG = `test-wettlauf-pairing-${Date.now()}`;
const ZAEHLER_ABSENDER = `@${TAG}-zaehler:example.org`;

let userId: string | undefined;

// Befund R02: eigenes Paar Haushalt/Nutzer fuer den "kein_mitglied"-Test unten — der
// bestehende `userId` oben gehoert zum Wettlauf-Test und wird von dessen afterAll
// bereits verwaltet; ein zweiter, unabhaengiger Testfall braucht eine eigene Zeile,
// die er selbst wieder aufraeumt.
let ohneMitgliedschaftUserId: string | undefined;
let ohneMitgliedschaftHaushaltId: string | undefined;

afterAll(async () => {
	if (!RUN) return;
	// Reihenfolge wegen der Fremdschlüssel: erst Abhängiges, dann den Nutzer, dann
	// den Haushalt. Eigener Slug/Tag, damit der echte Standard-Haushalt unberührt
	// bleibt. LIKE statt einzelner eq(): Test 1 erzeugt N EIGENE Matrix-Konten
	// (@TAG-r0, @TAG-r1, ...), alle mit demselben Tag als Präfix/Infix.
	await db.delete(matrixLinks).where(like(matrixLinks.matrixUserId, `%${TAG}%`));
	await db.delete(matrixPairingAttempts).where(like(matrixPairingAttempts.matrixUserId, `%${TAG}%`));
	if (userId) {
		await db.delete(matrixPairingCodes).where(eq(matrixPairingCodes.userId, userId));
		await db.delete(users).where(eq(users.id, userId));
	}
	await db.delete(households).where(eq(households.slug, TAG));

	if (ohneMitgliedschaftUserId) {
		await db.delete(matrixPairingCodes).where(eq(matrixPairingCodes.userId, ohneMitgliedschaftUserId));
		await db.delete(users).where(eq(users.id, ohneMitgliedschaftUserId));
	}
	if (ohneMitgliedschaftHaushaltId) {
		await db.delete(households).where(eq(households.id, ohneMitgliedschaftHaushaltId));
	}
});

describe.skipIf(!RUN)('codeEinloesen unter Wettlauf (live)', () => {
	it('lässt von zwei gleichzeitigen Einlösungen DESSELBEN Codes genau eine gewinnen', async () => {
		const [haushalt] = await db
			.insert(households)
			.values({ name: 'Wettlauf-Test', slug: TAG })
			.returning({ id: households.id });
		const [nutzer] = await db
			.insert(users)
			.values({
				oidcSub: TAG,
				email: `${TAG}@example.invalid`,
				displayName: 'Wettlauf-Test'
			})
			.returning({ id: users.id });
		userId = nutzer.id;
		// Befund R02: codeEinloesen() prueft jetzt eine bestehende Mitgliedschaft —
		// ohne diese Zeile waere JEDE Einloesung hier faelschlich 'kein_mitglied'.
		await db.insert(householdMembers).values({ householdId: haushalt.id, userId, rolle: 'mitglied' });

		const { code } = await codeAnlegen(userId);

		// N verschiedene ABSENDER, nicht einer: sonst verheddert sich dieser Test mit
		// dem Fehlversuchszähler aus Korrekturrunde 2 — ein wiederholter Treffer auf
		// einen bereits verbrauchten Code zählt jetzt korrekt als Fehlversuch, und ab
		// MAX_FEHLVERSUCHE würden weitere Anrufe 'zu_viele_versuche' statt 'verbraucht'
		// bekommen. Das ist RICHTIG (siehe Test unten), verwässert hier aber die Aussage
		// über den Code-Wettlauf. Mit N verschiedenen Absendern bleibt jeder für sich
		// unter der Grenze, und dieser Test prüft ausschliesslich die FOR-UPDATE-Sperre
		// auf der Codezeile.
		//
		// N=15, nicht 2: mit nur zwei gleichzeitigen Aufrufen entkommt der Wettlauf dem
		// Test öfter, als man denkt — auf einer schnellen lokalen Verbindung kann der
		// zweite Aufruf so spät starten, dass der erste längst committet hat, und der
		// Test wird grün, OBWOHL die Sperre fehlt. Erst ab genug gleichzeitigem Druck
		// überlappen genug Aufrufe zuverlässig am kritischen Abschnitt. Gegenprobe (vor
		// dieser Fassung durchgeführt, nicht Teil der Suite): mit N=2 gegen die
		// EHEMALIGE, transaktionslose Fassung blieb der Test in einem von drei Läufen
		// grün — ein Wächter, der nicht zuverlässig scheitert, ist keiner. Mit N=15 hat
		// dieselbe Gegenprobe in drei von drei Läufen mehrfach verworfen (rohe
		// Datenbankfehler statt eines EinloeseErgebnis).
		const N = 15;
		const settled = await Promise.allSettled(
			Array.from({ length: N }, (_, i) => codeEinloesen(code, `@${TAG}-r${i}:example.org`))
		);

		// Entscheidend: KEIN einziger Aufruf darf verwerfen (throw) — das war der
		// ursprüngliche Defekt (Korrekturrunde 1): der Bot bekäme sonst gar keine
		// Antwort statt einer sauberen Absage.
		const verworfen = settled.filter((s) => s.status === 'rejected');
		expect(verworfen, `Verworfen: ${verworfen.map((s) => String((s as PromiseRejectedResult).reason)).join(' | ')}`).toHaveLength(0);

		const ergebnisse = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof codeEinloesen>>>).value);
		const erfolge = ergebnisse.filter((e) => e.ok);
		const abgelehnt = ergebnisse.filter((e) => !e.ok);
		expect(erfolge, `Ergebnisse: ${JSON.stringify(ergebnisse)}`).toHaveLength(1);
		expect(abgelehnt, `Ergebnisse: ${JSON.stringify(ergebnisse)}`).toHaveLength(N - 1);
		for (const e of abgelehnt) expect(e).toMatchObject({ ok: false, grund: 'verbraucht' });
		expect((erfolge[0] as { ok: true; userId: string }).userId).toBe(userId);

		const linkZeilen = await db
			.select()
			.from(matrixLinks)
			.where(like(matrixLinks.matrixUserId, `%${TAG}%`));
		expect(linkZeilen).toHaveLength(1);
	});

	// Korrekturrunde 2: Der Prüfer hat gemessen, dass 20 gleichzeitige Fehlversuche
	// denselben Zähler wegen einer Lese-vor-Transaktion nur bis 2 statt bis 5+ steigen
	// liessen — der Zähler war die einzige Schutzmassnahme gegen Codes raten, und
	// genau diese Schutzmassnahme liess sich durch gleichzeitige statt nacheinander
	// geschickte Versuche aushebeln.
	it('lässt den Fehlversuchszähler unter Nebenläufigkeit exakt bis MAX_FEHLVERSUCHE steigen, ohne zu werfen', async () => {
		// Ein Code, den es garantiert nicht gibt: erzeugeCode() statt codeAnlegen(),
		// damit KEINE Zeile in matrix_pairing_codes entsteht und jeder Versuch
		// zuverlässig als 'unbekannt' zählt (kein zufälliger Treffer möglich).
		const code = erzeugeCode();

		// N=20, wie beim Prüfer: genug gleichzeitiger Druck, damit sich die Aufrufe
		// zuverlässig am kritischen Abschnitt überlappen (vgl. Kommentar beim
		// Einlöse-Wettlauf oben — mit zu wenig gleichzeitigen Aufrufen entkommt ein
		// fehlerhafter Stand dem Test).
		const N = 20;
		const settled = await Promise.allSettled(
			Array.from({ length: N }, () => codeEinloesen(code, ZAEHLER_ABSENDER))
		);

		// Entscheidend: KEIN einziger Aufruf darf verwerfen (throw) — Korrekturrunde 2.
		const verworfen = settled.filter((s) => s.status === 'rejected');
		expect(
			verworfen,
			`Verworfen: ${verworfen.map((s) => String((s as PromiseRejectedResult).reason)).join(' | ')}`
		).toHaveLength(0);

		const ergebnisse = settled.map(
			(s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof codeEinloesen>>>).value
		);
		const alsUnbekannt = ergebnisse.filter((e) => !e.ok && e.grund === 'unbekannt');
		const geblockt = ergebnisse.filter((e) => !e.ok && e.grund === 'zu_viele_versuche');

		// Bei sauberer Serialisierung schaffen es genau MAX_FEHLVERSUCHE Aufrufe bis zur
		// Prüfung, BEVOR der Zähler die Grenze erreicht (jeder von ihnen erhöht ihn um
		// eins); jeder weitere sieht den Zähler schon an der Grenze und wird geblockt,
		// OHNE ihn weiter zu erhöhen. Verlorene Schreibvorgänge (der ursprüngliche
		// Defekt) würden weniger als MAX_FEHLVERSUCHE 'unbekannt'-Ergebnisse und einen
		// Zähler unter MAX_FEHLVERSUCHE hinterlassen.
		expect(alsUnbekannt, `Ergebnisse: ${JSON.stringify(ergebnisse)}`).toHaveLength(MAX_FEHLVERSUCHE);
		expect(geblockt, `Ergebnisse: ${JSON.stringify(ergebnisse)}`).toHaveLength(N - MAX_FEHLVERSUCHE);

		const [zeile] = await db
			.select()
			.from(matrixPairingAttempts)
			.where(eq(matrixPairingAttempts.matrixUserId, ZAEHLER_ABSENDER));
		expect(zeile.failedCount).toBe(MAX_FEHLVERSUCHE);

		// Und die Sperre greift jetzt tatsächlich, auch bei einem WEITEREN, ganz
		// gewöhnlichen (nicht gleichzeitigen) Versuch desselben Absenders.
		expect(await codeEinloesen(code, ZAEHLER_ABSENDER)).toEqual({
			ok: false,
			grund: 'zu_viele_versuche'
		});
	});
});

/**
 * Befund R02, Schicht 2: Verteidigung in der Tiefe. `mitgliedEntfernen()` raeumt offene
 * Kopplungscodes ab (siehe einladungen.db.test.ts) — dieser Test prueft den Weg
 * UNABHAENGIG davon, fuer den Fall, dass ein Code trotzdem uebrig bleibt (z. B. ein
 * kuenftiger Codepfad, der diese Abraeumung vergisst): ein gueltiger, nicht abgelaufener
 * Code darf sich nicht einloesen lassen, wenn sein Besitzer keine Mitgliedschaft mehr
 * hat.
 */
describe.skipIf(!RUN)('codeEinloesen ohne Mitgliedschaft (live)', () => {
	it('lehnt einen gültigen, nicht abgelaufenen Code ab, dessen Besitzer keine Mitgliedschaft mehr hat', async () => {
		const tag = `test-kein-mitglied-${Date.now()}`;
		const [haushalt] = await db
			.insert(households)
			.values({ name: 'Kein-Mitglied-Test', slug: tag })
			.returning({ id: households.id });
		ohneMitgliedschaftHaushaltId = haushalt.id;
		const [nutzer] = await db
			.insert(users)
			.values({
				oidcSub: tag,
				email: `${tag}@example.invalid`,
				displayName: 'Kein-Mitglied-Test'
			})
			.returning({ id: users.id });
		ohneMitgliedschaftUserId = nutzer.id;
		await db.insert(householdMembers).values({ householdId: haushalt.id, userId: nutzer.id, rolle: 'mitglied' });

		const { code } = await codeAnlegen(nutzer.id);

		// Die Mitgliedschaft geht bewusst NICHT ueber mitgliedEntfernen() weg, sondern
		// direkt — genau der "trotzdem vorhandene Code" aus dem Auftrag, isoliert von
		// Schicht 1.
		await db.delete(householdMembers).where(eq(householdMembers.userId, nutzer.id));

		const matrixUserId = `@${tag}:example.org`;
		expect(await codeEinloesen(code, matrixUserId)).toEqual({ ok: false, grund: 'kein_mitglied' });

		const links = await db.select().from(matrixLinks).where(eq(matrixLinks.matrixUserId, matrixUserId));
		expect(links).toHaveLength(0);
	});
});
