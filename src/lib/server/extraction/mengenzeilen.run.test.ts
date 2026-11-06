import { describe, it, expect } from 'vitest';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { mengenzeilenAnwenden } from './mengenzeilen';
import { randPreiseAnwenden } from './randpreise';
import { extractedReceiptSchema } from './schema';
import { MONETAER } from '$lib/bons/zeilenarten';
import { reihen } from '$lib/bons/reihen';
import { mengeAusText, partnerFuerMengenreihe, reihenText } from '$lib/bons/mengenzeilen';
import { mengeAlsZahl } from '$lib/bons/rechenprobe';

/**
 * Die Mengenprobe gegen den Bestand (Entwurf 2026-11-06-pruefhilfen, §1) — hinter
 * RUN_MENGENPROBE=1. Sie LIEST NUR (Transaktion `read only`) und gibt NUR Zaehler aus:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_MENGENPROBE=1 \
 *     npx vitest run src/lib/server/extraction/mengenzeilen.run.test.ts
 *
 * Grundlage wie bei der Lernprobe: bestaetigte Bons, je Bon der juengste Leselauf mit
 * `raw_json` und `ocr_zeilen`. Die Modell-Positionen laufen erst durch die Randpreise (wie
 * im Worker), dann durch die Mengenzeilen; verglichen wird mit dem, was ein Mensch bestaetigt hat.
 *
 * Messung vom 06.11.2026 (27 Bons): 23 Mengenzeilen, 12 unter der Ware, 6 darueber, 5 ohne
 * eindeutigen Partner. 9 Eingriffe: 3 richtig, 2 Standard verfeinert, 1 falsch (war vorher
 * schon falsch), 3 ohne bestaetigte Gegenzeile, 0 richtige veraendert.
 */
const AUS = process.env.RUN_MENGENPROBE !== '1';

const normal = (t: string) => t.trim().toUpperCase().replace(/\s+/g, ' ');
type Angabe = { quantity: string | null; unitPriceCents: number | null };
const gleich = (a: Angabe, b: Angabe) =>
	mengeAlsZahl(a.quantity) === mengeAlsZahl(b.quantity) &&
	(a.unitPriceCents === null ? null : Math.abs(a.unitPriceCents)) === (b.unitPriceCents === null ? null : Math.abs(b.unitPriceCents));

/**
 * Der Einzelartikel-Standard des Prompts: Menge 1, Einzelpreis = Gesamtbetrag, und kein Mensch
 * hat die Zeile angefasst. Kein Beleg fuer „1 Stueck“ — nur dafuer, dass niemand nachsah.
 * Messung 06.11.2026: zwei solche Zeilen, bei denen der Bon „n x Preis“ druckt.
 */
const standard = (b: Angabe & { totalPriceCents: number; corrected: boolean }) =>
	!b.corrected && mengeAlsZahl(b.quantity) === 1 && b.unitPriceCents !== null && Math.abs(b.unitPriceCents) === Math.abs(b.totalPriceCents);
const gehtAuf = (n: Angabe & { totalPriceCents: number }) => {
	const m = mengeAlsZahl(n.quantity);
	return m !== null && n.unitPriceCents !== null && Math.abs(Math.round(m * Math.abs(n.unitPriceCents)) - Math.abs(n.totalPriceCents)) <= 1;
};

describe.skipIf(AUS)('Mengenprobe ueber die bestaetigten Bons', () => {
	it('zaehlt Mengenzeilen und Eingriffe, ohne Inhalte auszugeben', async () => {
		const { db } = await import('$lib/server/db');
		const { receipts, receiptItems, extractionRuns } = await import('$lib/server/db/schema');

		const z = {
			bons: 0,
			mengenreihen: 0,
			mengenzeileUnterWare: 0,
			mengenzeileUeberWare: 0,
			mengenzeileMitBetrag: 0,
			ohnePartner: 0,
			gegriffen: 0,
			ohnePaar: 0,
			richtig: 0,
			falsch: 0,
			/** Unberuehrter Einzelartikel-Standard (1 × Gesamtbetrag), neue Angabe geht genau auf. */
			standardVerfeinert: 0,
			richtigeVeraendert: 0
		};

		await db.transaction(async (tx) => {
			await tx.execute(sql`set transaction read only`);
			const ids = (await tx.select({ id: receipts.id }).from(receipts).where(eq(receipts.status, 'confirmed'))).map((b) => b.id);
			if (ids.length === 0) return;
			const laeufe = await tx
				.select({ receiptId: extractionRuns.receiptId, rawJson: extractionRuns.rawJson, ocrZeilen: extractionRuns.ocrZeilen })
				.from(extractionRuns)
				.where(and(inArray(extractionRuns.receiptId, ids), isNotNull(extractionRuns.rawJson), isNotNull(extractionRuns.ocrZeilen)))
				.orderBy(desc(extractionRuns.createdAt));
			const juengster = new Map<string, (typeof laeufe)[number]>();
			for (const l of laeufe) if (!juengster.has(l.receiptId)) juengster.set(l.receiptId, l);
			const bestaetigt = await tx
				.select({
					receiptId: receiptItems.receiptId,
					rawText: receiptItems.rawText,
					lineType: receiptItems.lineType,
					quantity: receiptItems.quantity,
					unitPriceCents: receiptItems.unitPriceCents,
					totalPriceCents: receiptItems.totalPriceCents,
					corrected: receiptItems.corrected
				})
				.from(receiptItems)
				.where(inArray(receiptItems.receiptId, [...juengster.keys()]))
				.orderBy(receiptItems.receiptId, receiptItems.lineNo);

			for (const [receiptId, lauf] of juengster) {
				const modell = extractedReceiptSchema.safeParse(lauf.rawJson);
				const kaesten = lauf.ocrZeilen ?? [];
				if (!modell.success || !kaesten.some((k) => k.box)) continue;
				z.bons++;

				const rs = reihen(kaesten);
				rs.forEach((r, i) => {
					if (!mengeAusText(reihenText(kaesten, r))) return;
					z.mengenreihen++;
					const p = partnerFuerMengenreihe(kaesten, rs, i);
					if (!p) z.ohnePartner++;
					else if (p.richtung === 'oben') z.mengenzeileUnterWare++;
					else if (p.richtung === 'unten') z.mengenzeileUeberWare++;
					else z.mengenzeileMitBetrag++;
				});

				const vorher = randPreiseAnwenden(modell.data.items, kaesten).items;
				const nachher = mengenzeilenAnwenden(vorher, kaesten).items;
				const soll = bestaetigt.filter((b) => b.receiptId === receiptId);
				const vergeben = new Set<number>();
				vorher.forEach((v, j) => {
					if (!MONETAER.includes(v.lineType)) return;
					const k = soll.findIndex((b, x) => !vergeben.has(x) && MONETAER.includes(b.lineType) && normal(b.rawText) === normal(v.rawText));
					if (k >= 0) vergeben.add(k);
					if (gleich(v, nachher[j])) return;
					z.gegriffen++;
					if (k < 0) {
						z.ohnePaar++;
						return;
					}
					const n = nachher[j];
					if (gleich(n, soll[k])) z.richtig++;
					else if (!gleich(v, soll[k])) z.falsch++;
					else if (standard(soll[k]) && gehtAuf(n)) z.standardVerfeinert++;
					else z.richtigeVeraendert++;
				});
			}
		});

		console.log(JSON.stringify(z));
		expect(z.richtigeVeraendert).toBe(0);
	}, 120_000);
});
