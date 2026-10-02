import { describe, it, expect, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
// Nie eine echte Matrix-Meldung aus einem Test.
const gemeldet = vi.hoisted(() => [] as string[]);
vi.mock('$lib/server/notify', () => ({ notifyMatrix: async (t: string) => void gemeldet.push(t) }));

import { db } from '$lib/server/db';
import { betriebsprotokoll, extractionRuns, householdMembers, instanz, kiAnbieter, receipts } from '$lib/server/db/schema';
import {
	echteUmschaltDeps,
	grenzeErreicht,
	grenzeMeldungFaellig,
	leseReserveZustand,
	reserveAktivieren,
	reserveZurueck,
	verbrauchImMonat,
	verbrauchSeit
} from './reserve';

/**
 * Gegen die LAUFENDE Datenbank, hinter RUN_DB_TESTS=1 — und JEDER Fall zurueckgerollt. Der
 * Worker liest `instanz` bei jedem Bon: eine Test-Reserve, die auch nur kurz sichtbar waere,
 * koennte einen echten Bon umleiten.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/ki/reserve.db.test.ts
 *
 * Die Laeufe fuer die Monatssumme liegen im Oktober 2031: echte Reserve-Laeufe aus der Zeit, in
 * der dieser Test laeuft, liegen davor und fallen aus der Summe.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const ROLLBACK = new Error('rollback');
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function zurueckgerollt(f: (tx: Tx) => Promise<void>) {
	await expect(
		db.transaction(async (tx) => {
			await f(tx);
			throw ROLLBACK;
		})
	).rejects.toBe(ROLLBACK);
}

/** Eine Reserve-Karte und die instanz-Zeile, die auf sie zeigt — nur in der Transaktion. */
async function mitReserve(tx: Tx, reserve: boolean): Promise<string> {
	const [k] = await tx
		.insert(kiAnbieter)
		.values({ name: 'db-test-reserve', weg: 'text', baseUrl: 'http://reserve.invalid/v1', modell: 'test', zeitlimitMs: 60_000 })
		.returning({ id: kiAnbieter.id });
	const werte = { reserveKiAnbieter: reserve ? k.id : null, reserveAktivSeit: null, reserveGrenzeGemeldet: null };
	await tx.insert(instanz).values({ id: 1, ...werte }).onConflictDoUpdate({ target: instanz.id, set: werte });
	return k.id;
}

async function protokollZahl(tx: Tx, aktion: string, merkmal: string): Promise<number> {
	const [z] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(betriebsprotokoll)
		.where(and(eq(betriebsprotokoll.aktion, aktion), sql`${betriebsprotokoll.details}::text like ${'%' + merkmal + '%'}`));
	return z.n;
}

describe.skipIf(AUS)('Cloud-Reserve gegen die echte Datenbank', () => {
	it('schaltet ohne eingerichtete Reserve nicht um', async () => {
		await zurueckgerollt(async (tx) => {
			await mitReserve(tx, false);
			expect(await reserveAktivieren(tx as never, 'db-test-ohne')).toBe(false);
			expect((await leseReserveZustand(tx as never)).aktivSeit).toBeNull();
		});
	});

	it('schaltet genau einmal um und protokolliert genau einmal', async () => {
		await zurueckgerollt(async (tx) => {
			await mitReserve(tx, true);
			expect(await reserveAktivieren(tx as never, 'db-test-einmal')).toBe(true);
			expect(await reserveAktivieren(tx as never, 'db-test-einmal')).toBe(false);
			expect((await leseReserveZustand(tx as never)).aktivSeit).toBeInstanceOf(Date);
			expect(await protokollZahl(tx, 'ki.reserve_aktiv', 'db-test-einmal')).toBe(1);
		});
	});

	it('schaltet zurueck, und ein zweites Zurueck findet nichts mehr', async () => {
		await zurueckgerollt(async (tx) => {
			await mitReserve(tx, true);
			expect(await reserveZurueck(tx as never, 'db-test-zurueck')).toBeNull();
			await reserveAktivieren(tx as never, 'db-test-zurueck');
			const r = await reserveZurueck(tx as never, 'db-test-zurueck');
			expect(r?.seit).toBeInstanceOf(Date);
			expect((await leseReserveZustand(tx as never)).aktivSeit).toBeNull();
			expect(await reserveZurueck(tx as never, 'db-test-zurueck')).toBeNull();
			expect(await protokollZahl(tx, 'ki.reserve_zurueck', 'db-test-zurueck')).toBe(1);
		});
	});

	it('meldet die Grenze hoechstens einmal je Monat', async () => {
		await zurueckgerollt(async (tx) => {
			await mitReserve(tx, true);
			expect(await grenzeMeldungFaellig(tx as never, '2031-10')).toBe(true);
			expect(await grenzeMeldungFaellig(tx as never, '2031-10')).toBe(false);
			expect(await grenzeMeldungFaellig(tx as never, '2031-11')).toBe(true);
		});
	});

	it('zaehlt nur Reserve-Laeufe des Kalendermonats in Berliner Zeit, beide Kostenspalten', async () => {
		const [m] = await db
			.select({ userId: householdMembers.userId, householdId: householdMembers.householdId })
			.from(householdMembers)
			.limit(1);
		if (!m) return;
		await zurueckgerollt(async (tx) => {
			const reserveId = await mitReserve(tx, true);
			const [bon] = await tx
				.insert(receipts)
				.values({ householdId: m.householdId, uploadedBy: m.userId, imagePath: 'test/r.webp', thumbPath: 'test/r.thumb.webp', status: 'review' })
				.returning({ id: receipts.id });
			const lauf = (createdAt: string, kiRolle: 'haupt' | 'reserve', cost: number | null, kat: number | null) => ({
				receiptId: bon.id,
				provider: 'ocr-text',
				model: 'test',
				kiAnbieterId: kiRolle === 'reserve' ? reserveId : null,
				kiRolle,
				costMicroEuros: cost,
				kategorienKostenMicro: kat,
				createdAt: new Date(createdAt)
			});
			await tx.insert(extractionRuns).values([
				lauf('2031-10-01T05:00:00Z', 'reserve', 10_000, 2_000), // zaehlt
				lauf('2031-10-02T05:00:00Z', 'haupt', 99_000, 99_000), // Hauptanbieter: zaehlt nicht
				lauf('2031-09-30T21:30:00Z', 'reserve', 50_000, null), // 30.09. 23:30 Berlin: September
				lauf('2031-09-30T22:10:00Z', 'reserve', 5_000, null), // 01.10. 00:10 Berlin: zaehlt
				lauf('2031-10-03T05:00:00Z', 'reserve', null, null) // Kosten unbekannt: 0 €, aber ein Lauf
			]);
			const jetzt = new Date('2031-10-15T12:00:00Z');
			expect(await verbrauchImMonat(tx as never, jetzt)).toEqual({ kostenMicro: 17_000, laeufe: 3 });
			expect(await verbrauchSeit(tx as never, new Date('2031-10-02T00:00:00Z'))).toEqual({ kostenMicro: 0, laeufe: 1 });

			await tx.update(instanz).set({ reserveGrenzeMicro: 17_000 }).where(eq(instanz.id, 1));
			expect(await grenzeErreicht(tx as never, jetzt)).toBe(true);
			await tx.update(instanz).set({ reserveGrenzeMicro: 17_001 }).where(eq(instanz.id, 1));
			expect(await grenzeErreicht(tx as never, jetzt)).toBe(false);
		});
	});

	// Abschlusspruefung 02.10.: wurde die Reserve entfernt oder eine andere Karte festgelegt,
	// waehrend ein Mac-Aufruf hing, darf der Text nicht mehr an die alte Karte gehen.
	it('schaltet nur fuer die Karte um, die gerade Reserve ist', async () => {
		await zurueckgerollt(async (tx) => {
			await mitReserve(tx, true);
			expect(await reserveAktivieren(tx as never, 'db-test-fremd', '00000000-0000-0000-0000-000000000000')).toBe(false);
			expect((await leseReserveZustand(tx as never)).aktivSeit).toBeNull();
		});
	});

	it('echteUmschaltDeps gibt die Reserve nur frei, solange sie es ist — und meldet einmal', async () => {
		await zurueckgerollt(async (tx) => {
			gemeldet.length = 0;
			const id = await mitReserve(tx, true);
			const a = echteUmschaltDeps({ kiAnbieterId: id, name: 'db-test-reserve' }, tx as never);
			const b = echteUmschaltDeps({ kiAnbieterId: id, name: 'db-test-reserve' }, tx as never);
			expect(await a.reserveAktivSeit()).toBeNull();
			expect(await a.umschalten('Zeitüberschreitung')).toBe(true);
			// Ein zweiter Auftrag fand den Zustand schon aktiv: darf lesen, meldet aber nicht.
			expect(await b.umschalten('Zeitüberschreitung')).toBe(true);
			expect(gemeldet).toHaveLength(1);
			expect(await a.reserveAktivSeit()).toBeInstanceOf(Date);

			// Eine andere Karte ist nicht diese Reserve.
			const fremd = echteUmschaltDeps({ kiAnbieterId: '00000000-0000-0000-0000-000000000000', name: 'alt' }, tx as never);
			expect(await fremd.reserveAktivSeit()).toBeNull();
			expect(await fremd.umschalten('Zeitüberschreitung')).toBe(false);

			// Entfernt: niemand darf mehr an sie.
			await tx.update(instanz).set({ reserveKiAnbieter: null, reserveAktivSeit: null }).where(eq(instanz.id, 1));
			expect(await a.reserveAktivSeit()).toBeNull();
			expect(await a.umschalten('Zeitüberschreitung')).toBe(false);
			expect(gemeldet).toHaveLength(1);
		});
	});
});
