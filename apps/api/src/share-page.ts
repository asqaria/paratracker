import type { SharePreviewRecord } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { API_V1_PREFIX } from './constants.js';
import { problem, sendProblem } from './problem.js';

/**
 * Ссылка «поделиться» для мессенджеров (задача 3.8). Telegram, WhatsApp и
 * соцсети не видят часть адреса после # и не исполняют JS — им нужна страница
 * с Open Graph по адресу /s/{токен}: заголовок, подпись и картинка полёта.
 * Человека та же страница сразу отправляет в просмотрщик (/#/s/{токен}).
 * Мессенджеры переадресацию на уровне HTML не выполняют — карточка остаётся.
 */

export interface SharePageDeps {
  /** Полёт по ссылке; личный («только я») и несуществующий — null. */
  find(token: string): Promise<SharePreviewRecord | null>;
  storage: { get(key: string): Promise<Uint8Array> };
  /** https://skyline.gateapp.kz — абсолютные адреса в og:*: мессенджеры относительные не понимают. */
  publicUrl: string;
}

const HTTP = { ok: 200, notFound: 404 } as const;
const TokenParams = z.object({ token: z.string().min(1).max(64) });
/** Размер превью (apps/worker PREVIEW): по нему мессенджер резервирует место до загрузки. */
const PREVIEW_IMAGE = { width: 1200, height: 630 } as const;
/**
 * Картинку кешируют ненадолго: ссылку могут сбросить или полёт сделать личным,
 * а общий кеш после этого ещё показывал бы превью.
 */
const PREVIEW_CACHE_S = 300;
const BRAND = 'Skyline';

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const METRES_PER_KM = 1000;

type PageLocale = 'ru' | 'en';

const TEXT = {
  ru: {
    flight: 'Полёт',
    notFound: 'Ссылка не найдена',
    hours: 'ч',
    minutes: 'мин',
    km: 'км',
    m: 'м',
    airtime: 'в воздухе',
    track: 'по треку',
    points: 'очк.',
    maxAlt: 'макс.',
    open: 'Открыть полёт',
  },
  en: {
    flight: 'Flight',
    notFound: 'Link not found',
    hours: 'h',
    minutes: 'min',
    km: 'km',
    m: 'm',
    airtime: 'airtime',
    track: 'track',
    points: 'pts',
    maxAlt: 'max',
    open: 'Open flight',
  },
} as const satisfies Record<PageLocale, Record<string, string>>;

/** Язык подписи: английский — если браузер или бот о нём просит, иначе русский. */
export function pageLocale(acceptLanguage: string | undefined): PageLocale {
  return acceptLanguage?.trim().toLowerCase().startsWith('en') ? 'en' : 'ru';
}

const escapeHtml = (text: string): string =>
  text.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' })[ch] ?? ch);

/** Заголовок и подпись карточки. СИ из базы → км, «ч мин» — только здесь, на границе показа. */
export function shareCard(flight: SharePreviewRecord, locale: PageLocale): { title: string; description: string } {
  const t = TEXT[locale];
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  const date = flight.startedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: flight.timezone ?? 'UTC' }).format(flight.startedAt)
    : null;
  const title = [flight.siteName ?? t.flight, date].filter((part) => part !== null).join(' · ');

  const parts: string[] = [];
  if (flight.airtimeS !== null && flight.airtimeS > 0) {
    const totalMin = Math.round(flight.airtimeS / SECONDS_PER_MINUTE);
    const hours = Math.floor(totalMin / MINUTES_PER_HOUR);
    const minutes = totalMin % MINUTES_PER_HOUR;
    const duration = hours > 0 ? `${hours} ${t.hours} ${minutes} ${t.minutes}` : `${minutes} ${t.minutes}`;
    parts.push(`${duration} ${t.airtime}`);
  }
  if (flight.xcDistanceM !== null && flight.xcScore !== null) {
    parts.push(`XC ${number(flight.xcDistanceM / METRES_PER_KM, 1)} ${t.km}, ${number(flight.xcScore, 1)} ${t.points}`);
  } else if (flight.distanceTrackM !== null) {
    parts.push(`${number(flight.distanceTrackM / METRES_PER_KM, 1)} ${t.km} ${t.track}`);
  }
  if (flight.maxAltM !== null) parts.push(`${t.maxAlt} ${number(flight.maxAltM, 0)} ${t.m}`);
  return { title, description: parts.join(' · ') };
}

export function sharePageHtml(args: {
  token: string;
  publicUrl: string;
  locale: PageLocale;
  flight: SharePreviewRecord | null;
}): string {
  const { token, publicUrl, locale, flight } = args;
  const t = TEXT[locale];
  const card = flight ? shareCard(flight, locale) : { title: t.notFound, description: '' };
  const pathToken = encodeURIComponent(token);
  const pageUrl = `${publicUrl}/s/${pathToken}`;
  const viewerUrl = `/#/s/${pathToken}`;
  const image =
    flight?.previewObjectKey != null
      ? [
          `<meta property="og:image" content="${escapeHtml(`${publicUrl}${API_V1_PREFIX}/share/${pathToken}/preview.jpg`)}">`,
          `<meta property="og:image:width" content="${PREVIEW_IMAGE.width}">`,
          `<meta property="og:image:height" content="${PREVIEW_IMAGE.height}">`,
          `<meta name="twitter:card" content="summary_large_image">`,
        ].join('\n')
      : '<meta name="twitter:card" content="summary">';
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${title} — ${BRAND}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
${image}
<meta http-equiv="refresh" content="0; url=${escapeHtml(viewerUrl)}">
<script>location.replace(${JSON.stringify(viewerUrl)})</script>
</head>
<body><a href="${escapeHtml(viewerUrl)}">${escapeHtml(t.open)}</a></body>
</html>
`;
}

/** /s/:token — вне /api/v1: этот адрес видят люди в чате. */
export function registerSharePageRoute(app: FastifyInstance, deps: SharePageDeps): void {
  app.get('/s/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = TokenParams.safeParse(request.params);
    const flight = params.success ? await deps.find(params.data.token) : null;
    const token = params.success ? params.data.token : '';
    const html = sharePageHtml({
      token,
      publicUrl: deps.publicUrl,
      locale: pageLocale(request.headers['accept-language']),
      flight,
    });
    if (flight) request.log.info({ flightId: flight.flightId }, 'share page served');
    return (
      reply
        .code(flight ? HTTP.ok : HTTP.notFound)
        .type('text/html; charset=utf-8')
        // Подпись меняется вместе с полётом и приватностью — без долгого кеша.
        .header('cache-control', 'no-cache')
        .send(html)
    );
  });
}

/** /api/v1/share/:token/preview.jpg — картинка для og:image. */
export function registerSharePreviewRoute(v1: FastifyInstance, deps: SharePageDeps): void {
  v1.get('/share/:token/preview.jpg', async (request, reply) => {
    const params = TokenParams.safeParse(request.params);
    const flight = params.success ? await deps.find(params.data.token) : null;
    if (!flight?.previewObjectKey) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Preview not found' }));
    const bytes = await deps.storage.get(flight.previewObjectKey);
    return reply
      .code(HTTP.ok)
      .type('image/jpeg')
      .header('cache-control', `public, max-age=${PREVIEW_CACHE_S}`)
      .send(Buffer.from(bytes));
  });
}
