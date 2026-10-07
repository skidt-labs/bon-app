import { describe, it, expect } from 'vitest';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { merchants, receipts, receiptItems } from '$lib/server/db/schema';
import { testHaushalt, zurueckgerollt, type Tx } from '$lib/server/db/testdaten';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { korrekturenSchema, korrekturenAnwenden, KorrekturVerfehlt } from './korrekturen';

/**
 * Live-Waechter gegen die Test-Datenbank — hinter RUN_DB_TESTS=1, nicht Teil der
 * normalen Suite:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/receipts/korrekturen.db.test.ts
 *
 * Schreibt in einer Transaktion und wirft am Ende, damit Postgres alles zuruecknimmt —
 * der Bestand bleibt unveraendert. Prueft genau das, was kein Einheitstest kann: dass
 * Umnummerieren mit Tausch, Einfuegen in der Mitte, Loeschen und Bezug die beiden
 * Regeln der Datenbank ueberlebt — UNIQUE (receipt_id, line_no), nicht aufschiebbar,
 * und den Self-FK (receipt_id, applies_to_line). Und dass der Haendler-Upsert in
 * derselben Transaktion laeuft: nach dem Rollback darf kein neuer Haendler da sein.
 */
const AUS = process.env.RUN_DB_TESTS !== '1';

/** Ein Bon in Pruefung mit vier Zeilen — nur in der Transaktion. */
async function bonMitZeilen(tx: Tx, k: Zugriffskontext) {
	const [b] = await tx
		.insert(receipts)
		.values({ householdId: k.haushaltId, uploadedBy: k.nutzerId, imagePath: 'test/korrektur.webp', thumbPath: 'test/korrektur.thumb.webp', status: 'review' })
		.returning({ id: receipts.id });
	await tx.insert(receiptItems).values(
		['BUTTER', 'MILCH', 'KAESE', 'BROT'].map((rawText, i) => ({ receiptId: b.id, lineNo: i + 1, rawText, totalPriceCents: 100 + i }))
	);
	const [kopf] = await tx.select().from(receipts).where(eq(receipts.id, b.id));
	const zeilen = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, b.id)).orderBy(asc(receiptItems.lineNo));
	return { id: b.id, kopf, zeilen };
}

describe.skipIf(AUS)('korrekturenAnwenden gegen die echte Datenbank', () => {
	it('tauscht, fuegt ein, loescht und setzt einen Bezug, ohne UNIQUE oder Self-FK zu verletzen', async () => {
		const [{ n: haendlerVorher }] = await db.select({ n: count() }).from(merchants);
		let bonId = '';
		await zurueckgerollt(async (tx) => {
			const ich = await testHaushalt(tx);
			const { id, kopf: kopfVorher, zeilen: vorher } = await bonMitZeilen(tx, ich.k);
			bonId = id;

			// Zeile 1 und 2 tauschen (die alte 1 bezieht sich dann auf die neue 1), an Stelle 3
			// eine neue Zeile, alle weiteren rutschen um eins, die letzte wird geloescht.
			const letzte = vorher[vorher.length - 1];
			const bleibend = vorher.slice(0, -1);
			const k = korrekturenSchema.parse({
				receipt: { merchantNameRaw: 'Wächter-Testlauf', purchasedAt: null, totalGrossCents: 100, paymentMethod: null },
				items: [
					...bleibend.map((z, idx) => ({
						id: z.id,
						lineNo: idx === 0 ? 2 : idx === 1 ? 1 : idx + 2,
						rawText: z.rawText,
						lineType: z.lineType,
						quantity: z.quantity,
						unit: z.unit,
						unitPriceCents: z.unitPriceCents,
						totalPriceCents: z.totalPriceCents,
						vatClass: z.vatClass,
						appliesToLine: idx === 0 ? 1 : null,
						categoryId: z.categoryId
					})),
					{
						id: null,
						lineNo: 3,
						rawText: 'NACHGETRAGEN',
						lineType: 'article',
						quantity: null,
						unit: null,
						unitPriceCents: null,
						totalPriceCents: 99,
						vatClass: null,
						appliesToLine: null,
						categoryId: null
					}
				],
				geloescht: [letzte.id]
			});

			await korrekturenAnwenden(tx, id, k, { bestaetigen: true, userId: ich.nutzerId, ausStatus: kopfVorher.status });

			const nachher = await tx
				.select()
				.from(receiptItems)
				.where(eq(receiptItems.receiptId, id))
				.orderBy(asc(receiptItems.lineNo));
			expect(nachher.map((z) => z.lineNo)).toEqual(nachher.map((_, i) => i + 1));
			expect(nachher).toHaveLength(vorher.length); // eine weg, eine neu
			expect(nachher[1].id).toBe(vorher[0].id);
			expect(nachher[1].appliesToLine).toBe(1);
			expect(nachher[0].id).toBe(vorher[1].id);
			expect(nachher[2].rawText).toBe('NACHGETRAGEN');
			expect(vorher.some((z) => z.id === nachher[2].id)).toBe(false);
			expect(nachher.some((z) => z.id === letzte.id)).toBe(false);
			// Jede gebliebene Zeile hat eine andere Nummer als vorher — alle korrigiert.
			expect(nachher.every((z) => z.corrected)).toBe(true);

			const [kopf] = await tx.select().from(receipts).where(eq(receipts.id, id));
			expect(kopf.status).toBe('confirmed');
			expect(kopf.confirmedBy).toBe(ich.nutzerId);
			expect(kopf.merchantNameRaw).toBe('Wächter-Testlauf');
			expect(kopf.merchantId).not.toBeNull();
		});
		// Nach dem Rollback ist der ganze Bon weg — und kein neuer Haendler da: der Upsert lief in derselben Transaktion.
		expect(await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, bonId))).toHaveLength(0);
		const [{ n: haendlerDanach }] = await db.select({ n: count() }).from(merchants);
		expect(haendlerDanach).toBe(haendlerVorher);
	});

	it('haelt die Entscheidung "privat behalten" ueber das Zwischenspeichern (R22)', async () => {
		/*
		 * `sichtbarkeit` sagt, was JETZT gilt — bei einem ungeprueften Bon immer 'privat'.
		 * Der VORSATZ fuer das spaetere Bestaetigen braucht darum eine eigene Spalte.
		 * Ohne sie war die Entscheidung nach einem Klick auf „Spaeter" weg, der Schalter
		 * stand beim Wiederoeffnen wieder aus, und das naechste Bestaetigen teilte den Bon.
		 */
		await zurueckgerollt(async (tx) => {
			const ich = await testHaushalt(tx);
			const { id, kopf: bon, zeilen: vorher } = await bonMitZeilen(tx, ich.k);

			const rumpf = (privatBehalten: boolean) =>
				korrekturenSchema.parse({
					receipt: {
						merchantNameRaw: null,
						purchasedAt: null,
						totalGrossCents: null,
						paymentMethod: null,
						privatBehalten
					},
					items: vorher.map((z) => ({
						id: z.id,
						lineNo: z.lineNo,
						rawText: z.rawText,
						lineType: z.lineType,
						quantity: z.quantity,
						unit: z.unit,
						unitPriceCents: z.unitPriceCents,
						totalPriceCents: z.totalPriceCents,
						vatClass: z.vatClass,
						appliesToLine: z.appliesToLine,
						categoryId: z.categoryId
					})),
					geloescht: []
				});

			// „Spaeter": speichern OHNE zu bestaetigen.
			await korrekturenAnwenden(tx, id, rumpf(true), {
				bestaetigen: false,
				userId: ich.nutzerId,
				warBestaetigt: false,
				ausStatus: bon.status
			});
			const [nachher] = await tx
				.select({
					sichtbarkeit: receipts.sichtbarkeit,
					privatGewuenscht: receipts.privatGewuenscht
				})
				.from(receipts)
				.where(eq(receipts.id, id));

			// Der Vorsatz ist gespeichert — das ist der eigentliche Punkt.
			expect(nachher.privatGewuenscht).toBe(true);
			// Und die Sichtbarkeit selbst hat sich NICHT veraendert — das ist die
			// eigentliche Eigenschaft, nicht ein bestimmter Wert: ein
			// Zwischenspeichern darf weder teilen noch privat machen, egal womit der
			// Bon angefangen hat.
			expect(nachher.sichtbarkeit).toBe(bon.sichtbarkeit);

			// Gegenprobe: ohne Haken wird der Vorsatz auf false gesetzt, nicht auf null
			// gelassen — „ausdruecklich teilen" ist eine Entscheidung, keine Leerstelle.
			await korrekturenAnwenden(tx, id, rumpf(false), {
				bestaetigen: false,
				userId: ich.nutzerId,
				warBestaetigt: false,
				ausStatus: bon.status
			});
			const [ohne] = await tx
				.select({ privatGewuenscht: receipts.privatGewuenscht })
				.from(receipts)
				.where(eq(receipts.id, id));
			expect(ohne.privatGewuenscht).toBe(false);
		});
	});

	/**
	 * Von Hand eingetragene Fehlschlaege (27.09.2026). Ein Bon mit Positionen wird in der
	 * Transaktion auf `failed` gestellt — im Bestand gibt es keinen fehlgeschlagenen mit
	 * Zeilen, und der Wechsel rollt ohnehin zurueck.
	 */
	it('macht aus einem fehlgeschlagenen Bon beim Speichern einen Bon in Pruefung und rollt bei falschem Status alles zurueck', async () => {
		let bonId = '';
		await zurueckgerollt(async (tx) => {
			const ich = await testHaushalt(tx);
			const { id, kopf: kopfVorher, zeilen: vorher } = await bonMitZeilen(tx, ich.k);
			bonId = id;
			const k = korrekturenSchema.parse({
				receipt: { merchantNameRaw: 'Handeintrag-Testlauf', purchasedAt: null, totalGrossCents: 100, paymentMethod: null },
				items: [
					...vorher.map((z) => ({
						id: z.id,
						lineNo: z.lineNo,
						rawText: z.rawText,
						lineType: z.lineType,
						quantity: z.quantity,
						unit: z.unit,
						unitPriceCents: z.unitPriceCents,
						totalPriceCents: z.totalPriceCents,
						vatClass: z.vatClass,
						appliesToLine: z.appliesToLine,
						categoryId: z.categoryId
					})),
					{
						id: null,
						lineNo: vorher.length + 1,
						rawText: 'VON HAND',
						lineType: 'article',
						quantity: null,
						unit: null,
						unitPriceCents: null,
						totalPriceCents: 42,
						vatClass: null,
						appliesToLine: null,
						categoryId: null
					}
				],
				geloescht: []
			});

			// 1. Der Bon wird inzwischen wieder ausgelesen: nichts darf bleiben.
			await tx.update(receipts).set({ status: 'pending' }).where(eq(receipts.id, id));
			await expect(
				tx.transaction((innen) =>
					korrekturenAnwenden(innen, id, k, { bestaetigen: false, userId: ich.nutzerId, ausStatus: 'failed' })
				)
			).rejects.toBeInstanceOf(KorrekturVerfehlt);
			const nachFehlschlag = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, id));
			expect(nachFehlschlag).toHaveLength(vorher.length);
			expect(nachFehlschlag.some((z) => z.rawText === 'VON HAND')).toBe(false);

			// 2. Der Bon ist fehlgeschlagen: Speichern macht ihn zu einem Bon in Pruefung.
			await tx
				.update(receipts)
				.set({ status: 'failed', failureReason: 'Testlauf' })
				.where(eq(receipts.id, id));
			await korrekturenAnwenden(tx, id, k, { bestaetigen: false, userId: ich.nutzerId, ausStatus: 'failed' });
			const [kopf] = await tx.select().from(receipts).where(eq(receipts.id, id));
			expect(kopf.status).toBe('review');
			expect(kopf.failureReason).toBeNull();
			expect(kopf.confirmedAt).toEqual(kopfVorher.confirmedAt);
		});

		expect(await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.id, bonId))).toHaveLength(0);
	});
});
