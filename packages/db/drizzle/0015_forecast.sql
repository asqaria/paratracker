CREATE TABLE "site_forecasts" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"hours" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "wind_sectors" text[];--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "max_wind_ms" real;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "forecast" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_forecasts" ADD CONSTRAINT "site_forecasts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Первое место в прогнозе (решение владельца 29.09.2026): Уш-Коныр, сектор С/СВ/СЗ из paragliding.earth.
UPDATE "sites" SET "wind_sectors" = '{N,NE,NW}', "forecast" = true WHERE "source_ref" = 'pge:9773';
