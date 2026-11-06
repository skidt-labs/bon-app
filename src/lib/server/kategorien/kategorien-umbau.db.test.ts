/**
 * Der Kategorien-Umbau 0.12.0 (drizzle/0035_kategorien_umbau.sql) gegen die Test-Datenbank —
 * nur in einer zurueckgerollten Transaktion, hinter RUN_DB_TESTS=1:
 *
 *   DATABASE_URL="postgres://bon:$(cat secrets/db-password)@127.0.0.1:55432/bon_test" RUN_DB_TESTS=1 \
 *     npx vitest run src/lib/server/kategorien/kategorien-umbau.db.test.ts
 *
 * Ausgangslage ist der ALTE Baum: 0011 wird in derselben Transaktion zuerst eingespielt
 * (wiederholbar, legt Fehlendes an) — so prueft der Test den Umbau auch dann noch gegen den
 * alten Stand, wenn bon_test 0035 laengst hat.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { receipts, receiptItems, products, budgets, budgetKategorien } from '$lib/server/db/schema';
import { zurueckgerollt, testHaushalt, type Tx } from '$lib/server/db/testdaten';
import { KATEGORIEBAUM, ENTFALLENE_SLUGS, SONSTIGES_UNSORTIERT_SLUG } from './baum';

const AUS = process.env.RUN_DB_TESTS !== '1';
const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle');
const ALT = readFileSync(path.join(DRIZZLE, '0011_kategoriebaum.sql'), 'utf8');
const UMBAU = readFileSync(path.join(DRIZZLE, '0035_kategorien_umbau.sql'), 'utf8');

type Zeile = Record<string, unknown>;

async function zeilen(tx: Tx, abfrage: string): Promise<Zeile[]> {
	return (await tx.execute(sql.raw(abfrage))).rows as Zeile[];
}

async function idVon(tx: Tx, slug: string): Promise<string> {
	const [z] = await zeilen(tx, `select id from categories where slug = '${slug}'`);
	return z.id as string;
}

/** Der ganze Baum als vergleichbarer Text: slug, Name, Eltern-slug, Reihenfolge. */
async function baumStand(tx: Tx): Promise<string> {
	const z = await zeilen(
		tx,
		`select c.slug, c.name, p.slug as eltern, c.sort, c.id
		   from categories c left join categories p on p.id = c.parent_id
		  order by c.slug`
	);
	return JSON.stringify(z);
}

async function bonMitPosition(tx: Tx, haushaltId: string, nutzerId: string, kategorieId: string): Promise<string> {
	const [b] = await tx
		.insert(receipts)
		.values({
			householdId: haushaltId,
			uploadedBy: nutzerId,
			imagePath: 'test/umbau-nicht-da.webp',
			thumbPath: 'test/umbau-nicht-da.thumb.webp',
			status: 'confirmed'
		})
		.returning({ id: receipts.id });
	const [p] = await tx
		.insert(receiptItems)
		.values({
			receiptId: b.id,
			lineNo: 1,
			rawText: 'SCHOKOLADE',
			totalPriceCents: 129,
			categoryId: kategorieId,
			categorySource: 'llm',
			confidence: 80
		})
		.returning({ id: receiptItems.id });
	return p.id;
}

describe.skipIf(AUS)('Kategorien-Umbau 0035 (bon_test, zurueckgerollt)', () => {
	it('baut den alten Baum in den neuen um und haengt Positionen der entfallenen auf Unsortiert', async () => {
		await zurueckgerollt(async (tx) => {
			await tx.execute(sql.raw(ALT));
			const { haushaltId, nutzerId } = await testHaushalt(tx);
			const snacksAlt = await idVon(tx, 'lebensmittel-suesswaren-snacks');
			const getraenkeAlt = await idVon(tx, 'getraenke');
			const wasserVorher = await idVon(tx, 'getraenke-wasser');
			const posSnacks = await bonMitPosition(tx, haushaltId, nutzerId, snacksAlt);
			const posGetraenke = await bonMitPosition(tx, haushaltId, nutzerId, getraenkeAlt);
			const [prod] = await tx
				.insert(products)
				.values({ householdId: haushaltId, canonicalName: 'Schokolade', defaultCategoryId: snacksAlt })
				.returning({ id: products.id });

			await tx.execute(sql.raw(UMBAU));

			// genau die 14 Oberkategorien (Spec + Nachtrag Medikamente), in dieser Reihenfolge
			const ober = await zeilen(tx, 'select name from categories where parent_id is null order by sort, name');
			expect(ober.map((z) => z.name)).toEqual(KATEGORIEBAUM.map((o) => o.name));
			expect(ober.map((z) => z.name)).toEqual([
				'Lebensmittel', 'Süßes', 'Snacks', 'Hygiene', 'Baby', 'Medikamente', 'Mobilität', 'Baumarkt',
				'Garten', 'Kleidung', 'Technik', 'Freizeit', 'Tier', 'Sonstiges'
			]);

			// Eltern und Namen wie im Baum, Ids der Unterkategorien unveraendert
			const [wasser] = await zeilen(
				tx,
				`select c.id, p.slug as eltern from categories c join categories p on p.id = c.parent_id where c.slug = 'getraenke-wasser'`
			);
			expect(wasser).toEqual({ id: wasserVorher, eltern: 'lebensmittel' });
			const [hyg] = await zeilen(tx, `select name from categories where slug = 'drogerie'`);
			expect(hyg.name).toBe('Hygiene');
			const [apo] = await zeilen(
				tx,
				`select p.slug as eltern from categories c join categories p on p.id = c.parent_id where c.slug = 'drogerie-gesundheit-apotheke'`
			);
			expect(apo.eltern).toBe('medikamente');

			// nichts Entfallenes mehr, sonst genau der Baum
			const slugs = (await zeilen(tx, 'select slug from categories order by slug')).map((z) => z.slug);
			for (const weg of ENTFALLENE_SLUGS) expect(slugs, weg).not.toContain(weg);
			const imBaum = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);
			expect(slugs).toEqual([...imBaum].sort());

			// Positionen auf Unsortiert, OHNE Quelle — nur so greift der Kategorie-Nachlauf
			const unsortiert = await idVon(tx, SONSTIGES_UNSORTIERT_SLUG);
			for (const id of [posSnacks, posGetraenke]) {
				const [p] = await zeilen(
					tx,
					`select category_id, category_source, confidence from receipt_items where id = '${id}'`
				);
				expect(p, id).toEqual({ category_id: unsortiert, category_source: null, confidence: null });
			}
			const [pr] = await zeilen(tx, `select default_category_id from products where id = '${prod.id}'`);
			expect(pr.default_category_id).toBe(unsortiert);
		});
	});

	it('aendert beim zweiten Anwenden nichts', async () => {
		await zurueckgerollt(async (tx) => {
			await tx.execute(sql.raw(ALT));
			await tx.execute(sql.raw(UMBAU));
			const einmal = await baumStand(tx);
			await tx.execute(sql.raw(UMBAU));
			expect(await baumStand(tx)).toBe(einmal);
		});
	});

	// budget_kategorien haengt mit ON DELETE CASCADE an der Kategorie: ein Topf auf einer
	// entfallenen Kategorie verloere seine Zuordnung samt Verlauf still. Heute gibt es keinen
	// (06.11.2026) — falls doch, bricht der Umbau ab, statt still zu loeschen.
	it('bricht ab, wenn ein Budget an einer entfallenen Kategorie haengt', async () => {
		await zurueckgerollt(async (tx) => {
			await tx.execute(sql.raw(ALT));
			const { haushaltId } = await testHaushalt(tx);
			const [b] = await tx
				.insert(budgets)
				.values({ householdId: haushaltId, name: 'Naschen' })
				.returning({ id: budgets.id });
			await tx.insert(budgetKategorien).values({
				budgetId: b.id,
				householdId: haushaltId,
				categoryId: await idVon(tx, 'getraenke'),
				giltAb: '2026-01-01'
			});
			await expect(tx.execute(sql.raw(UMBAU))).rejects.toThrow(/Budget/);
		});
	});
});
