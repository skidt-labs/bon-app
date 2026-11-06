import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KATEGORIEBAUM, ENTFALLENE_SLUGS, SONSTIGES_UNSORTIERT_SLUG } from './baum';

/**
 * Schneller Wächter OHNE Datenbank — läuft deshalb immer mit, nicht nur hinter
 * RUN_DB_TESTS=1. Prüft die FORM des erzeugten SQL (drizzle/0011_kategoriebaum.sql als
 * Startbestand, drizzle/0035_kategorien_umbau.sql als Umbau 0.12.0), nicht sein Ergebnis
 * gegen eine echte Datenbank — das übernehmen kategoriebaum-seed.db.test.ts und
 * kategorien-umbau.db.test.ts.
 *
 * Der Grund für DO UPDATE statt DO NOTHING: dasselbe Upsert-Muster wie
 * ensureDefaultHousehold() (household.ts) und haendlerAufloesen() (merchants.ts) —
 * kein "nachsehen, dann einfügen". Siehe household-upsert.test.ts, dessen Muster
 * dieser Test übernimmt.
 */
const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle');

// Kommentarzeilen raus, BEVOR auf Textschnipsel geprueft wird — der Kopfkommentar
// erklaert in Prosa, warum NICHT "do nothing" verwendet wird, und enthaelt das Wort
// deshalb selbst. Ohne diesen Schritt prueft der Test sein eigenes Gegenargument.
function ohneKommentare(datei: string): string {
	return readFileSync(path.join(DRIZZLE, datei), 'utf8')
		.split('\n')
		.filter((zeile) => !zeile.trim().startsWith('--'))
		.join('\n')
		.toLowerCase();
}

const seed = ohneKommentare('0011_kategoriebaum.sql');
const umbau = ohneKommentare('0035_kategorien_umbau.sql');
const alleSlugs = KATEGORIEBAUM.flatMap((o) => [o.slug, ...o.kinder.map((k) => k.slug)]);

describe.each([
	['0011 (Startbestand)', seed],
	['0035 (Umbau 0.12.0)', umbau]
])('Kategoriebaum-Migration %s (SQL-Form)', (_name, sql) => {
	it('nutzt ON CONFLICT ... DO UPDATE, nicht DO NOTHING', () => {
		expect(sql).toContain('on conflict');
		expect(sql).toContain('do update');
		expect(sql).not.toContain('do nothing');
	});

	it('kollidiert auf dem slug, nicht auf der id', () => {
		expect(sql).toMatch(/on conflict \("?slug"?\)/);
	});
});

describe('Kategorien-Umbau 0035 (SQL-Form)', () => {
	// Der Umbau setzt JEDEN Eintrag des Baums (Name, Eltern, Reihenfolge) — dieselbe
	// Zaehlprobe wie beim Startbestand, gegen KATEGORIEBAUM statt gegen eine feste Zahl.
	it('legt fuer jeden Eintrag aus KATEGORIEBAUM genau einen INSERT an', () => {
		const inserts = umbau.match(/insert into "categories"/g) ?? [];
		expect(inserts).toHaveLength(alleSlugs.length);
	});

	it('nennt jeden Slug aus KATEGORIEBAUM (aus baum.ts erzeugt, nicht daneben gepflegt)', () => {
		for (const s of alleSlugs) expect(umbau, s).toContain(`'${s}'`);
	});

	// Die Migration enthaelt den Baum, wie er beim Erzeugen war. Laeuft baum.ts weiter,
	// ohne dass 0035 neu erzeugt wird, faellt es hier auf: jede Zeile des Umbaus muss
	// genau so aus dem heutigen Baum entstehen.
	it('stimmt Zeile fuer Zeile mit dem heutigen Baum ueberein', () => {
		KATEGORIEBAUM.forEach((o, i) => {
			expect(umbau, o.slug).toContain(`values ('${o.name.toLowerCase()}', '${o.slug}', ${i}, null)`);
			o.kinder.forEach((k, j) => {
				expect(umbau, k.slug).toContain(
					`values ('${k.name.toLowerCase()}', '${k.slug}', ${j}, (select "id" from "categories" where "slug" = '${o.slug}'))`
				);
			});
		});
	});

	it('loescht genau die entfallenen Kategorien, nachdem nichts mehr auf sie zeigt', () => {
		const loeschen = umbau.indexOf('delete from "categories"');
		expect(loeschen).toBeGreaterThan(-1);
		for (const weg of ENTFALLENE_SLUGS) expect(umbau.slice(loeschen), weg).toContain(`'${weg}'`);
		// Positionen und Produkte werden VOR dem Loeschen umgehaengt.
		expect(umbau.indexOf('update "receipt_items"')).toBeGreaterThan(-1);
		expect(umbau.indexOf('update "receipt_items"')).toBeLessThan(loeschen);
		expect(umbau.indexOf('update "products"')).toBeGreaterThan(-1);
		expect(umbau.indexOf('update "products"')).toBeLessThan(loeschen);
		expect(umbau).toContain(`'${SONSTIGES_UNSORTIERT_SLUG}'`);
	});

	// Der Migrator von drizzle faehrt alle offenen Migrationen in EINER Transaktion; ein
	// eigenes BEGIN/COMMIT darin wuerde sie vorzeitig festschreiben. Das BEGIN eines
	// DO-Blocks (Waechter) ist kein Transaktionsbefehl und zaehlt nicht.
	it('steuert keine eigene Transaktion', () => {
		const ohneDo = umbau.replace(/do \$\$[\s\S]*?\$\$;/g, '');
		expect(ohneDo).not.toBe(umbau);
		expect(ohneDo).not.toMatch(/^\s*(begin|commit|rollback|start transaction)\b/m);
	});
});
