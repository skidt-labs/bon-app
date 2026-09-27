import { asc, inArray, sql } from 'drizzle-orm';
import type { db as Db } from '$lib/server/db';
import { receiptItems } from '$lib/server/db/schema';
import { tagesgrenzen } from '$lib/server/zeit';
import type { Zugriffskontext } from '$lib/server/zugriff/kontext';
import { zeitraumTage, type BerichtFilter } from '$lib/berichte/filter';
import { monatVon, monateVonBis } from '$lib/berichte/kalender';
import type { FilterNamen } from '$lib/berichte/merkmale';
import { bonsImFenster } from './abfragen';
import { filterAufloesen, stammdatenLaden } from './aufloesen';
import { bonPasst, kriterienAktiv, positionsTreffer } from './kriterien';
import type { CsvZeile } from './csv';

/**
 * Die Ausfuhr eines Berichts: eine Zeile je Position der bestaetigten, sichtbaren Bons,
 * die zum Filter passen. Mit Positionsmerkmal (Kategorie, Topf, Suche) nur die passenden
 * Positionen — nach derselben Regel wie die Kopfzahl des Berichts —, sonst ALLE Zeilen der
 * Bons, auch Infozeilen, damit die Datei dem Papier entspricht.
 */
export async function exportLaden(
	db: typeof Db,
	k: Zugriffskontext,
	filterRoh: BerichtFilter
): Promise<{ filter: BerichtFilter; namen: FilterNamen; hinweise: string[]; zeilen: CsvZeile[] }> {
	const tage = zeitraumTage(filterRoh.zeitraum);
	const grenzen = tagesgrenzen(tage.von, tage.bis);
	if (!grenzen) throw new Error(`Unbrauchbarer Zeitraum ${tage.von}–${tage.bis}`);
	const monate = monateVonBis(monatVon(tage.von), monatVon(tage.bis));

	const stamm = await stammdatenLaden(db, k);
	const { filter, namen, hinweise, kriterien } = await filterAufloesen(db, k, filterRoh, stamm, monate);
	const bons = (await bonsImFenster(db, k, filter, grenzen))
		.filter((b) => bonPasst(b, filter))
		.sort((a, b) => new Date(a.zeit).getTime() - new Date(b.zeit).getTime() || a.id.localeCompare(b.id));

	const positionen =
		bons.length === 0
			? []
			: await db
					.select({
						receiptId: receiptItems.receiptId,
						lineNo: receiptItems.lineNo,
						rawText: receiptItems.rawText,
						lineType: sql<string>`${receiptItems.lineType}`,
						quantity: receiptItems.quantity,
						unit: receiptItems.unit,
						unitPriceCents: receiptItems.unitPriceCents,
						totalPriceCents: receiptItems.totalPriceCents,
						categoryId: receiptItems.categoryId,
						appliesToLine: receiptItems.appliesToLine
					})
					.from(receiptItems)
					.where(inArray(receiptItems.receiptId, bons.map((b) => b.id)))
					.orderBy(asc(receiptItems.receiptId), asc(receiptItems.lineNo));

	const monatVonBon = new Map(bons.map((b) => [b.id, b.tag.slice(0, 7)]));
	const behalten = kriterienAktiv(kriterien) ? new Set(positionsTreffer(positionen, kriterien, monatVonBon)) : null;
	const jeBon = new Map<string, typeof positionen>();
	for (const p of positionen) jeBon.set(p.receiptId, [...(jeBon.get(p.receiptId) ?? []), p]);
	const knoten = new Map(stamm.kategorien.map((c) => [c.id, c]));

	const zeilen: CsvZeile[] = [];
	for (const b of bons) {
		for (const p of jeBon.get(b.id) ?? []) {
			if (behalten && !behalten.has(p)) continue;
			const kategorie = p.categoryId === null ? undefined : knoten.get(p.categoryId);
			const ober = kategorie?.parentId ? knoten.get(kategorie.parentId) : undefined;
			zeilen.push({
				datum: b.tag,
				haendler: b.haendler,
				bonId: b.id,
				lineNo: p.lineNo,
				rawText: p.rawText,
				lineType: p.lineType,
				quantity: p.quantity,
				unit: p.unit,
				unitPriceCents: p.unitPriceCents,
				totalPriceCents: p.totalPriceCents,
				kategorie: kategorie?.name ?? null,
				oberkategorie: ober?.name ?? null
			});
		}
	}
	return { filter, namen, hinweise, zeilen };
}
