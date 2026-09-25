ALTER TABLE "extraction_runs" ADD COLUMN "ocr_zeilen" jsonb;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "ocr_zeile" integer;