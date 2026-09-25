ALTER TABLE "extraction_runs" ADD COLUMN "ocr_engine" text;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "ocr_engine_version" text;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "ocr_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "ocr_options" jsonb;