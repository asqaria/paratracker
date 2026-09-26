CREATE TABLE "glides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"distance_m" integer NOT NULL,
	"alt_loss_m" integer NOT NULL,
	"glide_ratio" numeric(6, 2),
	"kind" text NOT NULL,
	"avg_speed_ms" numeric(5, 2) NOT NULL,
	"heading_deg" integer,
	"heading_consistency" numeric(3, 2) NOT NULL,
	CONSTRAINT "glides_kind_check" CHECK ("glides"."kind" IN ('glide', 'dynamic'))
);
--> statement-breakpoint
CREATE TABLE "thermals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"entry_alt_m" integer NOT NULL,
	"exit_alt_m" integer NOT NULL,
	"gain_m" integer NOT NULL,
	"avg_climb_ms" numeric(4, 2) NOT NULL,
	"max_climb_ms" numeric(4, 2) NOT NULL,
	"turn_count" numeric(4, 1) NOT NULL,
	"avg_radius_m" integer NOT NULL,
	"direction" text NOT NULL,
	"efficiency" numeric(3, 2) NOT NULL,
	"entry_point" geography(Point,4326) NOT NULL,
	"exit_point" geography(Point,4326) NOT NULL,
	"drift_dir_deg" integer,
	"drift_speed_ms" numeric(4, 2),
	CONSTRAINT "thermals_direction_check" CHECK ("thermals"."direction" IN ('cw', 'ccw'))
);
--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "wind_profile" jsonb;--> statement-breakpoint
ALTER TABLE "glides" ADD CONSTRAINT "glides_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermals" ADD CONSTRAINT "thermals_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "glides_flight_seq_idx" ON "glides" USING btree ("flight_id","seq");--> statement-breakpoint
CREATE INDEX "thermals_flight_seq_idx" ON "thermals" USING btree ("flight_id","seq");--> statement-breakpoint
CREATE INDEX "thermals_entry_point_gist" ON "thermals" USING gist ("entry_point");