CREATE TABLE "thermal_reviews" (
	"flight_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"labels" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thermal_reviews" ADD CONSTRAINT "thermal_reviews_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reviews" ADD CONSTRAINT "thermal_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;