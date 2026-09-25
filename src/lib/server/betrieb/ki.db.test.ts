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
