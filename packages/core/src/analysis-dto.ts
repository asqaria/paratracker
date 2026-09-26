import { z } from 'zod';

import { GLIDE_KINDS, THERMAL_STRENGTHS, TURN_DIRECTIONS } from './derived.js';
import { AnalysisLevel, FlightStatus } from './flight.js';
import { GliderSummary } from './glider.js';
import { SiteSummary } from './site-dto.js';

/**
 * Контракт аналитики полёта (ТЗ §10): GET /flights/{id}, /thermals, /glides,
 * /wind. Всё в СИ, время — ISO 8601 в UTC, направления ветра — метеорологические,
 * «откуда дует». Строки БД наружу не отдаются (CLAUDE.md, «API»).
 */

const Iso = z.iso.datetime({ offset: true });
const Degrees = z.number().min(0).lt(360);

export const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type LatLon = z.infer<typeof LatLon>;

/** Ветер: скорость и направление, откуда дует. */
export const WindDto = z.object({ speedMs: z.number().min(0), dirDeg: Degrees });
export type WindDto = z.infer<typeof WindDto>;

/** Ответ GET /api/v1/flights/{id}: метаданные и агрегаты полёта. */
export const FlightDetailsResponse = z.object({
  flightId: z.uuid(),
  status: FlightStatus,
  /** null — полёт ещё не обработан. */
  analysisLevel: AnalysisLevel.nullable(),
  startedAt: Iso.nullable(),
  endedAt: Iso.nullable(),
  /**
   * IANA-таймзона места взлёта (задача 2.14): время хранится в UTC, местное —
   * только для показа. null — полёт не обработан.
   */
  timezone: z.string().nullable(),
  durationS: z.number().int().nullable(),
  /** null — анализа нет (трек basic или не обработан). */
  thermalCount: z.number().int().min(0).nullable(),
  avgClimbMs: z.number().nullable(),
  /** null — не было глайдов с потерей высоты (ТЗ §6.4). */
  avgGlideRatio: z.number().nullable(),
  wind: WindDto.nullable(),
  /** Место старта и посадки (задача 2.13); null — рядом нет известного места. */
  takeoffSite: SiteSummary.nullable(),
  landingSite: SiteSummary.nullable(),
  /** Крыло полёта (задача 2.13б); null — не указано. */
  glider: GliderSummary.nullable(),
  /** Модель крыла, записанная прибором (IGC HFGTY) — подсказка, когда крыло не выбрано. */
  gliderRaw: z.string().nullable(),
  /** Спрашивающий — владелец полёта: может добавить место, править полёт. */
  canEdit: z.boolean(),
});
export type FlightDetailsResponse = z.infer<typeof FlightDetailsResponse>;

export const ThermalDto = z.object({
  seq: z.number().int().min(0),
  startedAt: Iso,
  endedAt: Iso,
  durationS: z.number().int(),
  entryAltM: z.number().int(),
  exitAltM: z.number().int(),
  gainM: z.number().int(),
  avgClimbMs: z.number(),
  maxClimbMs: z.number(),
  turnCount: z.number(),
  avgRadiusM: z.number().int(),
  direction: z.enum(TURN_DIRECTIONS),
  efficiency: z.number(),
  strength: z.enum(THERMAL_STRENGTHS),
  entry: LatLon,
  exit: LatLon,
  /** Снос термика как ветер, откуда дует; null — один круг. */
  drift: WindDto.nullable(),
});
export type ThermalDto = z.infer<typeof ThermalDto>;

/** Ответ GET /api/v1/flights/{id}/thermals — по порядку в полёте. */
export const ThermalsResponse = z.object({ thermals: z.array(ThermalDto) });
export type ThermalsResponse = z.infer<typeof ThermalsResponse>;

export const GlideDto = z.object({
  seq: z.number().int().min(0),
  startedAt: Iso,
  endedAt: Iso,
  distanceM: z.number().int(),
  altLossM: z.number().int(),
  /** null — 'dynamic', высота почти не терялась (ТЗ §6.4). */
  glideRatio: z.number().nullable(),
  kind: z.enum(GLIDE_KINDS),
  avgSpeedMs: z.number(),
  /** null — вернулся в точку начала перехода. */
  headingDeg: Degrees.nullable(),
  headingConsistency: z.number().min(0).max(1),
});
export type GlideDto = z.infer<typeof GlideDto>;

/** Ответ GET /api/v1/flights/{id}/glides — по порядку в полёте. */
export const GlidesResponse = z.object({ glides: z.array(GlideDto) });
export type GlidesResponse = z.infer<typeof GlidesResponse>;

export const WindBandDto = z.object({
  altitudeBand: z.tuple([z.number(), z.number()]),
  windSpeedMs: z.number().min(0),
  windDirDeg: Degrees,
  confidence: z.number().min(0).max(1),
  circleCount: z.number().int().min(1),
});
export type WindBandDto = z.infer<typeof WindBandDto>;

/** Ответ GET /api/v1/flights/{id}/wind: ветер полёта и профиль снизу вверх. */
export const WindResponse = z.object({ flight: WindDto.nullable(), profile: z.array(WindBandDto) });
export type WindResponse = z.infer<typeof WindResponse>;
