CREATE TABLE "forecast_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pilot_hash" text NOT NULL,
	"blob_key" text NOT NULL,
	"pack_key" text NOT NULL,
	"bid_number" integer NOT NULL,
	"total_pilots" integer NOT NULL,
	"ranking" jsonb NOT NULL,
	"p_available" jsonb NOT NULL,
	"model_version" text
);
--> statement-breakpoint
CREATE TABLE "interview_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pilot_hash" text,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"commute" text NOT NULL,
	"seniority_band" text NOT NULL,
	"model_version" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learned_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"sample_size" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_features" (
	"blob_key" text PRIMARY KEY NOT NULL,
	"pack_key" text NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"line_numbers" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pilot_hash" text,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"dim" text NOT NULL,
	"src" text NOT NULL,
	"from_value" integer NOT NULL,
	"to_value" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "pilot_hash" text;--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "pack_key" text;--> statement-breakpoint
ALTER TABLE "award_history_records" ADD COLUMN "awarded_choice" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_predictions_pilot_blob_idx" ON "forecast_predictions" USING btree ("pilot_hash","blob_key");--> statement-breakpoint
CREATE INDEX "forecast_predictions_pack_idx" ON "forecast_predictions" USING btree ("pack_key");--> statement-breakpoint
CREATE INDEX "interview_outcomes_pack_idx" ON "interview_outcomes" USING btree ("base","aircraft","seat");--> statement-breakpoint
CREATE INDEX "interview_outcomes_created_idx" ON "interview_outcomes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "learned_models_kind_active_idx" ON "learned_models" USING btree ("kind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "learned_models_kind_version_idx" ON "learned_models" USING btree ("kind","version");--> statement-breakpoint
CREATE INDEX "pack_features_pack_idx" ON "pack_features" USING btree ("pack_key");--> statement-breakpoint
CREATE INDEX "preference_corrections_created_idx" ON "preference_corrections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "award_history_pilot_idx" ON "award_history_records" USING btree ("pilot_hash");