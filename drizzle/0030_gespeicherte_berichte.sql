CREATE TABLE "gespeicherte_berichte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"zeitraum" jsonb,
	"erstellt_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gespeicherte_berichte_name_unique" UNIQUE("household_id","name")
);
--> statement-breakpoint
ALTER TABLE "gespeicherte_berichte" ADD CONSTRAINT "gespeicherte_berichte_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gespeicherte_berichte" ADD CONSTRAINT "gespeicherte_berichte_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;