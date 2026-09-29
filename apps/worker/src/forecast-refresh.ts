import { evaluateForecast } from '@skyline/analysis';
import { FORECAST, TIME, type ForecastHour, type ForecastModel, type ModelSeries } from '@skyline/core';
import type { ForecastSiteRecord } from '@skyline/db';
import { geoidHeightM, openMeteoHourlyFields, parseOpenMeteo, withLevelsFrom, type OpenMeteoWarning } from '@skyline/parsing';

/**
 * Загрузка прогноза по местам (ТЗ §6.9, задача П.2): раз в
 * FORECAST.refreshIntervalS на место — четыре запроса к Open-Meteo, разбор,
 * оценка по часам, запись. Сеть и немного арифметики (4 × 72 часа) — в
 * основном потоке воркера, как уборка анонимных загрузок.
 */

/** Модели Open-Meteo: ECMWF — две (9 км без уровней давления + 0,25° с уровнями). */
const REQUESTS = [
  { id: 'ecmwf_ifs', model: 'ecmwf' },
  { id: 'ecmwf_ifs025', model: 'ecmwf' },
  { id: 'gfs_seamless', model: 'gfs' },
  { id: 'icon_global', model: 'icon' },
] as const satisfies readonly { id: string; model: ForecastModel }[];

export interface ForecastRefreshOptions {
  repository: {
    listSites(): Promise<ForecastSiteRecord[]>;
    save(siteId: string, fetchedAt: Date, hours: ForecastHour[]): Promise<void>;
  };
  /** GET и JSON; внедряется ради теста. */
  fetchJson: (url: string) => Promise<unknown>;
  /** Адрес /v1/forecast Open-Meteo — из конфига. */
  apiUrl: string;
  now: () => number;
  onError: (error: unknown, siteId?: string) => void;
  onWarnings?: (warnings: OpenMeteoWarning[], siteId: string, model: string) => void;
}

export interface ForecastRefresh {
  /** Обновить устаревшие; вернуть, сколько мест обновлено. */
  run(): Promise<number>;
}

/**
 * Запрос одной модели. Высоту места Open-Meteo ждёт над уровнем моря (ею
 * приводит приземные поля к высоте старта), у нас она над эллипсоидом: H = h − N.
 */
export function forecastUrl(apiUrl: string, site: ForecastSiteRecord, modelId: string): string {
  const url = new URL(apiUrl);
  url.searchParams.set('latitude', String(site.lat));
  url.searchParams.set('longitude', String(site.lon));
  if (site.elevationM !== null) url.searchParams.set('elevation', String(Math.round(site.elevationM - geoidHeightM(site.lat, site.lon))));
  url.searchParams.set('models', modelId);
  url.searchParams.set('forecast_days', String(FORECAST.days));
  url.searchParams.set('timezone', 'GMT');
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('hourly', openMeteoHourlyFields().join(','));
  return url.toString();
}

const REFRESH_MS = FORECAST.refreshIntervalS * TIME.msPerSecond;

export function createForecastRefresh(options: ForecastRefreshOptions): ForecastRefresh {
  const { repository, fetchJson, apiUrl, now, onError, onWarnings } = options;

  const refreshSite = async (site: ForecastSiteRecord): Promise<void> => {
    const parsed = new Map<string, ModelSeries>();
    for (const request of REQUESTS) {
      const { series, warnings } = parseOpenMeteo(await fetchJson(forecastUrl(apiUrl, site, request.id)), request.model);
      if (warnings.length > 0) onWarnings?.(warnings, site.id, request.id);
      if (series) parsed.set(request.id, series);
    }
    const ecmwfSurface = parsed.get('ecmwf_ifs');
    const ecmwfUpper = parsed.get('ecmwf_ifs025');
    const ecmwf = ecmwfSurface && ecmwfUpper ? withLevelsFrom(ecmwfSurface, ecmwfUpper) : (ecmwfSurface ?? ecmwfUpper);
    const series = [ecmwf, parsed.get('gfs_seamless'), parsed.get('icon_global')].filter((s): s is ModelSeries => s !== undefined);
    if (series.length === 0) throw new Error('no forecast model answered');
    const hours = evaluateForecast(series, {
      // Высоты нет в базе — берётся та, к которой привела поля главная модель.
      elevationM: site.elevationM ?? series[0]?.surfaceM ?? 0,
      windSectors: site.windSectors,
      maxWindMs: site.maxWindMs,
    });
    await repository.save(site.id, new Date(now()), hours);
  };

  return {
    async run() {
      const due = (await repository.listSites()).filter((site) => site.fetchedAt === null || now() - site.fetchedAt.getTime() >= REFRESH_MS);
      let refreshed = 0;
      for (const site of due) {
        try {
          await refreshSite(site);
          refreshed++;
        } catch (error) {
          // Одно место упало — остальные обновляются; оно само повторится на следующей проверке.
          onError(error, site.id);
        }
      }
      return refreshed;
    },
  };
}
