CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country_code" char(2),
	"location" geography(Point,4326) NOT NULL,
	"elevation_m" integer,
	"timezone" text NOT NULL,
	"type" text DEFAULT 'takeoff' NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"source_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sites_source_ref_unique" UNIQUE("source_ref"),
	CONSTRAINT "sites_type_check" CHECK ("sites"."type" IN ('takeoff', 'landing', 'both')),
	CONSTRAINT "sites_source_check" CHECK ("sites"."source" IN ('seed', 'user'))
);
--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "takeoff_point" geography(Point,4326);--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "landing_point" geography(Point,4326);--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sites_location_gist" ON "sites" USING gist ("location");--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_takeoff_site_id_sites_id_fk" FOREIGN KEY ("takeoff_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_landing_site_id_sites_id_fk" FOREIGN KEY ("landing_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;