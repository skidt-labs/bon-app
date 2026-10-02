ALTER TABLE "extraction_runs" ADD COLUMN "ki_rolle" text;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "kategorien_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "kategorien_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "kategorien_kosten_micro" integer;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "reserve_ki_anbieter" uuid;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "reserve_aktiv_seit" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "reserve_grenze_micro" integer DEFAULT 5000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "reserve_grenze_gemeldet" text;--> statement-breakpoint
ALTER TABLE "instanz" ADD CONSTRAINT "instanz_reserve_ki_anbieter_ki_anbieter_id_fk" FOREIGN KEY ("reserve_ki_anbieter") REFERENCES "public"."ki_anbieter"("id") ON DELETE restrict ON UPDATE no action;