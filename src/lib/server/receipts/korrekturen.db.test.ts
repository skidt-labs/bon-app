import { describe, it, expect } from 'vitest';
import { asc, count, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { merchants, receipts, receiptItems, users, householdMembers } from '$lib/server/db/schema';
import { korrekturenSchema, korrekturenAnwenden } from './korrekturen';

/**
 * Live-Waechter gegen die LAUFENDE Datenbank — hinter RUN_DB_TESTS=1, nicht Teil der
 * normalen Suite:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_DB_TESTS=1 \
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
const ROLLBACK = new Error('rollback');

describe.skipIf(AUS)('korrekturenAnwenden gegen die echte Datenbank', () => {
	it('tauscht, fuegt ein, loescht und setzt einen Bezug, ohne UNIQUE oder Self-FK zu verletzen', async () => {
		const [bon] = await db
			.select({ id: receiptItems.receiptId })
			.from(receiptItems)
			.groupBy(receiptItems.receiptId)
			.having(sql`count(*) >= 3`)
			.limit(1);
		if (!bon) return; // kein Bon mit drei Zeilen: nichts zu pruefen, kein Fehler
		const [kopfVorher] = await db.select().from(receipts).where(eq(receipts.id, bon.id));
		// Ueber die Mitgliedschaft, nicht mehr ueber users.household_id — die Spalte ist
		// am 18.09.2026 gefallen.
		const [nutzer] = await db
			.select({ id: householdMembers.userId })
			.from(householdMembers)
			.where(eq(householdMembers.householdId, kopfVorher.householdId))
			.limit(1);
		if (!nutzer) return;
		const vorher = await db
			.select()
			.from(receiptItems)
			.where(eq(receiptItems.receiptId, bon.id))
			.orderBy(asc(receiptItems.lineNo));
		const [{ n: haendlerVorher }] = await db.select({ n: count() }).from(merchants);

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

		await expect(
			db.transaction(async (tx) => {
				await korrekturenAnwenden(tx, bon.id, k, { bestaetigen: true, userId: nutzer.id });

				const nachher = await tx
					.select()
					.from(receiptItems)
					.where(eq(receiptItems.receiptId, bon.id))
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

				const [kopf] = await tx.select().from(receipts).where(eq(receipts.id, bon.id));
				expect(kopf.status).toBe('confirmed');
				expect(kopf.confirmedBy).toBe(nutzer.id);
				expect(kopf.merchantNameRaw).toBe('Wächter-Testlauf');
				expect(kopf.merchantId).not.toBeNull();
				throw ROLLBACK;
			})
		).rejects.toBe(ROLLBACK);

		const danach = await db
			.select()
			.from(receiptItems)
			.where(eq(receiptItems.receiptId, bon.id))
			.orderBy(asc(receiptItems.lineNo));
		expect(danach).toEqual(vorher);
		const [kopfDanach] = await db.select().from(receipts).where(eq(receipts.id, bon.id));
		expect(kopfDanach).toEqual(kopfVorher);
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
		const [bon] = await db
			.select({
				id: receipts.id,
				householdId: receipts.householdId,
				sichtbarkeit: receipts.sichtbarkeit
			})
			.from(receipts)
			.limit(1);
		if (!bon) return;
		const [nutzer] = await db
			.select({ id: householdMembers.userId })
			.from(householdMembers)
			.where(eq(householdMembers.householdId, bon.householdId))
			.limit(1);
		if (!nutzer) return;
		const vorher = await db
			.select()
			.from(receiptItems)
			.where(eq(receiptItems.receiptId, bon.id))
			.orderBy(asc(receiptItems.lineNo));

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

		await expect(
			db.transaction(async (tx) => {
				// „Spaeter": speichern OHNE zu bestaetigen.
				await korrekturenAnwenden(tx, bon.id, rumpf(true), {
					bestaetigen: false,
					userId: nutzer.id,
					warBestaetigt: false
				});
				const [nachher] = await tx
					.select({
						sichtbarkeit: receipts.sichtbarkeit,
						privatGewuenscht: receipts.privatGewuenscht
					})
					.from(receipts)
					.where(eq(receipts.id, bon.id));

				// Der Vorsatz ist gespeichert — das ist der eigentliche Punkt.
				expect(nachher.privatGewuenscht).toBe(true);
				// Und die Sichtbarkeit selbst hat sich NICHT veraendert — das ist die
				// eigentliche Eigenschaft, nicht ein bestimmter Wert: ein
				// Zwischenspeichern darf weder teilen noch privat machen, egal womit der
				// Bon angefangen hat.
				expect(nachher.sichtbarkeit).toBe(bon.sichtbarkeit);

				// Gegenprobe: ohne Haken wird der Vorsatz auf false gesetzt, nicht auf null
				// gelassen — „ausdruecklich teilen" ist eine Entscheidung, keine Leerstelle.
				await korrekturenAnwenden(tx, bon.id, rumpf(false), {
					bestaetigen: false,
					userId: nutzer.id,
					warBestaetigt: false
				});
				const [ohne] = await tx
					.select({ privatGewuenscht: receipts.privatGewuenscht })
					.from(receipts)
					.where(eq(receipts.id, bon.id));
				expect(ohne.privatGewuenscht).toBe(false);

				throw new Error('ROLLBACK_ABSICHT');
			})
		).rejects.toThrow('ROLLBACK_ABSICHT');
	});
});
