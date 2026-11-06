ALTER TABLE "award_history_records" ADD COLUMN "month_feel" text;--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "brain_version" integer;--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "notes_used" boolean;