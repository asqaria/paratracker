import { PARSER } from '@skyline/core';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_ATTRIBUTE,
  checkTrackFile,
  UPLOAD_FIELD_NAME,
  UPLOAD_URL,
  uploadTrack,
  UploadError,
} from './upload-track';

const FLIGHT_ID = '11111111-2222-4333-8444-555555555555';

const file = (name: string, bytes = 'AXXXSkyline\n'): File => new File([bytes], name, { type: 'text/plain' });

const respond =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('checkTrackFile', () => {
  it('пропускает поддерживаемые расширения в любом регистре', () => {
    for (const name of ['track.igc', 'track.IGC', 'track.gpx', 'track.kml', 'track.kmz']) {
      expect(checkTrackFile({ name, size: 1024 }), name).toBeNull();
    }
  });

  it('отклоняет чужой формат', () => {
    expect(checkTrackFile({ name: 'track.fit', size: 1024 })).toEqual({ reason: 'unsupported_format' });
    expect(checkTrackFile({ name: 'photo.jpg', size: 1024 })).toEqual({ reason: 'unsupported_format' });
    // Имя без точки — не расширение: файл «igc» это не IGC.
    expect(checkTrackFile({ name: 'igc', size: 1024 })).toEqual({ reason: 'unsupported_format' });
  });

  it('отклоняет пустой файл и файл больше лимита ТЗ', () => {
    expect(checkTrackFile({ name: 'track.igc', size: 0 })).toEqual({ reason: 'empty' });
    expect(checkTrackFile({ name: 'track.igc', size: PARSER.maxFileBytes + 1 })).toEqual({
      reason: 'too_large',
      maxBytes: PARSER.maxFileBytes,
    });
    expect(checkTrackFile({ name: 'track.igc', size: PARSER.maxFileBytes })).toBeNull();
  });
});

describe('ACCEPT_ATTRIBUTE', () => {
  it('перечисляет расширения через запятую с точкой', () => {
    expect(ACCEPT_ATTRIBUTE).toBe('.igc,.gpx,.kml,.kmz');
  });
});

describe('uploadTrack', () => {
  it('202 → id полёта и статус', async () => {
    const fetchImpl = vi.fn((input: unknown, init?: RequestInit) => {
      expect(input).toBe(UPLOAD_URL);
      expect(init?.method).toBe('POST');
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get(UPLOAD_FIELD_NAME)).toBeInstanceOf(File);
      return Promise.resolve(
        new Response(JSON.stringify({ flightId: FLIGHT_ID, status: 'pending' }), { status: 202 }),
      );
    });

    await expect(uploadTrack(file('track.igc'), { fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toEqual({
      flightId: FLIGHT_ID,
      status: 'pending',
    });
  });

  it('локальная проверка не даёт отправить чужой формат', async () => {
    const fetchImpl = vi.fn();
    await expect(
      uploadTrack(file('track.fit'), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ rejection: { reason: 'unsupported_format' } });
    // Запрос не ушёл: незачем грузить файл, который сервер всё равно отклонит.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('415 и 413 от сервера превращаются в те же причины', async () => {
    const unsupported = respond(415, {
      type: 'about:blank',
      title: 'Unsupported Media Type',
      status: 415,
      detail: 'Unsupported track format',
    });
    await expect(uploadTrack(file('track.igc'), { fetchImpl: unsupported })).rejects.toMatchObject({
      rejection: { reason: 'unsupported_format' },
      status: 415,
    });

    const tooLarge = respond(413, { type: 'about:blank', title: 'Payload Too Large', status: 413 });
    await expect(uploadTrack(file('track.igc'), { fetchImpl: tooLarge })).rejects.toMatchObject({
      rejection: { reason: 'too_large' },
      status: 413,
    });
  });

  it('прочая ошибка несёт detail из Problem Details', async () => {
    const body = { type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Storage unavailable' };
    const error = await uploadTrack(file('track.igc'), { fetchImpl: respond(500, body) }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).message).toBe('Storage unavailable');
    expect((error as UploadError).rejection).toBeNull();
  });
});
