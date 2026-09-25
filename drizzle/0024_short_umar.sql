ALTER TABLE "users" DROP CONSTRAINT "users_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "household_id";