CREATE TABLE "trade_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"base" text NOT NULL,
	"aircraft" text NOT NULL,
	"seat" text NOT NULL,
	"month" text NOT NULL,
	"line_number" text,
	"trips" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"suggest_me" boolean DEFAULT true NOT NULL,
	"email_matches" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_holdings" ADD CONSTRAINT "trade_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_preferences" ADD CONSTRAINT "trade_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_holdings_user_pack_idx" ON "trade_holdings" USING btree ("user_id","pack_id");--> statement-breakpoint
CREATE INDEX "trade_holdings_group_idx" ON "trade_holdings" USING btree ("base","aircraft","seat","month");