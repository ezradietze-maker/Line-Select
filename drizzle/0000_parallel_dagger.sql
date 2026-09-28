CREATE TABLE "award_history_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"seniority_rank" integer NOT NULL,
	"seniority_total_pilots" integer NOT NULL,
	"outcome" text NOT NULL,
	"line_number" text,
	"days_off" integer,
	"total_credit_hours" integer,
	"total_tafb_hours" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pilot_id" text NOT NULL,
	"raw_quote" text NOT NULL,
	"proposed_name" text NOT NULL,
	"proposed_description" text NOT NULL,
	"favored_line_number" text NOT NULL,
	"overtaken_line_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"salt" text NOT NULL,
	"recovery_hash" text,
	"recovery_salt" text,
	CONSTRAINT "credentials_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pilot_id" text,
	"pilot_display_name" text,
	"pilot_email" text,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"page" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_key" text NOT NULL,
	"user_hash" text NOT NULL,
	"bid_number" integer NOT NULL,
	"seniority" integer NOT NULL,
	"ranking" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_candidate_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pilot_id" text,
	"raw_statement" text NOT NULL,
	"proposed_name" text NOT NULL,
	"proposed_description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "password_reset_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "preference_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"offering_user_id" uuid NOT NULL,
	"offering_display_name" text NOT NULL,
	"offered_trip" jsonb NOT NULL,
	"wanted_pairing_number" text,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"responder_user_id" uuid,
	"responder_display_name" text,
	"responder_trip" jsonb,
	"responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_profiles" ADD CONSTRAINT "preference_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_offering_user_id_users_id_fk" FOREIGN KEY ("offering_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_responder_user_id_users_id_fk" FOREIGN KEY ("responder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "award_history_base_aircraft_seat_idx" ON "award_history_records" USING btree ("base","aircraft","seat");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_rankings_blob_bid_idx" ON "forecast_rankings" USING btree ("blob_key","bid_number");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_rankings_blob_user_idx" ON "forecast_rankings" USING btree ("blob_key","user_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_offers_status_idx" ON "trade_offers" USING btree ("status");