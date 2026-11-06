import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { receipts, receiptItems, extractionRuns, users, householdMembers } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';

/**
 * „Nur das Bild uebernehmen" (Doppel vergleichen, 0.12.0) gegen die Test-Datenbank,
 * zurueckgerollt. Lesen, Speichern und Loeschen der Bilder sind Attrappen — auch das Loeschen
 * beim endgueltigen Leeren des Papierkorbs (`loescheBilder` gemockt): kein Test fasst
 * ./data/receipts an.
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/bons/bild-uebernehmen.db.test.ts
 */
const loescheBilder = vi.hoisted(() => vi.fn(async (_p: string[]) => {}));
vi.mock('$lib/server/storage/images', async (original) => ({
	...(await original<typeof import('$lib/server/storage/images')>()),
	loescheBilder
}));

const { bildUebernehmen } = await import('./bild');
const { bonsEndgueltigLoeschen } = await import('./papierkorb');

const AUS = process.env.RUN_DB_TESTS !== '1';
const NEU = { imagePath: '2026/11/neu.webp', thumbPath: '2026/11/neu.thumb.webp', width: 800 };
const ZEILEN = [
	{ text: 'Testmarkt Musterstadt', box: [0, 0, 100, 10] as [number, number, number, number], confidence: 90 },
	{ text: 'Testware 1,99 A', box: [0, 20, 100, 10] as [number, number, number, number], confidence: 88 }
];

function attrappen(extra: { speichern?: () => Promise<typeof NEU> } = {}) {
	return {
		lesen: vi.fn(async (_pfad: string) => Buffer.from('bild')),
		speichern: vi.fn(extra.speichern ?? (async () => NEU)),
		loeschen: vi.fn(async (_p: string[]) => {})
	};
}

type Neu = Partial<typeof receipts.$inferInsert>;

async function bonAnlegen(tx: Tx, haushaltId: string, nutzerId: string, werte: Neu = {}) {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId: haushaltId,
			uploadedBy: nutzerId,
			imagePath: `test/uebernehmen-${randomUUID()}.webp`,
			thumbPath: `test/uebernehmen-${randomUUID()}.thumb.webp`,
			status: 'review',
			sichtbarkeit: 'geteilt',
			...werte
		})
		.returning();
	return b;
}

const lade = async (tx: Tx, id: string) => (await tx.select().from(receipts).where(eq(receipts.id, id)))[0];
const juengsterLauf = async (tx: Tx, id: string) =>
	(await tx.select().from(extractionRuns).where(eq(extractionRuns.receiptId, id)).orderBy(desc(extractionRuns.createdAt)).limit(1))[0];

const KAUF = new Date('2026-09-21T19:00:00Z');

/** Bestaetigtes Ziel mit einer Position und einem alten Leselauf; Quelle neu fotografiert. */
async function paar(tx: Tx, k: { haushaltId: string; nutzerId: string }, ziel: Neu = {}) {
	const z = await bonAnlegen(tx, k.haushaltId, k.nutzerId, {
		status: 'confirmed',
		confirmedAt: new Date(),
		totalGrossCents: 199,
		purchasedAt: KAUF,
		...ziel
	});
	await tx.insert(receiptItems).values({ receiptId: z.id, lineNo: 1, rawText: 'Testware', totalPriceCents: 199, ocrZeile: 7, corrected: true });
	await tx.insert(extractionRuns).values({
		receiptId: z.id,
		provider: 'ocr-text',
		model: 'alt',
		ocrZeilen: [{ text: 'altes Bild', box: [0, 0, 1, 1], confidence: 50 }],
		createdAt: new Date('2026-09-21T19:05:00Z')
	});
	const q = await bonAnlegen(tx, k.haushaltId, k.nutzerId, { status: 'review', totalGrossCents: 199, purchasedAt: KAUF });
	return { z, q };
}

beforeEach(() => loescheBilder.mockClear());

describe.skipIf(AUS)('Doppel vergleichen: nur das Bild uebernehmen', () => {
	it('uebernimmt das Bild auf einen bestaetigten Bon', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toEqual({ ok: true });

			const ziel = await lade(tx, z.id);
			expect([ziel.imagePath, ziel.thumbPath]).toEqual([NEU.imagePath, NEU.thumbPath]);
			expect([ziel.originalImagePath, ziel.originalThumbPath]).toEqual([z.imagePath, z.thumbPath]);
			expect([ziel.status, ziel.totalGrossCents, ziel.purchasedAt?.toISOString()]).toEqual(['confirmed', 199, KAUF.toISOString()]);
			const pos = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, z.id));
			expect(pos.map((p) => [p.rawText, p.totalPriceCents, p.corrected])).toEqual([['Testware', 199, true]]);

			const quelle = await lade(tx, q.id);
			expect(quelle.status).toBe('verworfen');
			expect(quelle.statusVorVerwerfen).toBe('review');
			expect(deps.lesen).toHaveBeenCalledWith(q.imagePath);
			// Erstes Mal: das alte Bild ist jetzt das Original, geloescht wird nichts.
			expect(deps.loeschen).not.toHaveBeenCalled();
		});
	});

	it('eigene Dateien: Papierkorb leeren loescht kein Bild des Ziels', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, attrappen())).toEqual({ ok: true });
			const ziel = await lade(tx, z.id);
			expect([ziel.imagePath, ziel.thumbPath]).not.toContain(q.imagePath);
			expect([ziel.imagePath, ziel.thumbPath]).not.toContain(q.thumbPath);

			expect(await bonsEndgueltigLoeschen(tx as never, [q.id])).toBe(1);
			const geloescht = loescheBilder.mock.calls.flatMap((c) => c[0]);
			expect(geloescht).toEqual([q.imagePath, q.thumbPath]);
			for (const p of [ziel.imagePath, ziel.thumbPath, ziel.originalImagePath, ziel.originalThumbPath]) {
				expect(geloescht).not.toContain(p);
			}
		});
	});

	it('zeilen werden uebernommen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			await tx.insert(extractionRuns).values([
				{ receiptId: q.id, provider: 'ocr-text', model: 'aelter', ocrZeilen: [], createdAt: new Date('2026-11-06T07:00:00Z') },
				{
					receiptId: q.id,
					provider: 'ocr-text',
					model: 'juenger',
					kiRolle: 'haupt',
					ocrZeilen: ZEILEN,
					ocrText: 'Testmarkt Musterstadt\nTestware 1,99 A',
					ocrEngine: 'paddleocr',
					createdAt: new Date('2026-11-06T08:00:00Z')
				}
			]);
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, attrappen())).toEqual({ ok: true });
			const lauf = await juengsterLauf(tx, z.id);
			expect([lauf.provider, lauf.model, lauf.kiRolle]).toEqual(['bild-uebernommen', 'bild-uebernommen', null]);
			expect(lauf.ocrZeilen).toEqual(ZEILEN);
			expect([lauf.ocrText, lauf.ocrEngine]).toEqual(['Testmarkt Musterstadt\nTestware 1,99 A', 'paddleocr']);
			// Die Position zeigt auf ihre Zeile im NEUEN Bild, nicht mehr auf Zeile 7 des alten.
			const [pos] = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, z.id));
			expect(pos.ocrZeile).toBe(1);
		});
	});

	it('ohne Leselauf der Quelle: neuer Lauf ohne Zeilen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, attrappen())).toEqual({ ok: true });
			const lauf = await juengsterLauf(tx, z.id);
			expect(lauf.provider).toBe('bild-uebernommen');
			expect(lauf.ocrZeilen).toBeNull();
			const [pos] = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, z.id));
			expect(pos.ocrZeile).toBeNull();
		});
	});

	it('zweite Bearbeitung: erstes Original bleibt, Zwischenfassung wird geloescht', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k, { originalImagePath: 'test/erstes.webp', originalThumbPath: 'test/erstes.thumb.webp' });
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toEqual({ ok: true });
			const ziel = await lade(tx, z.id);
			expect([ziel.imagePath, ziel.originalImagePath, ziel.originalThumbPath]).toEqual([NEU.imagePath, 'test/erstes.webp', 'test/erstes.thumb.webp']);
			expect(deps.loeschen).toHaveBeenCalledWith([z.imagePath, z.thumbPath]);
		});
	});

	// Abschlusspruefung, Wichtig 1: die Quelle wurde in einem anderen Tab bestaetigt.
	it('Quelle inzwischen bestaetigt: 409, nichts gespeichert', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			await tx.update(receipts).set({ status: 'confirmed', confirmedAt: new Date() }).where(eq(receipts.id, q.id));
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps, { [z.id]: 'confirmed', [q.id]: 'review' })).toEqual({
				ok: false,
				status: 409,
				meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.'
			});
			expect(deps.speichern).not.toHaveBeenCalled();
			expect((await lade(tx, q.id)).status).toBe('confirmed');
		});
	});

	it('Ziel nicht bestaetigt: abgelehnt, nichts gespeichert', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k, { status: 'review', confirmedAt: null });
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Das Bild lässt sich nur auf einen bestätigten Bon übernehmen.'
			});
			expect(deps.speichern).not.toHaveBeenCalled();
			expect((await lade(tx, q.id)).status).toBe('review');
		});
	});

	it('liest die Quelle noch: abgelehnt', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			await tx.update(receipts).set({ status: 'extracting' }).where(eq(receipts.id, q.id));
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Einer der beiden Bons wird noch gelesen.'
			});
			expect(deps.speichern).not.toHaveBeenCalled();
		});
	});

	it('Mitglied darf fremde Quelle nicht verwerfen', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx, { rolle: 'mitglied' });
			const { z } = await paar(tx, k);
			// Quelle im selben Haushalt, geteilt, aber von einem anderen Menschen hochgeladen.
			const [u] = await tx
				.insert(users)
				.values({ oidcSub: `test-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, displayName: 'Erika' })
				.returning({ id: users.id });
			await tx.insert(householdMembers).values({ householdId: k.haushaltId, userId: u.id, rolle: 'mitglied' });
			const q = await bonAnlegen(tx, k.haushaltId, u.id);
			const deps = attrappen();
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toMatchObject({ ok: false, status: 403 });
			expect(deps.speichern).not.toHaveBeenCalled();
		});
	});

	it('GEAENDERT raeumt Dateien weg', async () => {
		await zurueckgerollt(async (tx) => {
			const { k } = await testHaushalt(tx);
			const { z, q } = await paar(tx, k);
			const deps = attrappen({
				// Waehrend des Speicherns hat ein anderer Tab das Ziel wieder in die Pruefung geholt.
				speichern: async () => {
					await tx.update(receipts).set({ status: 'review' }).where(eq(receipts.id, z.id));
					return NEU;
				}
			});
			expect(await bildUebernehmen(tx as never, k, z.id, q.id, deps)).toEqual({
				ok: false,
				status: 409,
				meldung: 'Der Bon hat sich gerade geändert. Bitte die Seite neu laden.'
			});
			expect(deps.loeschen).toHaveBeenCalledWith([NEU.imagePath, NEU.thumbPath]);
			const ziel = await lade(tx, z.id);
			expect([ziel.imagePath, ziel.originalImagePath]).toEqual([z.imagePath, null]);
			expect((await lade(tx, q.id)).status).toBe('review');
			expect((await juengsterLauf(tx, z.id)).model).toBe('alt');
		});
	});
});
