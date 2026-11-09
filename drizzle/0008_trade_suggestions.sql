CREATE TABLE "trade_suggestion_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"position" integer NOT NULL,
	"give" jsonb NOT NULL,
	"value" jsonb NOT NULL,
	"answer" text DEFAULT 'waiting' NOT NULL,
	"decline_reason" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trade_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature" text,
	"pack_id" text NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"cancel_reason" text,
	"steps" jsonb NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trade_suggestion_members" ADD CONSTRAINT "trade_suggestion_members_suggestion_id_trade_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."trade_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_suggestion_members" ADD CONSTRAINT "trade_suggestion_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_suggestion_members_position_idx" ON "trade_suggestion_members" USING btree ("suggestion_id","position");--> statement-breakpoint
CREATE INDEX "trade_suggestion_members_user_idx" ON "trade_suggestion_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_suggestions_signature_idx" ON "trade_suggestions" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "trade_suggestions_group_idx" ON "trade_suggestions" USING btree ("base","aircraft","seat","month");