/**
 * Integrationstest gegen die LAUFENDE Datenbank — deshalb hinter RUN_DB_TESTS=1.
 * Läuft nicht in der normalen Suite (die muss ohne Datenbank auskommen).
 *
 * Bewacht drei Dinge, die Drizzle nicht ausdrücken kann und die deshalb aus
 * handgeschriebenen Migrationen stammen — ein `db:generate` nach einer
 * Schemaänderung würde sie still zurückdrehen, ohne dass es hier auffiele:
 *
 * 1. Der Fremdschlüssel receipt_items_applies_to_line_fk muss die Spaltenliste
 *    `(applies_to_line)` tragen. Ohne sie nullt Postgres auch receipt_id (NOT NULL)
 *    und referenzierte Bonzeilen sind nicht mehr löschbar.
 * 2. product_aliases braucht zusätzlich zum zusammengesetzten Unique-Constraint
 *    einen partiellen Unique-Index für den Fall merchant_id IS NULL — Postgres
 *    behandelt mehrere NULLs als verschieden, der zusammengesetzte Constraint greift
 *    also nicht, sobald der Händler unbekannt ist (siehe
 *    .superpowers/sdd/2026-09-15-bon-app-phase-2-kategorien/task-2-review.md,
 *    Befund "product_aliases").
 * 3. categories braucht einen CHECK gegen Selbstreferenz und einen Trigger gegen
 *    Zyklen/eine dritte Ebene im Kategoriebaum (siehe dieselbe Review-Datei, Befund
 *    "Der Kategoriebaum").
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/db/fk-integrity.db.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const RUN = process.env.RUN_DB_TESTS === '1';

function psql(sql: string): string {
  return execFileSync('docker', ['exec', 'bon-db', 'psql', '-q', '-U', 'bon', '-d', 'bon', '-tAc', sql], {
    encoding: 'utf8'
  }).trim();
}

describe.skipIf(!RUN)('Fremdschlüssel-Integrität (live)', () => {
  it('trägt die Spaltenliste applies_to_line', () => {
    const def = psql(
      "select pg_get_constraintdef(oid) from pg_constraint where conname='receipt_items_applies_to_line_fk'"
    );
    expect(def).toContain('ON DELETE SET NULL (applies_to_line)');
  });

  it('lässt eine referenzierte Bonzeile löschen, ohne receipt_id zu nullen', () => {
    // slug explizit setzen (Task 16): households.slug ist unique, und der echte
    // Standard-Haushalt belegt bereits 'default' dauerhaft — ohne eigenen Slug
    // wuerde dieser Insert daran scheitern.
    const out = psql(`
      begin;
      insert into households (id,name,slug) values ('aaaaaaaa-0000-0000-0000-000000000001','T','fk-test');
      insert into users (id,oidc_sub,email,display_name)
        values ('aaaaaaaa-0000-0000-0000-000000000002','fk-test','t@t','T');
      insert into receipts (id,household_id,uploaded_by,image_path,thumb_path)
        values ('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','a','b');
      insert into receipt_items (receipt_id,line_no,raw_text,line_type,total_price_cents,applies_to_line) values
        ('aaaaaaaa-0000-0000-0000-000000000003',1,'BUTTER','article',249,null),
        ('aaaaaaaa-0000-0000-0000-000000000003',2,'RABATT','discount',-50,1);
      delete from receipt_items where receipt_id='aaaaaaaa-0000-0000-0000-000000000003' and line_no=1;
      select line_no||'|'||(applies_to_line is null)||'|'||(receipt_id is not null)
        from receipt_items where receipt_id='aaaaaaaa-0000-0000-0000-000000000003'
        order by line_no;
      rollback;
    `);
    expect(out).toBe('2|true|true');
  });

  // Jede Abfrage MUSS auf die eigenen Test-Ids eingeschränkt sein. Ohne WHERE liest
  // sie die ganze Tabelle mit — solange die leer war, fiel das nicht auf, seit den
  // ersten echten Bons konnte dieser Waechter dann gar nicht mehr gruen werden und hat
  // Migrationen stillschweigend durchgewunken. Ein Waechter, der nicht mehr melden
  // kann, ist selbst der Defekt.
  it('hinterlässt keine Testdaten', () => {
    const T = "'aaaaaaaa-0000-0000-0000-000000000003'";
    expect(psql(`select count(*) from receipt_items where receipt_id=${T}`)).toBe('0');
    expect(psql(`select count(*) from receipts where id=${T}`)).toBe('0');
    expect(psql("select count(*) from households where slug='fk-test'")).toBe('0');
    expect(psql("select count(*) from users where oidc_sub='fk-test'")).toBe('0');
  });

  // Befund A (task-2-review.md, "product_aliases"): Der zusammengesetzte Unique-
  // Constraint (merchant_id, raw_text_normalized) greift NICHT, wenn merchant_id NULL
  // ist — Postgres behandelt mehrere NULLs als verschieden. haendlerAufloesen()
  // liefert genau dann null, wenn kein Händlername gelesen wurde: ein häufiger Fall,
  // kein Ausnahmefall. Ohne den partiellen Unique-Index (0009_...sql) lassen sich
  // zwei Aliase mit identischem Rohtext auf unterschiedliche Produkte anlegen, sobald
  // beide merchant_id=NULL haben — das Lerngedächtnis zerfällt still in Duplikate.
  //
  // Die erwartete Ablehnung wird per DO-Block abgefangen (unique_violation), statt
  // das ganze Skript beim ersten Fehler abzubrechen: eine einzelne "-c"-Zeichenkette
  // läuft in einer Postgres-Sitzung als ein Batch — ohne den DO-Block würde der
  // INSERT-Fehler das Skript vor dem abschließenden ROLLBACK beenden.
  it('lässt pro Rohtext nur einen händlerlosen Alias zu', () => {
    const out = psql(`
      begin;
      insert into households (id,name,slug)
        values ('dddddddd-0000-0000-0000-000000000001','T','pa-test');
      insert into products (id,household_id,canonical_name) values
        ('dddddddd-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','P1'),
        ('dddddddd-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000001','P2');
      insert into product_aliases (id,product_id,merchant_id,raw_text_normalized)
        values ('dddddddd-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-000000000002',null,'TEST BUTTER XYZ FKGUARD');

      do $$
      begin
        insert into product_aliases (id,product_id,merchant_id,raw_text_normalized)
          values ('dddddddd-0000-0000-0000-000000000005','dddddddd-0000-0000-0000-000000000003',null,'TEST BUTTER XYZ FKGUARD');
      exception
        when unique_violation then
          null;
      end $$;

      select count(*) from product_aliases
        where raw_text_normalized = 'TEST BUTTER XYZ FKGUARD'
        and product_id in ('dddddddd-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000003');
      rollback;
    `);
    expect(out).toBe('1');

    // Nur die eigenen Test-Ids, sonst genau der Fehler, der diesen Wächter schon
    // einmal unbemerkbar gemacht hat.
    expect(
      psql("select count(*) from product_aliases where product_id::text like 'dddddddd-%'")
    ).toBe('0');
    expect(psql("select count(*) from products where id::text like 'dddddddd-%'")).toBe('0');
    expect(psql("select count(*) from households where slug='pa-test'")).toBe('0');
  });

  // Befund B (task-2-review.md, "Der Kategoriebaum"): categories.parent_id zeigt auf
  // dieselbe Tabelle; das FK prüft nur, dass der referenzierte Datensatz existiert,
  // nicht die Form des Baums. Vier Proben, alle in derselben Transaktion mit
  // ROLLBACK, alle über DO-Blöcke abgefangen (check_violation — sowohl der CHECK als
  // auch der Trigger lösen mit SQLSTATE 23514 aus):
  //   - selfref: parent_id = eigene id (CHECK categories_parent_not_self).
  //   - cycle: A bekommt B als Elternteil, obwohl B bereits A als Elternteil hat.
  //   - thirdlevel: C bekommt B als Elternteil, obwohl B bereits A als Elternteil hat.
  //   - reparent_with_children: W hat bereits Kind V und bekommt selbst einen
  //     Elternknoten (Y, der keinen eigenen Elternknoten hat) — das ist die Lücke,
  //     die die im Auftrag beschriebene Trigger-Regel ALLEIN (nur den neuen
  //     Elternknoten prüfen) nicht schließen würde: Z -> W -> V wäre sonst eine
  //     dritte Ebene, ohne dass V je angefasst wird. Deshalb prüft der Trigger
  //     zusätzlich, ob der zu ändernde Knoten selbst schon Kinder hat.
  it('sperrt Zyklen, dritte Ebene und Selbstreferenz im Kategoriebaum', () => {
    const out = psql(`
      begin;
      insert into categories (id,name,slug) values
        ('cccccccc-0000-0000-0000-000000000001','S','ccc-test-s'),
        ('cccccccc-0000-0000-0000-000000000002','A','ccc-test-a'),
        ('cccccccc-0000-0000-0000-000000000005','W','ccc-test-w'),
        ('cccccccc-0000-0000-0000-000000000007','Y','ccc-test-y');
      insert into categories (id,name,slug,parent_id) values
        ('cccccccc-0000-0000-0000-000000000003','B','ccc-test-b','cccccccc-0000-0000-0000-000000000002'),
        ('cccccccc-0000-0000-0000-000000000006','V','ccc-test-v','cccccccc-0000-0000-0000-000000000005');

      create temporary table guard_probe (scenario text, blocked boolean);

      do $$
      begin
        update categories set parent_id = id
          where id = 'cccccccc-0000-0000-0000-000000000001';
        insert into guard_probe values ('selfref', false);
      exception
        when check_violation then
          insert into guard_probe values ('selfref', true);
      end $$;

      do $$
      begin
        update categories set parent_id = 'cccccccc-0000-0000-0000-000000000003'
          where id = 'cccccccc-0000-0000-0000-000000000002';
        insert into guard_probe values ('cycle', false);
      exception
        when check_violation then
          insert into guard_probe values ('cycle', true);
      end $$;

      do $$
      begin
        insert into categories (id,name,slug,parent_id) values
          ('cccccccc-0000-0000-0000-000000000004','C','ccc-test-c','cccccccc-0000-0000-0000-000000000003');
        insert into guard_probe values ('thirdlevel', false);
      exception
        when check_violation then
          insert into guard_probe values ('thirdlevel', true);
      end $$;

      do $$
      begin
        update categories set parent_id = 'cccccccc-0000-0000-0000-000000000007'
          where id = 'cccccccc-0000-0000-0000-000000000005';
        insert into guard_probe values ('reparent_with_children', false);
      exception
        when check_violation then
          insert into guard_probe values ('reparent_with_children', true);
      end $$;

      select string_agg(scenario || '=' || blocked::text, ',' order by scenario) from guard_probe;
      rollback;
    `);
    expect(out).toBe('cycle=true,reparent_with_children=true,selfref=true,thirdlevel=true');

    // Nur die eigenen Test-Ids.
    expect(psql("select count(*) from categories where id::text like 'cccccccc-%'")).toBe('0');
  });

  it('budget_kategorien.eigentuemer_id stimmt mit dem Topf ueberein', () => {
    // Die Spalte steht doppelt — am Topf und an der Zuordnung —, weil Postgres eine
    // Teilregel nicht ueber einen Verbund ausdruecken kann (siehe Kommentar in schema.ts).
    // Ein CHECK kaeme dafuer nicht in Frage: er vergleicht nur Spalten derselben Zeile.
    // Ein Trigger waere moeglich, ist hier aber zu viel: geschrieben wird
    // budget_kategorien nur aus budgets/verwaltung.ts, an einer Stelle. Laufen die zwei
    // Werte doch auseinander, faellt es beim naechsten Lauf dieses Tests auf.
    const abweichler = psql(
      `select count(*) from budget_kategorien bk
       join budgets b on b.id = bk.budget_id
       where bk.eigentuemer_id is distinct from b.eigentuemer_id`
    );
    expect(abweichler).toBe('0');
  });

  it('der aktive Unique-Index behandelt NULLs als gleich', () => {
    // Ohne NULLS NOT DISTINCT koennten zwei GETEILTE Toepfe (eigentuemer_id IS NULL)
    // dieselbe Kategorie beanspruchen — genau das, was der Index verhindern soll. Die
    // Klausel kann Drizzle nicht ausdruecken, der Index stammt darum aus einer
    // handgeschriebenen Migration und wuerde von einem `db:generate` still zurueckgedreht.
    const def = psql(
      "select indexdef from pg_indexes where indexname='budget_kategorien_aktiv_unique'"
    );
    expect(def).toContain('NULLS NOT DISTINCT');
    expect(def).toContain('eigentuemer_id');
  });
});
