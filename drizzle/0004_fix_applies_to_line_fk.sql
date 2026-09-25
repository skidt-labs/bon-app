-- Handgeschrieben, NICHT von drizzle-kit erzeugt.
--
-- Der zusammengesetzte Self-FK hatte ON DELETE SET NULL ohne Spaltenliste. Postgres
-- nullt dabei ALLE referenzierenden Spalten, also auch receipt_id — und die ist
-- NOT NULL. Folge: Eine referenzierte Bonzeile liess sich nicht loeschen, und damit
-- auch der ganze Bon nicht. Reproduziert am 2026-09-14.
--
-- PostgreSQL 15+ erlaubt eine Spaltenliste; Drizzle 0.45 kann das nicht ausdruecken.
-- Ein spaeteres db:generate darf diesen Constraint NICHT zurueckdrehen.
ALTER TABLE "receipt_items" DROP CONSTRAINT "receipt_items_applies_to_line_fk";--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_applies_to_line_fk"
  FOREIGN KEY ("receipt_id","applies_to_line")
  REFERENCES "public"."receipt_items"("receipt_id","line_no")
  ON DELETE SET NULL ("applies_to_line") ON UPDATE NO ACTION;
