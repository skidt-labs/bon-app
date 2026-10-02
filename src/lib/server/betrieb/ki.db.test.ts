import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { betriebsprotokoll, instanz, kiAnbieter } from '$lib/server/db/schema';
import * as ki from './ki';
import { BildwegNichtFreigegeben } from '$lib/server/ki/fehler';

/**
 * Gegen die LAUFENDE Datenbank:
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/betrieb/ki.db.test.ts
 *
 * Die Funktionen oeffnen eigene Transaktionen und lassen sich deshalb nicht in eine
 * aeussere zurueckgerollte Transaktion stecken. Jeder Test raeumt darum in `finally`
 * selbst auf: Instanzzeile auf den gelesenen Stand zurueck, eigene Anbieter und
 * Protokollzeilen weg. Er fasst nur Zeilen an, die er selbst angelegt hat — und die
 * Instanzzeile, die er vorher sichert.
 *
 * WARNUNG: Sobald ein Worker laeuft, der ki_anbieter liest (jede Fassung nach 0.2.0),
 * diese Datei NICHT gegen die Produktionsdatenbank laufen lassen. Einige Tests aktivieren
 * ihren Test-Anbieter; der Worker schaltete dann fuer diese Zeit auf ihn um (eine
 * unerreichbare URL) — echte Bons scheiterten oder liefen in Wiederholungen.
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
async function testStand(id: string): Promise<string> {
	const [z] = await db.select({ s: sql<string>`${kiAnbieter.geaendertAm}::text` }).from(kiAnbieter).where(eq(kiAnbieter.id, id));
	return z.s;
}

describe.skipIf(AUS)('KI-Anbieter gegen die echte Datenbank', () => {
	async function mitAufraeumen(f: (angelegt: string[]) => Promise<void>) {
		const [vorher] = await db.select().from(instanz).where(eq(instanz.id, 1));
		const start = new Date();
		const angelegt: string[] = [];
		try {
			await f(angelegt);
		} finally {
			if (vorher) {
				await db.update(instanz).set({ aktiverKiAnbieter: vorher.aktiverKiAnbieter, kiStand: vorher.kiStand }).where(eq(instanz.id, 1));
			} else {
				await db.delete(instanz).where(eq(instanz.id, 1));
			}
			for (const id of angelegt) await db.delete(kiAnbieter).where(eq(kiAnbieter.id, id));
			await db.delete(betriebsprotokoll).where(eq(betriebsprotokoll.ziel, 'db-test-anbieter'));
			// zurueckAufEnv protokolliert mit ziel = '.env' — das faellt durch den Filter
			// oben. Ohne diese Zeile bliebe ein ki.zurueck_auf_env-Eintrag im echten
			// Betriebsprotokoll zurueck. Alle Testaufrufe uebergeben userId = null.
			await db
				.delete(betriebsprotokoll)
				.where(and(isNull(betriebsprotokoll.userId), gte(betriebsprotokoll.zeit, start)));
		}
	}

	it('aktiviert nur nach erfolgreichem Test, erhoeht den Stand und protokolliert', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen(basis, null as never, env);
			angelegt.push(id);
			await expect(ki.anbieterAktivieren(id, null as never, env)).rejects.toBeInstanceOf(ki.NichtGetestet);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(id));
			const vorher = (await ki.kiStandLesen()).stand;
			await ki.anbieterAktivieren(id, null as never, env);
			const nachher = await ki.kiStandLesen();
			expect(nachher).toEqual({ aktivId: id, stand: vorher + 1 });
			const eintraege = await db.select().from(betriebsprotokoll).where(eq(betriebsprotokoll.ziel, 'db-test-anbieter'));
			expect(eintraege.map((e) => e.aktion)).toEqual(expect.arrayContaining(['ki.angelegt', 'ki.getestet', 'ki.aktiviert']));
		});
	});

	it('setzt test_ok beim Bearbeiten zurueck und erhoeht den Stand, wenn der Anbieter aktiv ist', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen(basis, null as never, env);
			angelegt.push(id);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(id));
			await ki.anbieterAktivieren(id, null as never, env);
			const stand = (await ki.kiStandLesen()).stand;
			await ki.anbieterAendern(id, { ...basis, modell: 'qwen-neu' }, null as never, env);
			expect((await ki.kiStandLesen()).stand).toBe(stand + 1);
			const [z] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z).toMatchObject({ modell: 'qwen-neu', testOk: null });
		});
	});

	it('behaelt den Schluessel bei leerem Feld und entfernt ihn nur auf ausdruecklichen Wunsch', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-geheim-a3f9' }, null as never, env);
			angelegt.push(id);
			await ki.anbieterAendern(id, basis, null as never, env);
			let [z] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.schluesselEnde).toBe('a3f9');
			expect(z.schluesselEnc).not.toBeNull();
			await ki.anbieterAendern(id, { ...basis, schluesselEntfernen: true }, null as never, env);
			[z] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.schluesselEnc).toBeNull();
		});
	});

	it('gibt in der Liste weder den Chiffretext noch den Klartext heraus', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-geheim-a3f9' }, null as never, env);
			angelegt.push(id);
			const liste = await ki.anbieterListe(env);
			const text = JSON.stringify(liste);
			expect(text).not.toContain('sk-geheim');
			expect(text).not.toContain('schluesselEnc');
			expect(liste.find((k) => k.id === id)).toMatchObject({ hatSchluessel: true, schluesselEnde: 'a3f9', schluesselLesbar: true });
		});
	});

	it('zeigt einen mit anderem SECRETS_KEY gespeicherten Schluessel als nicht lesbar', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen({ ...basis, schluessel: 'sk-1234' }, null as never, env);
			angelegt.push(id);
			const anderer = { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;
			expect((await ki.anbieterListe(anderer)).find((k) => k.id === id)?.schluesselLesbar).toBe(false);
		});
	});

	it('verweigert das Loeschen des aktiven Anbieters', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen(basis, null as never, env);
			angelegt.push(id);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(id));
			await ki.anbieterAktivieren(id, null as never, env);
			await expect(ki.anbieterLoeschen(id, null as never)).rejects.toBeInstanceOf(ki.AnbieterAktiv);
			await ki.zurueckAufEnv(null as never);
			expect((await ki.kiStandLesen()).aktivId).toBeNull();
		});
	});

	it('verweigert einen Bildweg-Anbieter ohne Freigabe', async () => {
		await mitAufraeumen(async (angelegt) => {
			// Anlegen nur MIT Freigabe (siehe unten); aktiviert wird dann ohne.
			const id = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, FREI);
			angelegt.push(id);
			await ki.testErgebnisSpeichern(id, true, 'ok', null as never, await testStand(id));
			await expect(ki.anbieterAktivieren(id, null as never, env)).rejects.toThrow(/nicht freigegeben/);
		});
	});

	it('verwirft ein Testergebnis, wenn der Anbieter waehrend des Tests geaendert wurde', async () => {
		await mitAufraeumen(async (angelegt) => {
			const id = await ki.anbieterAnlegen(basis, null as never, env);
			angelegt.push(id);
			// Frisch angelegt: geaendert_am kommt aus now() und hat Mikrosekunden. Der
			// Vergleich muss sie halten, sonst schlüge JEDER Test eines neuen Anbieters fehl.
			const gemerkt = await testStand(id);
			expect(await ki.testErgebnisSpeichern(id, true, 'ok', null as never, gemerkt)).toBe(true);

			const vorDemTest = await testStand(id);
			await ki.anbieterAendern(id, { ...basis, modell: 'qwen-neu' }, null as never, env);
			expect(await ki.testErgebnisSpeichern(id, true, 'ok', null as never, vorDemTest)).toBe(false);
			const [z] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, id));
			expect(z.testOk).toBeNull();
			const eintraege = await db.select().from(betriebsprotokoll).where(eq(betriebsprotokoll.ziel, 'db-test-anbieter'));
			expect(eintraege.filter((e) => e.aktion === 'ki.getestet')).toHaveLength(1);
		});
	});

	it('legt einen Bildweg-Anbieter ohne Freigabe nicht an', async () => {
		await mitAufraeumen(async (angelegt) => {
			// Gelingt das Anlegen doch (der Fehler, den dieser Test sucht), wird die Zeile
			// trotzdem aufgeraeumt.
			const r = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, env).then(
				(id) => (angelegt.push(id), null),
				(e: unknown) => e
			);
			expect(r).toBeInstanceOf(BildwegNichtFreigegeben);
			expect(await db.select().from(kiAnbieter).where(eq(kiAnbieter.name, 'db-test-anbieter'))).toHaveLength(0);
		});
	});

	it('stellt ohne Freigabe nicht auf den Bildweg um, laesst einen Bildweg-Anbieter aber bearbeiten', async () => {
		await mitAufraeumen(async (angelegt) => {
			const text = await ki.anbieterAnlegen(basis, null as never, env);
			angelegt.push(text);
			await expect(ki.anbieterAendern(text, { ...basis, weg: 'bild' }, null as never, env)).rejects.toBeInstanceOf(
				BildwegNichtFreigegeben
			);
			const bild = await ki.anbieterAnlegen({ ...basis, weg: 'bild' }, null as never, FREI);
			angelegt.push(bild);
			await ki.anbieterAendern(bild, { ...basis, weg: 'bild', modell: 'qwen-neu' }, null as never, env);
			const [z] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, bild));
			expect(z).toMatchObject({ weg: 'bild', modell: 'qwen-neu' });
			const [t] = await db.select().from(kiAnbieter).where(eq(kiAnbieter.id, text));
			expect(t.weg).toBe('text');
		});
	});
});

/**
 * Cloud-Reserve (Entwurf 2026-10-01). JEDER Fall in einer zurueckgerollten Transaktion — anders
 * als die Faelle oben, die aufraeumen: der laufende Worker liest instanz.reserve_* bei jedem Bon,
 * und eine Test-Reserve, die auch nur kurz sichtbar waere, koennte einen echten Bon umleiten.
 */
const ROLLBACK = new Error('rollback');
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

describe.skipIf(AUS)('Cloud-Reserve auf der Betriebsseite gegen die echte Datenbank', () => {
	const MIT_ENV = { ...env, EXTRACTION_PROVIDER: 'ocr-text', EXTRACTION_BASE_URL: 'http://mac.invalid/v1', EXTRACTION_API_KEY: 'k', EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv;

	async function zurueckgerollt(f: (tx: Tx) => Promise<void>) {
		await expect(
			db.transaction(async (tx) => {
				// Ausgangslage in der Transaktion: kein aktiver Anbieter (die .env gilt), keine Reserve.
				const leer = { aktiverKiAnbieter: null, reserveKiAnbieter: null, reserveAktivSeit: null, reserveGrenzeGemeldet: null };
				await tx.insert(instanz).values({ id: 1, ...leer }).onConflictDoUpdate({ target: instanz.id, set: leer });
				await f(tx);
				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);
	}

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
		await zurueckgerollt(async (tx) => {
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
		await zurueckgerollt(async (tx) => {
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
		await zurueckgerollt(async (tx) => {
			const id = await karte(tx);
			await ki.reserveFestlegen(id, null as never, MIT_ENV, tx as never);
			expect(await fehler(ki.anbieterAktivieren(id, null as never, MIT_ENV, tx as never))).toBeInstanceOf(ki.AnbieterIstReserve);
			expect((await stand(tx)).aktiverKiAnbieter).toBeNull();
		});
	});

	it('entfernt die Reserve auch, waehrend sie liest', async () => {
		await zurueckgerollt(async (tx) => {
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
		await zurueckgerollt(async (tx) => {
			await tx.update(instanz).set({ reserveGrenzeGemeldet: '2031-10' }).where(eq(instanz.id, 1));
			await ki.reserveGrenzeSpeichern(12_000_000, null as never, tx as never);
			const s = await stand(tx);
			expect(s.reserveGrenzeMicro).toBe(12_000_000);
			expect(s.reserveGrenzeGemeldet).toBeNull();
		});
	});

	it('Bearbeiten der Reserve-Karte erhoeht ki_stand, damit der Worker den neuen Schluessel nimmt', async () => {
		await zurueckgerollt(async (tx) => {
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
		await zurueckgerollt(async (tx) => {
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
		await zurueckgerollt(async (tx) => {
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
});
