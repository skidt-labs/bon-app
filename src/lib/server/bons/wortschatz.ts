/**
 * Der Wortschatz fuers Raten (Entwurf 2026-11-06-pruefhilfen, §2a): die Woerter aller
 * bestaetigten Positionen, die dieser Mensch sehen darf. Was ein Mensch vor dem Bestaetigen
 * verbessert hat, steht damit drin — so lernt das Raten aus den Korrekturen.
 *
 * `getippt` (Abschlusspruefung 0.13.0, I5): die Woerter, die in einer bestaetigten Zeile
 * stehen, aber NICHT im OCR-Text desselben Bons — die hat ein Mensch getippt. Nur dorthin
 * setzt die Ansicht gleich ein; ein unkorrigiert bestaetigter Lesefehler steht sonst ebenso
 * im Wortschatz. Bons ohne Leselauf (von Hand eingetragen) zaehlen ganz als getippt.
 *
 * Nicht gecacht: bei einigen hundert bestaetigten Bons sind das zwei kleine Abfragen.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { extractionRuns, receipts, receiptItems } from '$lib/server/db/schema';
import { sichtbareBons } from '$lib/server/zugriff/sichtbar';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { woerterIn, wortschatzAus } from '$lib/bons/woerter';

export async function wortschatzLaden(d: typeof Db, k: Zugriffskontext): Promise<{ woerter: [string, number][]; getippt: string[] }> {
	const zeilen = await d
		.select({ receiptId: receiptItems.receiptId, rawText: receiptItems.rawText })
		.from(receiptItems)
		.innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
		.where(and(eq(receipts.status, 'confirmed'), sichtbareBons(k)));
	if (zeilen.length === 0) return { woerter: [], getippt: [] };

	const ids = [...new Set(zeilen.map((z) => z.receiptId))];
	const laeufe = await d
		.select({ receiptId: extractionRuns.receiptId, ocrZeilen: extractionRuns.ocrZeilen })
		.from(extractionRuns)
		.where(and(inArray(extractionRuns.receiptId, ids), isNotNull(extractionRuns.ocrZeilen)))
		.orderBy(desc(extractionRuns.createdAt));
	const gelesen = new Map<string, Set<string>>();
	for (const l of laeufe) {
		if (gelesen.has(l.receiptId)) continue;
		gelesen.set(l.receiptId, new Set((l.ocrZeilen ?? []).flatMap((z) => woerterIn(z.text))));
	}

	const getippt = new Set<string>();
	for (const z of zeilen) {
		const ocr = gelesen.get(z.receiptId);
		for (const w of woerterIn(z.rawText)) if (!ocr?.has(w)) getippt.add(w);
	}
	return { woerter: [...wortschatzAus(zeilen.map((z) => z.rawText))], getippt: [...getippt] };
}
