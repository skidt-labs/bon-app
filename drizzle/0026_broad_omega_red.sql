CREATE TABLE "instanz" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"selbstbedienung" boolean DEFAULT true NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gesperrt_am" timestamp with time zone;