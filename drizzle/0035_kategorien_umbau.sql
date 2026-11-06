-- Handgeschrieben, NICHT von drizzle-kit erzeugt. Nur Daten, kein Schema.
--
-- Kategorien-Umbau 0.12.0 (Entwurf 2026-11-06-doppel-vergleich, "Dazu in 0.12.0", Punkt 5,
-- plus Nachtrag des Nutzers vom 06.11.: Oberkategorie "Medikamente"). Erzeugt nach
-- src/lib/server/kategorien/baum.ts (KATEGORIEBAUM, ENTFALLENE_SLUGS), Stand 06.11.2026 --
-- kategoriebaum-migration.test.ts prueft Zeile fuer Zeile, dass diese Datei zum Baum passt.
--
-- Wiederholbar: jeder Eintrag des Baums per ON CONFLICT ("slug") DO UPDATE -- Name,
-- Reihenfolge und Eltern werden auf den Baum gesetzt, neue Kategorien angelegt. Ids und
-- Slugs bestehender Kategorien bleiben; ein zweiter Lauf aendert nichts. Eine eigene
-- Transaktion braucht es nicht: der drizzle-Migrator faehrt alle offenen Migrationen in
-- EINER Transaktion, ein Fehler hier laesst also alles beim Alten.
--
-- Reihenfolge zwingend:
--   1. Waechter: haengt ein Budget an einer entfallenen Kategorie, bricht der Umbau ab.
--      budget_kategorien loescht mit ON DELETE CASCADE -- der Topf verloere seine Zuordnung
--      samt Verlauf still. Stand 06.11.2026: kein Budget an einer Kategorie.
--   2. Oberkategorien (parent_id NULL), dann Unterkategorien mit parent_id per Unterabfrage
--      auf den slug der Oberkategorie (die muss schon stehen, sonst waere die Unterabfrage
--      NULL und das Kind faelschlich eine Oberkategorie). Der Zwei-Ebenen-Trigger aus 0010
--      laesst das Umhaengen zu: jede neue Oberkategorie ist selbst ohne Eltern, und
--      "buero-schreibwaren" (bisher Oberkategorie) hat keine Kinder.
--   3. Positionen der entfallenen Kategorien auf Unsortiert, OHNE Quelle und Konfidenz --
--      genau die Auswahl, die der Kategorie-Nachlauf (nachlauf.ts, offeneBons) neu
--      einsortiert. Produkte mit entfallener Standardkategorie ebenfalls auf Unsortiert.
--   4. Erst dann die entfallenen Kategorien loeschen. Haengt wider Erwarten noch etwas an
--      ihnen (ein Kind ausserhalb des Baums), bricht das parent_id-FK (RESTRICT) ab.

-- 1. Waechter
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "budget_kategorien" bk
      JOIN "categories" c ON c."id" = bk."category_id"
     WHERE c."slug" IN ('getraenke', 'haushalt', 'lebensmittel-suesswaren-snacks')
  ) THEN
    RAISE EXCEPTION 'Kategorien-Umbau 0035: ein Budget haengt an einer entfallenen Kategorie (getraenke, haushalt, lebensmittel-suesswaren-snacks) -- erst den Topf umhaengen, dann einspielen'
      USING ERRCODE = '23503';
  END IF;
END $$;

-- 2a. Oberkategorien
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Lebensmittel', 'lebensmittel', 0, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Süßes', 'suesses', 1, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Snacks', 'snacks', 2, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Hygiene', 'drogerie', 3, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Baby', 'baby', 4, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Medikamente', 'medikamente', 5, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Mobilität', 'mobilitaet', 6, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Baumarkt', 'baumarkt-werkzeug', 7, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Garten', 'garten-pflanzen', 8, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kleidung', 'kleidung-schuhe', 9, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Technik', 'elektronik-technik', 10, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Freizeit', 'freizeit', 11, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Tier', 'tier', 12, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Sonstiges', 'sonstiges', 13, NULL)
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";

-- 2b. Unterkategorien
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Obst & Gemüse', 'lebensmittel-obst-gemuese', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Brot & Backwaren', 'lebensmittel-brot-backwaren', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Milchprodukte & Eier', 'lebensmittel-milch-eier', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Fleisch & Wurst', 'lebensmittel-fleisch-wurst', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Fisch', 'lebensmittel-fisch', 4, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Tiefkühl', 'lebensmittel-tiefkuehl', 5, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Konserven & Vorrat', 'lebensmittel-konserven-vorrat', 6, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Grundnahrungsmittel', 'lebensmittel-grundnahrung', 7, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Gewürze & Saucen', 'lebensmittel-gewuerze-saucen', 8, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kaffee & Tee', 'lebensmittel-kaffee-tee', 9, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wasser', 'getraenke-wasser', 10, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Säfte', 'getraenke-saefte', 11, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Limonaden', 'getraenke-limonaden', 12, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Bier', 'getraenke-bier', 13, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wein & Spirituosen', 'getraenke-wein-spirituosen', 14, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Süßigkeiten', 'suesses-suessigkeiten', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'suesses'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Knabberzeug', 'snacks-knabberzeug', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'snacks'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Körperpflege', 'drogerie-koerperpflege', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Haarpflege', 'drogerie-haarpflege', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Zahnpflege', 'drogerie-zahnpflege', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Hygieneartikel', 'drogerie-hygiene', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kosmetik', 'drogerie-kosmetik', 4, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Reinigung', 'haushalt-reinigung', 5, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wäsche', 'haushalt-waesche', 6, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Papierwaren', 'haushalt-papierwaren', 7, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Babynahrung', 'lebensmittel-babynahrung', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'baby'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Babypflege', 'baby-pflege', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'baby'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Gesundheit & Apotheke', 'drogerie-gesundheit-apotheke', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'medikamente'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kraftstoff', 'mobilitaet-kraftstoff', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('ÖPNV', 'mobilitaet-oepnv', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Parken', 'mobilitaet-parken', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Küchenbedarf', 'haushalt-kuechenbedarf', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'baumarkt-werkzeug'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Büro & Schreibwaren', 'buero-schreibwaren', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'elektronik-technik'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Bücher & Medien', 'freizeit-buecher-medien', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Spielzeug', 'freizeit-spielzeug', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Sport', 'freizeit-sport', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Futter', 'tier-futter', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'tier'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Zubehör', 'tier-zubehoer', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'tier'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Pfand', 'sonstiges-pfand', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Rabatt', 'sonstiges-rabatt', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Unsortiert', 'sonstiges-unsortiert', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "name" = excluded."name", "sort" = excluded."sort", "parent_id" = excluded."parent_id";

-- 3. Positionen und Produkte der entfallenen Kategorien auf Unsortiert
UPDATE "receipt_items"
   SET "category_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges-unsortiert'), "category_source" = NULL, "confidence" = NULL
 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "slug" IN ('getraenke', 'haushalt', 'lebensmittel-suesswaren-snacks'));
UPDATE "products"
   SET "default_category_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges-unsortiert')
 WHERE "default_category_id" IN (SELECT "id" FROM "categories" WHERE "slug" IN ('getraenke', 'haushalt', 'lebensmittel-suesswaren-snacks'));

-- 4. Entfallene Kategorien loeschen
DELETE FROM "categories" WHERE "slug" IN ('getraenke', 'haushalt', 'lebensmittel-suesswaren-snacks');
