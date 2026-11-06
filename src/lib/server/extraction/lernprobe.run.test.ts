import { describe, it, expect } from 'vitest';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { lernprobe, type LernBon } from './lernprobe';
import { extractedReceiptSchema } from './schema';

/**
 * Die Lernprobe gegen den Bestand — hinter RUN_LERNPROBE=1, damit sie nie versehentlich
 * in der Suite mitlaeuft. Sie LIEST NUR (Transaktion `read only`) und gibt NUR Zaehler
 * aus, nie Texte, Haendler oder Betraege:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_LERNPROBE=1 \
 *     npx vitest run src/lib/server/extraction/lernprobe.run.test.ts
 *
 * Grundlage: bestaetigte Bons, je Bon der juengste Leselauf mit `raw_json` und
 * `ocr_zeilen`. Messung vom 06.11.2026: automatisch 9 richtig / 2 falsch / 0 richtige
 * veraendert; Hinweise 15 richtig / 6 ueberfluessig.
 */
const AUS = process.env.RUN_LERNPROBE !== '1';

describe.skipIf(AUS)('Lernprobe ueber die bestaetigten Bons', () => {
	it('zaehlt Nachbesserungen und Hinweise, ohne Inhalte auszugeben', async () => {
		// Erst hier laden: ohne RUN_LERNPROBE soll die Datei keine Verbindung aufbauen.
		const { db } = await import('$lib/server/db');
		const { receipts, receiptItems, extractionRuns } = await import('$lib/server/db/schema');

		let ohneLesbaresModell = 0;
		const bons: LernBon[] = await db.transaction(async (tx) => {
			await tx.execute(sql`set transaction read only`);
			const bestaetigt = await tx
				.select({ id: receipts.id })
				.from(receipts)
				.where(eq(receipts.status, 'confirmed'));
			const ids = bestaetigt.map((b) => b.id);
			if (ids.length === 0) return [];

			const laeufe = await tx
				.select({ receiptId: extractionRuns.receiptId, rawJson: extractionRuns.rawJson, ocrZeilen: extractionRuns.ocrZeilen })
				.from(extractionRuns)
				.where(
					and(
						inArray(extractionRuns.receiptId, ids),
						isNotNull(extractionRuns.rawJson),
						isNotNull(extractionRuns.ocrZeilen)
					)
				)
				.orderBy(desc(extractionRuns.createdAt));
			const juengster = new Map<string, (typeof laeufe)[number]>();
			for (const l of laeufe) if (!juengster.has(l.receiptId)) juengster.set(l.receiptId, l);

			const positionen = await tx
				.select({
					receiptId: receiptItems.receiptId,
					lineNo: receiptItems.lineNo,
					rawText: receiptItems.rawText,
					lineType: receiptItems.lineType,
					totalPriceCents: receiptItems.totalPriceCents
				})
				.from(receiptItems)
				.where(inArray(receiptItems.receiptId, [...juengster.keys()]))
				.orderBy(receiptItems.receiptId, receiptItems.lineNo);

			const ergebnis: LernBon[] = [];
			for (const [receiptId, lauf] of juengster) {
				const modell = extractedReceiptSchema.safeParse(lauf.rawJson);
				if (!modell.success) {
					ohneLesbaresModell++;
					continue;
				}
				ergebnis.push({
					modellItems: modell.data.items.map((i) => ({
						rawText: i.rawText,
						lineType: i.lineType,
						totalPriceCents: i.totalPriceCents,
						unitPriceCents: i.unitPriceCents
					})),
					items: positionen.filter((p) => p.receiptId === receiptId),
					kaesten: lauf.ocrZeilen ?? []
				});
			}
			return ergebnis;
		});

		const z = lernprobe(bons);
		console.log(JSON.stringify({ ...z, ohneLesbaresModell }));
		// Die harte Grenze aus dem Entwurf: kein richtiger Preis wird veraendert.
		expect(z.automatisch.richtigeVeraendert).toBe(0);
	}, 120_000);
});
