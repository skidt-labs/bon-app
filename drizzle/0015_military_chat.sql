CREATE TABLE "budget_betraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"gilt_ab" date NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "budget_betraege_ab_unique" UNIQUE("budget_id","gilt_ab")
);
--> statement-breakpoint
CREATE TABLE "budget_kategorien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"gilt_ab" date NOT NULL,
	"gilt_bis" date
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_betraege" ADD CONSTRAINT "budget_betraege_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_kategorien" ADD CONSTRAINT "budget_kategorien_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_kategorien" ADD CONSTRAINT "budget_kategorien_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_kategorien" ADD CONSTRAINT "budget_kategorien_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_kategorien_aktiv_unique" ON "budget_kategorien" USING btree ("household_id","category_id") WHERE gilt_bis is null;