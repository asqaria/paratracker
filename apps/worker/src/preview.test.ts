import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { PREVIEW } from './preview-layout.js';
import { renderPreview, type TileSource } from './preview.js';

/** Лимит vitest: libvips и JPEG — секунды на раннере CI. Проверяется картинка, не скорость. */
const PREVIEW_TEST_LIMIT_MS = 30_000;

const lat = [43.1, 43.3, 43.15, 43.1];
const lon = [76.9, 77.0, 77.2, 76.9];

/** Однотонный зелёный тайл 256×256 — «лес». */
const greenTile = () => sharp({ create: { width: 256, height: 256, channels: 3, background: '#2f6b2f' } }).png().toBuffer();

describe('renderPreview', { timeout: PREVIEW_TEST_LIMIT_MS }, () => {
  it('JPEG 1200×630 для Open Graph; подложка из тайлов', async () => {
    const requested: string[] = [];
    const source: TileSource = {
      fetchTile: async (z, x, y) => {
        requested.push(`${z}/${x}/${y}`);
        return greenTile();
      },
      attribution: 'Powered by Esri',
    };
    const jpeg = await renderPreview({ lat, lon }, source);
    if (!jpeg) throw new Error('preview expected');
    const meta = await sharp(jpeg).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: PREVIEW.width, height: PREVIEW.height });
    expect(requested.length).toBeGreaterThan(0);

    // Угол картинки — подложка (зелёная), а не пустой фон.
    const { data } = await sharp(jpeg).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[1]).toBeGreaterThan(data[0] ?? 0);
  });

  it('тайл не пришёл — картинка всё равно есть, на тёмном фоне', async () => {
    const source: TileSource = { fetchTile: () => Promise.reject(new Error('offline')), attribution: 'x' };
    const jpeg = await renderPreview({ lat, lon, xc: [{ lat: 43.1, lon: 76.9 }, { lat: 43.3, lon: 77 }], xcClosed: true }, source);
    expect((await sharp(jpeg ?? Buffer.alloc(0)).metadata()).width).toBe(PREVIEW.width);
  });

  it('без подложки (нет ключа) и без точек', async () => {
    expect(await renderPreview({ lat, lon }, null)).not.toBeNull();
    expect(await renderPreview({ lat: [], lon: [] }, null)).toBeNull();
  });
});
