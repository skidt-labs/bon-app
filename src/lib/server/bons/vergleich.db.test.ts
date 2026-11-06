import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { receipts, receiptItems, users, householdMembers } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import { DOPPEL_GRUND } from '$lib/bons/beanstandungen';
import { behalten, vergleichLaden, vergleichBon, vorschlaege } from './vergleich';

/**
 * Doppel vergleichen (0.12.0) gegen die Test-Datenbank, zurueckgerollt:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/vergleich.db.test.ts
 *
 * Nur Schein-Bildpfade; der Papierkorb-Weg loescht keine Datei.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';
const GEAENDERT = 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.';

type Neu = Partial<typeof receipts.$inferInsert>;

async function bonAnlegen(tx: Tx, haushaltId: string, nutzerId: string, werte: Neu = {}): Promise<string> {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId: haushaltId,
			uploadedBy: nutzerId,
			imagePath: `test/vergleich-${randomUUID()}.webp`,
			thumbPath: `test/vergleich-${randomUUID()}.thumb.webp`,
			status: 'review',
			sichtbarkeit: 'geteilt',
			...werte
		})
		.returning({ id: receipts.id });
	return b.id;
}

async function zweitesMitglied(tx: Tx, haushaltId: string): Promise<string> {
	const [u] = await tx
		.insert(users)
		.values({ oidcSub: `test-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, displayName: 'Zweite Person' })
		.returning({ id: users.id });
	await tx.insert(householdMembers).values({ householdId: haushaltId, userId: u.id, rolle: 'mitglied' });
	return u.id;
}

const lade = async (tx: Tx, id: string) => (await tx.select().from(receipts).where(eq(receipts.id, id)))[0];

describe.skipIf(AUS)('Doppel vergleichen: behalten', () => {
	it('behaelt einen Bon und legt den anderen in den Papierkorb', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'failed' });
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			expect(await behalten(tx as never, k, b, a)).toEqual({ ok: true });
			const weg = await lade(tx, a);
			expect(weg.status).toBe('verworfen');
			expect(weg.statusVorVerwerfen).toBe('failed');
			expect(weg.verworfenVon).toBe(k.nutzerId);
			expect((await lade(tx, b)).status).toBe('review');
		});
	});

	it('behaelt einen als doppelt markierten Bon', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'confirmed', confirmedAt: new Date() });
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId, {
				status: 'doppelt',
				vermutetesOriginalId: a,
				needsReviewReason: ['sum_mismatch', DOPPEL_GRUND]
			});
			expect(await behalten(tx as never, k, b, a)).toEqual({ ok: true });
			const bleibt = await lade(tx, b);
			expect(bleibt.status).toBe('review');
			expect(bleibt.vermutetesOriginalId).toBeNull();
			expect(bleibt.needsReviewReason).toEqual(['sum_mismatch']);
			expect((await lade(tx, a)).status).toBe('verworfen');
		});
	});

	it('nimmt einen bestaetigten anderen ohne eigene Rueckfrage', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'confirmed', confirmedAt: new Date() });
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			expect(await behalten(tx as never, k, b, a)).toEqual({ ok: true });
			const weg = await lade(tx, a);
			expect(weg.status).toBe('verworfen');
			expect(weg.statusVorVerwerfen).toBe('confirmed');
		});
	});

	it('lehnt ab: derselbe Bon / liest noch / schon im Papierkorb', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			const liest = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'extracting' });
			const korb = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'verworfen', statusVorVerwerfen: 'review' });
			expect(await behalten(tx as never, k, a, a)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Ein Bon lässt sich nicht mit sich selbst vergleichen.'
			});
			expect(await behalten(tx as never, k, a, liest)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Einer der beiden Bons wird noch gelesen.'
			});
			expect(await behalten(tx as never, k, liest, a)).toMatchObject({ status: 409, meldung: 'Einer der beiden Bons wird noch gelesen.' });
			expect(await behalten(tx as never, k, a, korb)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Einer der beiden Bons liegt schon im Papierkorb.'
			});
			expect((await lade(tx, a)).status).toBe('review');
			expect((await lade(tx, liest)).status).toBe('extracting');
		});
	});

	it('Mitglied darf fremden nicht verwerfen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
			const andere = await zweitesMitglied(tx, k.haushaltId);
			const eigen = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			const fremd = await bonAnlegen(tx, k.haushaltId, andere);
			expect(await behalten(tx as never, k, eigen, fremd)).toEqual({
				ok: false,
				status: 403,
				meldung: 'Das darf nur, wer den Bon hochgeladen hat, oder der Verwalter.'
			});
			expect((await lade(tx, fremd)).status).toBe('review');
		});
	});

	it('privat unsichtbar', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const andere = await zweitesMitglied(tx, k.haushaltId);
			const eigen = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 3146 });
			const privat = await bonAnlegen(tx, k.haushaltId, andere, { sichtbarkeit: 'privat', totalGrossCents: 3146 });
			expect(await behalten(tx as never, k, eigen, privat)).toEqual({ ok: false, status: 404, meldung: 'Bon nicht gefunden' });
			const v = await vorschlaege(tx as never, k, eigen);
			expect(v.map((x) => x.id)).not.toContain(privat);
		});
	});

	it('geaendert: scheitert der Papierkorb, bleibt alles wie vorher', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'confirmed', confirmedAt: new Date() });
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId, {
				status: 'doppelt',
				vermutetesOriginalId: a,
				needsReviewReason: [DOPPEL_GRUND]
			});
			const r = await behalten(tx as never, k, b, a, {
				papierkorb: async () => ({ ok: false, status: 409, meldung: GEAENDERT })
			});
			expect(r).toEqual({ ok: false, status: 409, meldung: GEAENDERT });
			const bleibt = await lade(tx, b);
			expect(bleibt.status).toBe('doppelt');
			expect(bleibt.vermutetesOriginalId).toBe(a);
			expect(bleibt.needsReviewReason).toEqual([DOPPEL_GRUND]);
			expect((await lade(tx, a)).status).toBe('confirmed');
		});
	});
});

describe.skipIf(AUS)('Doppel vergleichen: inzwischen geaendert (Abschlusspruefung, Wichtig 1)', () => {
	it('anderer inzwischen bestaetigt: 409, nichts geaendert', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			// Die Seite sah beide „in Pruefung"; in einem anderen Tab wurde a inzwischen bestaetigt.
			await tx.update(receipts).set({ status: 'confirmed', confirmedAt: new Date() }).where(eq(receipts.id, a));
			const r = await behalten(tx as never, k, b, a, { erwartet: { [a]: 'review', [b]: 'review' } });
			expect(r).toEqual({ ok: false, status: 409, meldung: GEAENDERT });
			expect((await lade(tx, a)).status).toBe('confirmed');
		});
	});

	it('Erwartung stimmt: wie ohne', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const a = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			const b = await bonAnlegen(tx, k.haushaltId, k.nutzerId);
			expect(await behalten(tx as never, k, b, a, { erwartet: { [a]: 'review', [b]: 'review' } })).toEqual({ ok: true });
			expect((await lade(tx, a)).status).toBe('verworfen');
		});
	});
});

describe.skipIf(AUS)('Doppel vergleichen: Vorschlaege', () => {
	it('vorschlaege sortiert: gleiche Summe, dann Zeitabstand, ohne sich selbst und Papierkorb', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const zeit = new Date('2026-09-21T19:00:00Z');
			const x = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 3146, purchasedAt: zeit });
			const dreiTage = await bonAnlegen(tx, k.haushaltId, k.nutzerId, {
				totalGrossCents: 3146,
				purchasedAt: new Date(zeit.getTime() + 3 * 86_400_000)
			});
			const andereSumme = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 999, purchasedAt: zeit });
			const eineStunde = await bonAnlegen(tx, k.haushaltId, k.nutzerId, {
				totalGrossCents: 3146,
				purchasedAt: new Date(zeit.getTime() + 3_600_000)
			});
			const korb = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 3146, purchasedAt: zeit, status: 'verworfen' });
			const ids = (await vorschlaege(tx as never, k, x)).map((v) => v.id);
			expect(ids).toEqual([eineStunde, dreiTage, andereSumme]);
			expect(ids).not.toContain(x);
			expect(ids).not.toContain(korb);
		});
	});

	it('vorschlaege hoechstens 20', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const x = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 100 });
			for (let i = 0; i < 22; i++) await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 200 + i });
			expect(await vorschlaege(tx as never, k, x)).toHaveLength(20);
		});
	});

	it('vorschlaege suche', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const x = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 100 });
			const summe = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 3146, merchantNameRaw: 'Bäckerei Beispiel' });
			const laden = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 500, merchantNameRaw: 'Testmarkt Musterstadt' });
			expect((await vorschlaege(tx as never, k, x, '31,46')).map((v) => v.id)).toEqual([summe]);
			expect((await vorschlaege(tx as never, k, x, 'muster')).map((v) => v.id)).toEqual([laden]);
		});
	});

	it('vergleichBon: Positionen, wer hochgeladen hat, darf verwerfen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
			const andere = await zweitesMitglied(tx, k.haushaltId);
			const eigen = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { totalGrossCents: 3146 });
			const fremd = await bonAnlegen(tx, k.haushaltId, andere);
			await tx.insert(receiptItems).values([
				{ receiptId: eigen, lineNo: 1, rawText: 'Brot', totalPriceCents: 300 },
				{ receiptId: eigen, lineNo: 2, rawText: 'Milch', totalPriceCents: 119 }
			]);
			const g = await vergleichLaden(tx as never, k, eigen, fremd);
			if (!g.ok) throw new Error('nicht geladen');
			const a = await vergleichBon(tx as never, k, g.a);
			const b = await vergleichBon(tx as never, k, g.b);
			expect([a.id, a.anzahlPositionen, a.hochgeladenVon, a.darfVerwerfen, a.totalGrossCents]).toEqual([eigen, 2, 'Testperson', true, 3146]);
			expect([b.anzahlPositionen, b.hochgeladenVon, b.darfVerwerfen]).toEqual([0, 'Zweite Person', false]);
		});
	});
});
