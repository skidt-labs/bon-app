CREATE TYPE "public"."ki_weg" AS ENUM('text', 'bild');--> statement-breakpoint
CREATE TABLE "betriebsprotokoll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zeit" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"aktion" text NOT NULL,
	"ziel" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "ki_anbieter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"weg" "ki_weg" NOT NULL,
	"base_url" text NOT NULL,
	"modell" text NOT NULL,
	"schluessel_enc" "bytea",
	"schluessel_ende" text,
	"zeitlimit_ms" integer NOT NULL,
	"preis_ein_micro" integer,
	"preis_aus_micro" integer,
	"zuletzt_getestet" timestamp with time zone,
	"test_ok" boolean,
	"test_ergebnis" text,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "ki_anbieter_id" uuid;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "aktiver_ki_anbieter" uuid;--> statement-breakpoint
ALTER TABLE "instanz" ADD COLUMN "ki_stand" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "betriebsprotokoll" ADD CONSTRAINT "betriebsprotokoll_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "betriebsprotokoll_zeit_idx" ON "betriebsprotokoll" USING btree ("zeit");--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_ki_anbieter_id_ki_anbieter_id_fk" FOREIGN KEY ("ki_anbieter_id") REFERENCES "public"."ki_anbieter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instanz" ADD CONSTRAINT "instanz_aktiver_ki_anbieter_ki_anbieter_id_fk" FOREIGN KEY ("aktiver_ki_anbieter") REFERENCES "public"."ki_anbieter"("id") ON DELETE restrict ON UPDATE no action;