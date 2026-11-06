import { describe, it } from 'vitest';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { reihenSicherheit } from '$lib/client/pruefen/unsicher';
import { MONETAER } from '$lib/bons/zeilenarten';

/**
 * Wo liegt die Schwelle „schwer lesbar“? (Entwurf 2026-11-06-pruefhilfen, §2c) — hinter
 * RUN_UNSICHERPROBE=1. LIEST NUR und gibt NUR Zaehler aus:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon" RUN_UNSICHERPROBE=1 \
 *     npx vitest run src/lib/server/extraction/unsicher.run.test.ts --reporter=verbose
 *
 * Je bestaetigte Position mit Bildzeile: die kleinste OCR-Sicherheit ihrer Bon-Zeile und ob
 * ein Mensch sie korrigiert hat. Gewaehlt wird die Schwelle, unter der moeglichst viele der
 * markierten Positionen korrigiert wurden, bei hoechstens etwa einem Viertel markiert.
 * „Preis nicht am Rand“ und „Rechnung“ lassen sich hier nicht messen: die gespeicherten
 * Werte sind schon die korrigierten.
 */
const AUS = process.env.RUN_UNSICHERPROBE !== '1';

describe.skipIf(AUS)('Unsicherprobe ueber die bestaetigten Bons', () => {
	it('zaehlt markierte und korrigierte Positionen je Schwelle', async () => {
		const { db } = await import('$lib/server/db');
		const { receipts, receiptItems, extractionRuns } = await import('$lib/server/db/schema');
		const schwellen = [70, 80, 85, 90, 95];
		const z = {
			positionen: 0,
			korrigiert: 0,
			ohneBildzeile: 0,
			ohneBildzeileKorrigiert: 0,
			je: Object.fromEntries(schwellen.map((s) => [s, { markiert: 0, davonKorrigiert: 0, korrigierteGefunden: 0 }]))
		};
		await db.transaction(async (tx) => {
			await tx.execute(sql`set transaction read only`);
			const ids = (await tx.select({ id: receipts.id }).from(receipts).where(eq(receipts.status, 'confirmed'))).map((b) => b.id);
			if (ids.length === 0) return;
			const laeufe = await tx
				.select({ receiptId: extractionRuns.receiptId, ocrZeilen: extractionRuns.ocrZeilen })
				.from(extractionRuns)
				.where(and(inArray(extractionRuns.receiptId, ids), isNotNull(extractionRuns.ocrZeilen)))
				.orderBy(desc(extractionRuns.createdAt));
			const juengster = new Map<string, NonNullable<(typeof laeufe)[number]['ocrZeilen']>>();
			for (const l of laeufe) if (!juengster.has(l.receiptId) && l.ocrZeilen) juengster.set(l.receiptId, l.ocrZeilen);
			const items = await tx
				.select({ receiptId: receiptItems.receiptId, ocrZeile: receiptItems.ocrZeile, corrected: receiptItems.corrected, lineType: receiptItems.lineType })
				.from(receiptItems)
				.where(inArray(receiptItems.receiptId, [...juengster.keys()]));
			for (const i of items) {
				if (!MONETAER.includes(i.lineType)) continue;
				const ocr = juengster.get(i.receiptId)!;
				z.positionen++;
				if (i.corrected) z.korrigiert++;
				if (i.ocrZeile === null) {
					z.ohneBildzeile++;
					if (i.corrected) z.ohneBildzeileKorrigiert++;
					continue;
				}
				const s = reihenSicherheit(ocr, i.ocrZeile);
				for (const schwelle of schwellen) {
					if (s !== null && s < schwelle) {
						z.je[schwelle].markiert++;
						if (i.corrected) z.je[schwelle].davonKorrigiert++;
					}
					if (i.corrected && ((s !== null && s < schwelle) || i.ocrZeile === null)) z.je[schwelle].korrigierteGefunden++;
				}
			}
		});
		console.log(JSON.stringify(z));
	}, 120_000);
});
