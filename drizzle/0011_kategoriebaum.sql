-- Handgeschrieben, NICHT von drizzle-kit erzeugt.
--
-- Startbestand des Kategoriebaums (Entwurf, Abschnitt "Kategoriebaum (Startbestand,
-- zweistufig)"). Einzige Quelle ist src/lib/server/kategorien/baum.ts; diese Datei
-- wird von dort per Skript erzeugt, damit Migration und Code nie auseinanderlaufen.
--
-- Startbestand, keine Schemaaenderung: gehoert einmal in die Datenbank und muss bei
-- einem erneuten Einspielen dasselbe Ergebnis liefern. Deshalb ON CONFLICT (slug) DO
-- UPDATE (No-Op-Update auf slug=excluded.slug) statt DO NOTHING oder "nachsehen, dann
-- einfuegen" -- dasselbe Upsert-Muster wie ensureDefaultHousehold() in household.ts
-- und haendlerAufloesen() in merchants.ts.
--
-- Reihenfolge zwingend: erst alle Oberkategorien (parent_id NULL), danach die
-- Unterkategorien mit parent_id per Unterabfrage auf den slug der Oberkategorie --
-- die Oberkategorie muss zu diesem Zeitpunkt bereits existieren, sonst liefert die
-- Unterabfrage NULL und der Trigger categories_enforce_two_levels_trg akzeptiert das
-- klaglos (NULL parent_id = Oberkategorie) -- die Unterkategorie waere dann selbst faelschlich
-- eine Oberkategorie.

-- Oberkategorien
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Lebensmittel', 'lebensmittel', 0)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Getränke', 'getraenke', 1)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Drogerie', 'drogerie', 2)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Haushalt', 'haushalt', 3)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Tier', 'tier', 4)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Garten & Pflanzen', 'garten-pflanzen', 5)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Kleidung & Schuhe', 'kleidung-schuhe', 6)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Elektronik & Technik', 'elektronik-technik', 7)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Baumarkt & Werkzeug', 'baumarkt-werkzeug', 8)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Büro & Schreibwaren', 'buero-schreibwaren', 9)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Freizeit', 'freizeit', 10)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Mobilität', 'mobilitaet', 11)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort") VALUES ('Sonstiges', 'sonstiges', 12)
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";

-- Unterkategorien
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Obst & Gemüse', 'lebensmittel-obst-gemuese', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Brot & Backwaren', 'lebensmittel-brot-backwaren', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Milchprodukte & Eier', 'lebensmittel-milch-eier', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Fleisch & Wurst', 'lebensmittel-fleisch-wurst', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Fisch', 'lebensmittel-fisch', 4, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Tiefkühl', 'lebensmittel-tiefkuehl', 5, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Konserven & Vorrat', 'lebensmittel-konserven-vorrat', 6, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Grundnahrungsmittel', 'lebensmittel-grundnahrung', 7, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Gewürze & Saucen', 'lebensmittel-gewuerze-saucen', 8, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Süßwaren & Snacks', 'lebensmittel-suesswaren-snacks', 9, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kaffee & Tee', 'lebensmittel-kaffee-tee', 10, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Babynahrung', 'lebensmittel-babynahrung', 11, (SELECT "id" FROM "categories" WHERE "slug" = 'lebensmittel'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wasser', 'getraenke-wasser', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'getraenke'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Säfte', 'getraenke-saefte', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'getraenke'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Limonaden', 'getraenke-limonaden', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'getraenke'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Bier', 'getraenke-bier', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'getraenke'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wein & Spirituosen', 'getraenke-wein-spirituosen', 4, (SELECT "id" FROM "categories" WHERE "slug" = 'getraenke'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Körperpflege', 'drogerie-koerperpflege', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Haarpflege', 'drogerie-haarpflege', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Zahnpflege', 'drogerie-zahnpflege', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Hygiene', 'drogerie-hygiene', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kosmetik', 'drogerie-kosmetik', 4, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Gesundheit & Apotheke', 'drogerie-gesundheit-apotheke', 5, (SELECT "id" FROM "categories" WHERE "slug" = 'drogerie'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Reinigung', 'haushalt-reinigung', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'haushalt'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Wäsche', 'haushalt-waesche', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'haushalt'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Küchenbedarf', 'haushalt-kuechenbedarf', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'haushalt'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Papierwaren', 'haushalt-papierwaren', 3, (SELECT "id" FROM "categories" WHERE "slug" = 'haushalt'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Futter', 'tier-futter', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'tier'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Zubehör', 'tier-zubehoer', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'tier'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Bücher & Medien', 'freizeit-buecher-medien', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Spielzeug', 'freizeit-spielzeug', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Sport', 'freizeit-sport', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'freizeit'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Kraftstoff', 'mobilitaet-kraftstoff', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('ÖPNV', 'mobilitaet-oepnv', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Parken', 'mobilitaet-parken', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'mobilitaet'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Pfand', 'sonstiges-pfand', 0, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Rabatt', 'sonstiges-rabatt', 1, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
INSERT INTO "categories" ("name", "slug", "sort", "parent_id") VALUES ('Unsortiert', 'sonstiges-unsortiert', 2, (SELECT "id" FROM "categories" WHERE "slug" = 'sonstiges'))
  ON CONFLICT ("slug") DO UPDATE SET "slug" = excluded."slug";
