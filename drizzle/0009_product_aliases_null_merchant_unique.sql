-- Handgeschrieben, NICHT von drizzle-kit erzeugt.
--
-- product_aliases_merchant_text_unique deckt (merchant_id, raw_text_normalized) ab.
-- PostgreSQL behandelt mehrere NULL-Werte in einem Unique-Index als verschieden
-- voneinander (Standardverhalten, kein NULLS NOT DISTINCT) — der Constraint greift
-- deshalb NICHT, sobald merchant_id NULL ist. haendlerAufloesen() liefert genau dann
-- null, wenn kein Haendlername gelesen wurde — ein haeufiger Fall, kein Ausnahmefall.
-- Fuer diese Bons liessen sich beliebig viele Aliase mit identischem Rohtext auf
-- UNTERSCHIEDLICHE Produkte anlegen; das Lerngedaechtnis zerfaellt dabei still in
-- Duplikate, ohne dass irgendwer einen Fehler sieht. Empirisch belegt in
-- .superpowers/sdd/2026-09-15-bon-app-phase-2-kategorien/task-2-review.md, Befund
-- "product_aliases".
--
-- Drizzle 0.45 kann einen partiellen Index (WHERE-Klausel) nicht ausdruecken, deshalb
-- handgeschrieben — analog zum bereits etablierten Muster der frueheren handgeschriebenen
-- Fremdschluessel-Korrektur in receipt_items (siehe schema.ts, Tabelle receiptItems).
-- Der bestehende zusammengesetzte Unique-Constraint bleibt unveraendert fuer den Fall
-- MIT Haendler; dieser Index deckt zusaetzlich den Fall OHNE Haendler ab.
CREATE UNIQUE INDEX "product_aliases_raw_text_no_merchant_unique"
  ON "product_aliases" ("raw_text_normalized")
  WHERE "merchant_id" IS NULL;
