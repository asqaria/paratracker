CREATE TABLE "gliders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"size" text,
	"certification" text,
	"purchased_at" date,
	"retired_at" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gliders_certification_check" CHECK ("gliders"."certification" IN ('EN-A', 'EN-B', 'EN-C', 'EN-D', 'CCC'))
);
--> statement-breakpoint
ALTER TABLE "gliders" ADD CONSTRAINT "gliders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gliders_user_idx" ON "gliders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gliders_one_default_idx" ON "gliders" USING btree ("user_id") WHERE "gliders"."is_default";--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_glider_id_gliders_id_fk" FOREIGN KEY ("glider_id") REFERENCES "public"."gliders"("id") ON DELETE set null ON UPDATE no action;