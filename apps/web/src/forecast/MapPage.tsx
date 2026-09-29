import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { UserMenu } from '../auth/UserMenu';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { useLocaleStore, useT } from '../i18n/locale';
import { mapHash } from '../routing';
import { fetchImageryCapabilities } from '../viewer/imagery-capabilities';
import { FORECAST_QUERY_KEY, fetchForecastMap } from './forecast-api';
import { defaultHour, forecastDays } from './forecast-time';
import { kk7Layer, kk7TileUrl, type Kk7Kind } from './kk7';
import { SitePanel } from './SitePanel';

const ForecastMap = lazy(() => import('./ForecastMap'));

/** Тот же шаблон прокси Esri, что у 3D-сцены и логбука (VITE_ESRI_TILE_URL). */
const esriTileUrl = (): string | null => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = (env.VITE_ESRI_TILE_URL ?? '').trim();
  return value === '' ? null : value;
};

/** Шаблон тайлов карты термиков kk7 (VITE_THERMAL_TILE_URL, с {layer}); нет — слоёв нет. */
const thermalTileUrl = (): string | null => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = (env.VITE_THERMAL_TILE_URL ?? '').trim();
  return value === '' ? null : value;
};

/** Прогноз на час вперёд актуален: «сейчас» для списка часов — раз в минуту. */
const NOW_TICK_MS = 60_000;

interface MapPageProps {
  /** Открытое место из адреса (#/map?site=…); null — первое место. */
  site: string | null;
}

/**
 * Прогноз для пилотов (задача П.3, ТЗ §6.9): одна страница — карта мест
 * старта цветом по прогнозу, выбор дня и часа, панель места по часам.
 */
export function MapPage({ site }: MapPageProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const forecast = useQuery({ queryKey: FORECAST_QUERY_KEY, queryFn: () => fetchForecastMap() });
  const imagery = useQuery({ queryKey: ['imagery-capabilities'], queryFn: ({ signal }) => fetchImageryCapabilities(signal) });
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const sites = useMemo(() => forecast.data?.sites ?? [], [forecast.data]);
  const current = sites.find((s) => s.slug === site) ?? sites[0] ?? null;
  const days = useMemo(
    () => (current ? forecastDays(current.hours.map((h) => h.time), current.timezone, nowMs) : []),
    [current, nowMs],
  );
  const [chosenTime, setChosenTime] = useState<string | null>(null);
  const allTimes = days.flatMap((day) => day.hours.map((h) => h.time));
  const time = chosenTime !== null && allTimes.includes(chosenTime) ? chosenTime : (defaultHour(days)?.time ?? null);
  const dayKey = days.find((day) => day.hours.some((h) => h.time === time))?.dayKey ?? days[0]?.dayKey ?? null;
  const dayHours = days.find((day) => day.dayKey === dayKey)?.hours ?? [];
  // Карта термиков kk7: по умолчанию термики, коридоры — по кнопке.
  const [kk7Shown, setKk7Shown] = useState<Record<Kk7Kind, boolean>>({ thermals: true, skyways: false });
  const template = thermalTileUrl();
  const kk7Time = time === null ? nowMs : Date.parse(time);
  const kk7 = useMemo(() => {
    const url = (kind: Kk7Kind): string | null =>
      template === null || !current || !kk7Shown[kind] ? null : kk7TileUrl(template, kk7Layer(kind, current.lat, current.lon, kk7Time));
    return { thermals: url('thermals'), skyways: url('skyways') };
  }, [template, current, kk7Shown, kk7Time]);
  const dayLabel = (key: string, timezone: string): string =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone }).format(
      new Date(`${key}T12:00:00Z`),
    );

  return (
    <main lang={locale} className="flex h-dvh w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 compact:px-3">
        <h1 className="text-lg font-semibold">
          <a href="#/">{t('app.name')}</a>
          <span className="ml-3 font-normal text-secondary">{t('forecast.title')}</span>
        </h1>
        <div className="flex items-center gap-3">
          <UserMenu />
          <LocaleSwitch />
        </div>
      </header>

      {forecast.isError && (
        <p role="alert" className="px-6 text-danger">
          {t('forecast.error')}
        </p>
      )}
      {forecast.isSuccess && sites.length === 0 && <p className="px-6 text-secondary">{t('forecast.empty')}</p>}

      <div className="flex min-h-0 flex-1 compact:flex-col">
        <div className="relative min-h-0 flex-1 compact:flex-none">
          <div className="h-full w-full compact:h-[40dvh]">
          <Suspense fallback={<div className="h-full w-full bg-subtle" />}>
            <ForecastMap
              sites={sites}
              time={time}
              selected={current?.slug ?? null}
              onSelect={(slug) => {
                window.location.hash = mapHash(slug);
              }}
              esriTileUrl={imagery.data?.esri === true ? esriTileUrl() : null}
              kk7={kk7}
            />
          </Suspense>
          </div>

          {template !== null && (
            <div data-panel="forecast-layers" className="absolute left-3 top-3 flex gap-1 rounded-xl glass p-1 text-sm">
              {(['thermals', 'skyways'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={kk7Shown[kind]}
                  onClick={() => setKk7Shown((shown) => ({ ...shown, [kind]: !shown[kind] }))}
                  className="rounded px-3 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
                >
                  {t(`forecast.layer.${kind}`)}
                </button>
              ))}
            </div>
          )}

          {current && days.length > 0 && (
            <div data-panel="forecast-time" className="absolute bottom-8 left-3 right-3 flex flex-col gap-2 rounded-xl glass p-2 text-sm compact:static compact:m-2 compact:mb-0">
              <div role="tablist" aria-label={t('forecast.day')} className="flex gap-1">
                {days.map((day) => (
                  <button
                    key={day.dayKey}
                    type="button"
                    role="tab"
                    aria-selected={day.dayKey === dayKey}
                    onClick={() => setChosenTime(day.hours[0]?.time ?? null)}
                    className="rounded px-3 py-1 text-secondary aria-selected:bg-subtle aria-selected:text-primary compact:min-h-11"
                  >
                    {dayLabel(day.dayKey, current.timezone)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 overflow-x-auto" aria-label={t('forecast.hour')}>
                {dayHours.map((h) => (
                  <button
                    key={h.time}
                    type="button"
                    aria-pressed={h.time === time}
                    onClick={() => setChosenTime(h.time)}
                    className="numeric min-w-9 rounded px-1.5 py-1 text-secondary aria-pressed:bg-accent aria-pressed:text-void compact:min-h-11"
                  >
                    {String(h.hour).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {current && (
          <aside
            data-panel="forecast-site"
            className="w-[28rem] shrink-0 overflow-y-auto border-l border-subtle p-4 compact:w-full compact:border-l-0 compact:border-t"
          >
            <SitePanel slug={current.slug} dayHours={dayHours} time={time} onTime={setChosenTime} attribution={forecast.data?.attribution ?? ''} />
          </aside>
        )}
      </div>
    </main>
  );
}
