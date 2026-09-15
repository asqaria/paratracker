-- Расширения, от которых зависит схема (ТЗ §9). Образ postgis/postgis ставит postgis сам,
-- но прод-база не обязана быть из этого образа — поэтому явно и идемпотентно.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
