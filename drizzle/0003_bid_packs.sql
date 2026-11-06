CREATE TABLE "bid_packs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bid_packs" ADD CONSTRAINT "bid_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;