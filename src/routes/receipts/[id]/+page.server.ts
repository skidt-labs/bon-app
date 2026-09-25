import { error, redirect } from '@sveltejs/kit';
import { asc, desc, eq, not, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '$lib/server/db';
import { extractionRuns, categories } from '$lib/server/db/schema';
import { bonLaden, bonPositionenLaden } from '$lib/server/bons/liste';
import { stapelLaden } from '$lib/server/receipts/stapel';
import { originalKurz } from '$lib/server/bons/doppelt';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const k = locals.zugriff!;
	const receipt = await bonLaden(db, k, params.id);
	if (!receipt) error(404, 'Bon nicht gefunden');

	// ORDER BY line_no ist die einzig mögliche Sortierung (keine separate
	// Positionsspalte) und für alle Zeilen bis auf höchstens eine auch die RICHTIGE —
	// nur eine wegen einer doppelten Original-Nummer umnummerierte Zeile (Task 11)
	// liegt danach an der falschen Stelle.
	//
	// Bis zum 17.09.2026 markierte die alte Prüfansicht diese eine Zeile eigens
	// (findRenumberedItemId). Seit Etappe 2 gibt es die bessere Auskunft: `ocr_zeile`
	// sagt je Position, WO sie im Bild steht — und wo das nicht eindeutig war, steht
	// dort null und die Ansicht zeichnet keinen Rahmen. Das ist dieselbe Warnung,
	// nur wahrer. Der Grund selbst bleibt als `duplicate_line_no` in
	// `needs_review_reason` und steht im Hinweisstreifen über den Positionen.
	const items = await bonPositionenLaden(db, receipt.id);

	// Die OCR-Zeilen des JUENGSTEN Laufs — der ist der, aus dem die Positionen stammen
	// (saveResult loescht die alten Positionen und schreibt neue). null, wenn der Lauf
	// keine Boxen hatte: dann zeigt die Pruefansicht keinen Rahmen und sagt das
	// (Etappe 3), statt zu raten.
	const [lauf] = await db
		.select({ ocrZeilen: extractionRuns.ocrZeilen })
		.from(extractionRuns)
		.where(eq(extractionRuns.receiptId, receipt.id))
		.orderBy(desc(extractionRuns.createdAt))
		.limit(1);
	const ober = alias(categories, 'ober');
	const [kategorien, stapel, original] = await Promise.all([
		db
			.select({ id: categories.id, name: categories.name, oberName: ober.name })
			.from(categories)
			.leftJoin(ober, eq(categories.parentId, ober.id))
			// Waehlbar sind nur Blaetter: alle Unterkategorien und die Oberkategorien ohne
			// Kinder. Eine Oberkategorie MIT Kindern waere zu grob und stuende doppelt in
			// der Liste — einmal als "Lebensmittel" und einmal als "Lebensmittel › Brot".
			// Von 51 Kategorien fallen so 8 heraus.
			.where(
				not(
					sql`exists (select 1 from ${categories} as kind where kind.parent_id = ${categories.id})`
				)
			)
			// Blattkategorien ohne Elternteil zuerst (oberName ist null), danach je
			// Oberkategorie alphabetisch — dieselbe Ordnung, die die Anzeige zeigt.
			.orderBy(asc(ober.name), asc(categories.name)),
		stapelLaden(db, k, receipt.id),
		// Nur fuer den Doppel-Hinweis. null auch dann, wenn es ein Original gibt, das dieser
		// Mensch nicht (mehr) sehen darf — dann sagt das Band nur, dass es eines gab.
		receipt.vermutetesOriginalId ? originalKurz(db, k, receipt.vermutetesOriginalId) : null
	]);

	return { receipt, items, ocrZeilen: lauf?.ocrZeilen ?? null, kategorien, stapel, original };
};
