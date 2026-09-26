import { SAME_DAY, SITE } from '@skyline/core';
import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';

/**
 * Полёты того же дня с того же места (задача 3.12в). «Тот же день» — местная
 * дата старта (local_date, задача 2.14), «то же место» — то же место старта
 * или взлёт не дальше SITE.matchRadiusM (у полёта без места из базы).
 * Видно только публичное и своё: приватность решает база, а не фронт.
 */

export interface SameDayRecord {
  flightId: string;
  pilotName: string | null;
  startedAt: Date | null;
  timezone: string | null;
  airtimeS: number | null;
  distanceTrackM: number | null;
  xcScore: number | null;
  own: boolean;
}

interface SameDayRow extends Record<string, unknown> {
  flight_id: string;
  pilot_name: string | null;
  started_at: Date | string | null;
  timezone: string | null;
  airtime_s: number | null;
  distance_track_m: number | null;
  xc_score: string | number | null;
  own: boolean;
}

export async function listSameDayFlights(db: Database, flightId: string, viewerId: string | null): Promise<SameDayRecord[]> {
  const result = await db.execute<SameDayRow>(sql`
    select f.id as flight_id,
           coalesce(u.display_name, u.username::text, f.pilot_name_raw) as pilot_name,
           f.started_at, f.timezone, f.airtime_s, f.distance_track_m, f.xc_score,
           (${viewerId}::uuid is not null and f.user_id = ${viewerId}::uuid) as own
    from flights ref
    join flights f on f.local_date = ref.local_date and f.id <> ref.id
    left join users u on u.id = f.user_id
    where ref.id = ${flightId}
      and f.status = 'ready' and f.airtime_s > 0
      and (f.takeoff_site_id = ref.takeoff_site_id
           or st_dwithin(f.takeoff_point, ref.takeoff_point, ${SITE.matchRadiusM}))
      and (f.privacy = 'public' or (${viewerId}::uuid is not null and f.user_id = ${viewerId}::uuid))
    order by f.started_at
    limit ${SAME_DAY.maxFlights}
  `);
  return result.rows.map((row) => ({
    flightId: row.flight_id,
    pilotName: row.pilot_name,
    startedAt: row.started_at === null ? null : new Date(row.started_at),
    timezone: row.timezone,
    airtimeS: row.airtime_s,
    distanceTrackM: row.distance_track_m,
    xcScore: row.xc_score === null ? null : Number(row.xc_score),
    own: row.own,
  }));
}
