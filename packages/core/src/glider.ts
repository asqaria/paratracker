import { z } from 'zod';

/**
 * Крылья пилота (ТЗ §9 gliders, задача 2.13б). Полёт привязывается к крылу:
 * у нового полёта — крыло по умолчанию, пилот может сменить.
 */

/** Класс крыла: EN 926-2 (A–D) и CCC — соревновательные вне EN. */
export const GLIDER_CERTIFICATIONS = ['EN-A', 'EN-B', 'EN-C', 'EN-D', 'CCC'] as const;
export const GliderCertification = z.enum(GLIDER_CERTIFICATIONS);
export type GliderCertification = z.infer<typeof GliderCertification>;

export const GLIDER = {
  /** Производитель и модель: «Ozone», «Rush 6» — короткие; 60 — с запасом на «Advance Sigma DLS». */
  nameMaxLength: 60,
  /** Размер: «ML», «23», «XS-S». */
  sizeMaxLength: 10,
  /** Крыльев у одного пилота — десятки за жизнь, не сотни. */
  maxPerUser: 50,
} as const;

const Text = (max: number) => z.string().trim().min(1).max(max);

/** POST /api/v1/gliders и PATCH /api/v1/gliders/{id}. */
export const GliderInput = z.object({
  manufacturer: Text(GLIDER.nameMaxLength),
  model: Text(GLIDER.nameMaxLength),
  size: Text(GLIDER.sizeMaxLength).nullable().default(null),
  certification: GliderCertification.nullable().default(null),
  /** Крыло по умолчанию: его получают новые полёты. У пилота одно такое. */
  isDefault: z.boolean().default(false),
});
export type GliderInput = z.infer<typeof GliderInput>;

export const GliderDto = z.object({
  id: z.uuid(),
  manufacturer: z.string(),
  model: z.string(),
  size: z.string().nullable(),
  certification: GliderCertification.nullable(),
  isDefault: z.boolean(),
});
export type GliderDto = z.infer<typeof GliderDto>;

export const GlidersResponse = z.object({ gliders: z.array(GliderDto) });
export type GlidersResponse = z.infer<typeof GlidersResponse>;

/** Крыло в карточке полёта и строке логбука. */
export const GliderSummary = z.object({ id: z.uuid(), label: z.string() });
export type GliderSummary = z.infer<typeof GliderSummary>;

/** PATCH /api/v1/flights/{id}: пока только крыло; null — отвязать. */
export const FlightPatch = z.object({ gliderId: z.uuid().nullable() });
export type FlightPatch = z.infer<typeof FlightPatch>;

/** «Ozone Rush 6 ML» — как пилоты называют крыло. */
export const gliderLabel = (glider: Pick<GliderDto, 'manufacturer' | 'model' | 'size'>): string =>
  [glider.manufacturer, glider.model, glider.size].filter((part) => part !== null && part !== '').join(' ');
