import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { betriebsprotokoll, instanz, kiAnbieter } from '$lib/server/db/schema';
import { zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import * as ki from './ki';
import { BildwegNichtFreigegeben } from '$lib/server/ki/fehler';

/**
 * Gegen die Test-Datenbank, JEDER Fall in einer zurueckgerollten Transaktion:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/betrieb/ki.db.test.ts
 *
 * Jede Funktion nimmt die Verbindung als letzten Parameter `d`; ihre eigene Transaktion wird
 * darin zum Sicherungspunkt. Bis 0.10.0 committete der erste Abschnitt und raeumte in `finally`
 * auf: der Worker schaltete dabei kurz auf die Test-Karte, und das Aufraeumen loeschte alle
 * Protokollzeilen ohne Benutzer ab Teststart — auch echte des Workers.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const env = { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;
const basis = {
	name: 'db-test-anbieter',
	weg: 'text' as const,
	baseUrl: 'http://mlx.invalid/v1',
	modell: 'qwen',
	zeitlimitMs: 60_000,
	preisEinMicro: null,
	preisAusMicro: null,
	schluessel: null,
	schluesselEntfernen: false
};

const FREI = { ...env, EXTRACTION_BILDWEG_BESTAETIGT: 'ja' } as NodeJS.ProcessEnv;

/** Der Stand, den anbieterTesten vor dem Test merkt (geaendert_am in voller Genauigkeit). */
async function testStand(tx: Tx, id: string): Promise<string> {
	const [z] = await tx.select({ s: sql<string>`${kiAnbieter.geaendertAm}::text` }).from(kiAnbieter).where(eq(kiAnbieter.id, id));
	return z.s;
}

/** Zurueckgerollt, mit leerer Ausgangslage: kein aktiver Anbieter (die .env gilt), keine Reserve. */
async function imLeerenStand(f: (tx: Tx) => Promise<void>): Promise<void> {
	await zurueckgerollt(async (tx) => {
		const leer = { aktiverKiAnbieter: null, reserveKiAnbieter: null, reserveAktivSeit: null, reserveGrenzeGemeldet: null };
		await tx.insert(instanz).values({ id: 1, ...leer }).onConflictDoUpdate({ target: instanz.id, set: leer });
		await f(tx);
	});
}

describe.skipIf(AUS)('KI-Anbieter gegen die Test-Datenbank', () => {
	it('aktiviert nur nach erfolgreichem Test, erhoeht den Stand und protokolliert', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen(basis, null as never, env, d);
			await expect(ki.anbieterAktivieren(id, null as never, env, d)).rejects.toBeInstanceOf(ki.NichtGetestet);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(tx, id), d);
			const vorher = (await ki.kiStandLesen(d)).stand;
			await ki.anbieterAktivieren(id, null as never, env, d);
			expect(await ki.kiStandLesen(d)).toEqual({ aktivId: id, stand: vorher + 1 });
			const eintraege = await tx.select().from(betriebsprotokoll).where(eq(betriebsprotokoll.ziel, 'db-test-anbieter'));
			expect(eintraege.map((e) => e.aktion)).toEqual(expect.arrayContaining(['ki.angelegt', 'ki.getestet', 'ki.aktiviert']));
		});
	});

	it('setzt test_ok beim Bearbeiten zurueck und erhoeht den Stand, wenn der Anbieter aktiv ist', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen(basis, null as never, env, d);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(tx, id), d);
			await ki.anbieterAktivieren(id, null as never, env, d);
			const stand = (await ki.kiStandLesen(d)).stand;
			await ki.anbieterAendern(id, { ...basis, modell: 'qwen-neu' }, null as never, env, d);
			expect((await ki.kiStandLesen(d)).stand).toBe(stand + 1);
			const [z] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z).toMatchObject({ modell: 'qwen-neu', testOk: null });
		});
	});

	it('behaelt den Schluessel bei leerem Feld und entfernt ihn nur auf ausdruecklichen Wunsch', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-geheim-a3f9' }, null as never, env, d);
			await ki.anbieterAendern(id, basis, null as never, env, d);
			let [z] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.schluesselEnde).toBe('a3f9');
			expect(z.schluesselEnc).not.toBeNull();
			await ki.anbieterAendern(id, { ...basis, schluesselEntfernen: true }, null as never, env, d);
			[z] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.schluesselEnc).toBeNull();
		});
	});

	it('gibt in der Liste weder den Chiffretext noch den Klartext heraus', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-geheim-a3f9' }, null as never, env, d);
			const liste = await ki.anbieterListe(env, d);
			const text = JSON.stringify(liste);
			expect(text).not.toContain('sk-geheim');
			expect(text).not.toContain('schluesselEnc');
			expect(liste.find((k) => k.id === id)).toMatchObject({ hatSchluessel: true, schluesselEnde: 'a3f9', schluesselLesbar: true });
		});
	});

	it('zeigt einen mit anderem SECRETS_KEY gespeicherten Schluessel als nicht lesbar', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-1234' }, null as never, env, d);
			const anderer = { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;
			expect((await ki.anbieterListe(anderer, d)).find((k) => k.id === id)?.schluesselLesbar).toBe(false);
		});
	});

	it('verweigert das Loeschen des aktiven Anbieters', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen(basis, null as never, env, d);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(tx, id), d);
			await ki.anbieterAktivieren(id, null as never, env, d);
			await expect(ki.anbieterLoeschen(id, null as never, d)).rejects.toBeInstanceOf(ki.AnbieterAktiv);
			await ki.zurueckAufEnv(null as never, d);
			expect((await ki.kiStandLesen(d)).aktivId).toBeNull();
		});
	});

	it('verweigert einen Bildweg-Anbieter ohne Freigabe', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			// Anlegen nur MIT Freigabe (siehe unten); aktiviert wird dann ohne.
			const id = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, FREI, d);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(tx, id), d);
			await expect(ki.anbieterAktivieren(id, null as never, env, d)).rejects.toThrow(/nicht freigegeben/);
		});
	});

	it('verwirft ein Testergebnis, wenn der Anbieter waehrend des Tests geaendert wurde', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const id = await ki.anbieterAnlegen(basis, null as never, env, d);
			// Frisch angelegt: geaendert_am kommt aus now() und hat Mikrosekunden. Der
			// Vergleich muss sie halten, sonst schlüge JEDER Test eines neuen Anbieters fehl.
			const gemerkt = await testStand(tx, id);
			expect(await ki.testErgebnisSpeichern(id, true, 'ok', null as never, gemerkt, d)).toBe(true);

			const vorDemTest = await testStand(tx, id);
			await ki.anbieterAendern(id, { ...basis, modell: 'qwen-neu' }, null as never, env, d);
			expect(await ki.testErgebnisSpeichern(id, true, 'ok', null as never, vorDemTest, d)).toBe(false);
			const [z] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.testOk).toBeNull();
			const eintraege = await tx.select().from(betriebsprotokoll).where(eq(betriebsprotokoll.ziel, 'db-test-anbieter'));
			expect(eintraege.filter((e) => e.aktion === 'ki.getestet')).toHaveLength(1);
		});
	});

	it('legt einen Bildweg-Anbieter ohne Freigabe nicht an', async () => {
		await imLeerenStand(async (tx) => {
			const r = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, env, tx as never).then(
				() => null,
				(e: unknown) => e
			);
			expect(r).toBeInstanceOf(BildwegNichtFreigegeben);
			expect(await tx.select().from(kiAnbieter).where(eq(kiAnbieter.name, 'db-test-anbieter'))).toHaveLength(0);
		});
	});

	it('stellt ohne Freigabe nicht auf den Bildweg um, laesst einen Bildweg-Anbieter aber bearbeiten', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const text = await ki.anbieterAnlegen(basis, null as never, env, d);
			await expect(ki.anbieterAendern(text, { ...basis, weg: 'bild' }, null as never, env, d)).rejects.toBeInstanceOf(BildwegNichtFreigegeben);
			const bild = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, FREI, d);
			await ki.anbieterAendern(bild, { ...basis, weg: 'bild', modell: 'qwen-neu' }, null as never, env, d);
			const [z] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, bild));
			expect(z).toMatchObject({ weg: 'bild', modell: 'qwen-neu' });
			const [t] = await tx.select().from(kiAnbieter).where(eq(kiAnbieter.id, text));
			expect(t.weg).toBe('text');
		});
	});
});

/**
 * Cloud-Reserve (Entwurf 2026-10-01). JEDER Fall in einer zurueckgerollten Transaktion, wie die
 * Faelle oben ueber imLeerenStand: der Worker liest instanz.reserve_* bei jedem Bon, und eine
 * Test-Reserve, die auch nur kurz sichtbar waere, koennte einen echten Bon umleiten. Neue Faelle
 * ebenso ueber imLeerenStand — das nackte zurueckgerollt aus testdaten setzt instanz nicht
 * zurueck, der Fall hinge dann vom zufaelligen Stand in bon_test ab.
 */
describe.skipIf(AUS)('Cloud-Reserve auf der Betriebsseite gegen die Test-Datenbank', () => {
	const MIT_ENV = { ...env, EXTRACTION_PROVIDER: 'ocr-text', EXTRACTION_BASE_URL: 'http://mac.invalid/v1', EXTRACTION_API_KEY: 'k', EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv;

	async function karte(tx: Tx, teil: Partial<typeof kiAnbieter.$inferInsert> = {}): Promise<string> {
		const [k] = await tx
			.insert(kiAnbieter)
			.values({ name: 'db-test-reserve', weg: 'text', baseUrl: 'http://reserve.invalid/v1', modell: 'flash', zeitlimitMs: 60_000, testOk: true, preisEinMicro: 300_000, preisAusMicro: 2_500_000, ...teil })
			.returning({ id: kiAnbieter.id });
		return k.id;
	}

	const stand = async (tx: Tx) => (await tx.select().from(instanz).where(eq(instanz.id, 1)))[0];
	const fehler = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

	it('verweigert das Festlegen bei Bildweg, ohne Test, ohne Preise und fuer die aktive Karte', async () => {
		await imLeerenStand(async (tx) => {
			for (const teil of [{ weg: 'bild' as const }, { testOk: false }, { testOk: null }, { preisAusMicro: null }]) {
				const id = await karte(tx, teil);
				expect(await fehler(ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never))).toBeInstanceOf(ki.ReserveNichtMoeglich);
			}
			const aktiv = await karte(tx);
			await tx.update(instanz).set({ aktiverKiAnbieter: aktiv }).where(eq(instanz.id, 1));
			const f = await fehler(ki.reserveFestlegen(aktiv, null as never, MIT_ENV, tx as never));
			expect((f as ki.ReserveNichtMoeglich).grund).toBe('Das ist der aktive Hauptanbieter.');
			expect((await stand(tx)).reserveKiAnbieter).toBeNull();
		});
	});

	it('legt fest: Reserve gesetzt, ki_stand +1, Protokoll; loeschen ist dann gesperrt', async () => {
		await imLeerenStand(async (tx) => {
			const id = await karte(tx);
			const vorher = (await stand(tx)).kiStand;
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			const nachher = await stand(tx);
			expect(nachher.reserveKiAnbieter).toBe(id);
			expect(nachher.kiStand).toBe(vorher + 1);
			const [p] = await tx.select().from(betriebsprotokoll).where(and(eq(betriebsprotokoll.aktion, 'ki.reserve_gesetzt'), sql`${betriebsprotokoll.details}->>'neu' = ${id}`));
			expect(p).toBeDefined();
			expect(await fehler(ki.anbieterLoeschen(id, null as never, tx as never))).toBeInstanceOf(ki.AnbieterIstReserve);
		});
	});

	// Nicht im Plan, beim Bau gefunden: die Reserve-Karte zum Hauptanbieter zu machen, liesse
	// sie Haupt UND Reserve zugleich sein — jeder Bon ginge in die Cloud.
	it('verweigert das Aktivieren der Reserve-Karte', async () => {
		await imLeerenStand(async (tx) => {
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			expect(await fehler(ki.anbieterAktivieren(id, null as never, MIT_ENV, tx as never))).toBeInstanceOf(ki.AnbieterIstReserve);
			expect((await stand(tx)).aktiverKiAnbieter).toBeNull();
		});
	});

	it('entfernt die Reserve auch, waehrend sie liest', async () => {
		await imLeerenStand(async (tx) => {
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			await tx.update(instanz).set({ reserveAktivSeit: new Date() }).where(eq(instanz.id, 1));
			await ki.reserveEntfernen(null as never, tx as never);
			const s = await stand(tx);
			expect(s.reserveKiAnbieter).toBeNull();
			expect(s.reserveAktivSeit).toBeNull();
		});
	});

	it('eine neue Grenze leert den gemeldeten Monat', async () => {
		await imLeerenStand(async (tx) => {
			await tx.update(instanz).set({ reserveGrenzeGemeldet: '2031-10' }).where(eq(instanz.id, 1));
			await ki.reserveGrenzeSpeichern(12_000_000, null as never, tx as never);
			const s = await stand(tx);
			expect(s.reserveGrenzeMicro).toBe(12_000_000);
			expect(s.reserveGrenzeGemeldet).toBeNull();
		});
	});

	it('Bearbeiten der Reserve-Karte erhoeht ki_stand, damit der Worker den neuen Schluessel nimmt', async () => {
		await imLeerenStand(async (tx) => {
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			const vorher = (await stand(tx)).kiStand;
			await ki.anbieterAendern(id, { ...basis, name: 'db-test-reserve', modell: 'flash-2', preisEinMicro: 300_000, preisAusMicro: 2_500_000 }, null as never, MIT_ENV, tx as never);
			expect((await stand(tx)).kiStand).toBe(vorher + 1);
		});
	});

	// Abschlusspruefung 02.10.: die Seite muss sagen, was der Worker tut — eine nachtraeglich auf
	// Bildweg gestellte oder preislose Reserve-Karte wirkt nicht.
	it('reserveStand: eine Reserve-Karte ohne Preise oder mit Bildweg ist wirkungslos, mit Grund', async () => {
		await imLeerenStand(async (tx) => {
			const jetzt = new Date('2031-10-15T12:00:00Z');
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			await tx.update(kiAnbieter).set({ preisAusMicro: null }).where(eq(kiAnbieter.id, id));
			expect(await ki.reserveStand(MIT_ENV, jetzt, tx as never)).toMatchObject({
				zustand: 'wirkungslos',
				grund: 'Preise fehlen — ohne sie lässt sich die Monatsgrenze nicht prüfen.'
			});
			await tx.update(kiAnbieter).set({ preisAusMicro: 2_500_000, weg: 'bild' }).where(eq(kiAnbieter.id, id));
			expect(await ki.reserveStand(MIT_ENV, jetzt, tx as never)).toMatchObject({ zustand: 'wirkungslos', grund: 'Die Reserve-Karte nutzt den Bildweg.' });
		});
	});

	it('reserveStand: keine, bereit, aktiv mit Grund aus dem Protokoll', async () => {
		await imLeerenStand(async (tx) => {
			const jetzt = new Date('2031-10-15T12:00:00Z');
			expect((await ki.reserveStand(MIT_ENV, jetzt, tx as never)).zustand).toBe('keine');
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			expect(await ki.reserveStand(MIT_ENV, jetzt, tx as never)).toMatchObject({ zustand: 'bereit', name: 'db-test-reserve', modell: 'flash' });
			await tx.update(instanz).set({ reserveAktivSeit: new Date() }).where(eq(instanz.id, 1));
			await tx.insert(betriebsprotokoll).values({ userId: null, aktion: 'ki.reserve_aktiv', ziel: 'Reserve', details: { grund: 'Zeitüberschreitung' }, zeit: new Date('2031-10-15T11:59:00Z') });
			expect(await ki.reserveStand(MIT_ENV, jetzt, tx as never)).toMatchObject({ zustand: 'aktiv', grund: 'Zeitüberschreitung' });
			await tx.update(instanz).set({ reserveGrenzeMicro: 0 }).where(eq(instanz.id, 1));
			expect((await ki.reserveStand(MIT_ENV, jetzt, tx as never)).zustand).toBe('grenze');
		});
	});

	// 4.10: die Seite bekommt den ECHTEN reserveStand — er darf weder Chiffretext noch Klartext tragen.
	it('reserveStand traegt weder schluesselEnc noch den Schluessel, bereit wie aktiv', async () => {
		await imLeerenStand(async (tx) => {
			const d = tx as never;
			const jetzt = new Date('2031-10-15T12:00:00Z');
			const id = await ki.anbieterAnlegen(
				{ ...basis, name: 'db-test-reserve', schluessel: 'sk-reserve-geheim-7c1d', preisEinMicro: 300_000, preisAusMicro: 2_500_000 },
				null as never,
				MIT_ENV,
				d
			);
			await tx.update(kiAnbieter).set({ testOk: true }).where(eq(kiAnbieter.id, id));
			await ki.reserveFestlegen(id, null as never, MIT_ENV, d);
			const [z] = await tx.select({ enc: kiAnbieter.schluesselEnc }).from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.enc).not.toBeNull();
			const bereit = await ki.reserveStand(MIT_ENV, jetzt, d);
			await tx.update(instanz).set({ reserveAktivSeit: new Date() }).where(eq(instanz.id, 1));
			const aktiv = await ki.reserveStand(MIT_ENV, jetzt, d);
			expect([bereit.zustand, aktiv.zustand]).toEqual(['bereit', 'aktiv']);
			for (const s of [bereit, aktiv]) {
				const text = JSON.stringify(s);
				expect(text).not.toContain('schluesselEnc');
				expect(text).not.toContain('sk-reserve-geheim');
				// Der Chiffretext unter JEDEM Feldnamen: so stuende ein Buffer im JSON.
				expect(text).not.toContain('"type":"Buffer"');
				expect(text).not.toContain(JSON.stringify(z.enc));
				expect(text).not.toContain(z.enc!.toString('base64'));
				expect(text).not.toContain('7c1d');
			}
		});
	});

	// 4.6 (Sammelfassung 0.11.0): Wer den Hauptanbieter wechselt, beendet ein stehengebliebenes
	// „Reserve liest seit …" — sonst ginge der naechste Bon an der neuen Karte vorbei in die Cloud.
	const reserveEintraege = (tx: Tx, anlass: string) =>
		tx
			.select({ details: betriebsprotokoll.details })
			.from(betriebsprotokoll)
			.where(and(eq(betriebsprotokoll.aktion, 'ki.reserve_zurueck'), sql`${betriebsprotokoll.details}->>'anlass' = ${anlass}`));

	it('4.6: Aktivieren eines Anbieters beendet „Reserve aktiv", mit Protokoll', async () => {
		await imLeerenStand(async (tx) => {
			const reserve = await karte(tx);
			await ki.reserveFestlegen(reserve, null as never, MIT_ENV, tx as never);
			const seit = new Date('2031-10-15T10:00:00Z');
			await tx.update(instanz).set({ reserveAktivSeit: seit }).where(eq(instanz.id, 1));
			const haupt = await karte(tx, { name: 'db-test-haupt', baseUrl: 'http://mac.invalid/v1' });
			await ki.anbieterAktivieren(haupt, null as never, MIT_ENV, tx as never);
			const s = await stand(tx);
			expect(s.aktiverKiAnbieter).toBe(haupt);
			expect(s.reserveKiAnbieter).toBe(reserve);
			expect(s.reserveAktivSeit).toBeNull();
			expect((await reserveEintraege(tx, 'Anbieter aktiviert')).map((e) => e.details)).toEqual([
				{ anlass: 'Anbieter aktiviert', seit: seit.toISOString() }
			]);
		});
	});

	it('4.6: „Zurück auf .env" beendet „Reserve aktiv", mit Protokoll', async () => {
		await imLeerenStand(async (tx) => {
			const reserve = await karte(tx);
			await ki.reserveFestlegen(reserve, null as never, MIT_ENV, tx as never);
			const seit = new Date('2031-10-15T10:00:00Z');
			await tx.update(instanz).set({ reserveAktivSeit: seit }).where(eq(instanz.id, 1));
			await ki.zurueckAufEnv(null as never, tx as never);
			expect((await stand(tx)).reserveAktivSeit).toBeNull();
			expect((await reserveEintraege(tx, 'Zurück auf .env')).map((e) => e.details)).toEqual([
				{ anlass: 'Zurück auf .env', seit: seit.toISOString() }
			]);
		});
	});

	it('4.6: ohne „Reserve aktiv" schreibt der Wechsel keinen Reserve-Eintrag (Gegenprobe)', async () => {
		await imLeerenStand(async (tx) => {
			const zaehle = async () =>
				(await tx.select({ n: sql<number>`count(*)::int` }).from(betriebsprotokoll).where(eq(betriebsprotokoll.aktion, 'ki.reserve_zurueck')))[0].n;
			const vorher = await zaehle();
			const haupt = await karte(tx, { name: 'db-test-haupt' });
			await ki.anbieterAktivieren(haupt, null as never, MIT_ENV, tx as never);
			await ki.zurueckAufEnv(null as never, tx as never);
			expect(await zaehle()).toBe(vorher);
		});
	});
});
