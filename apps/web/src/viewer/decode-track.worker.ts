import { decodeTrack, transferables, type DecodedTrack } from './decode-track';

/**
 * Декодирование .track в отдельном потоке (ТЗ §7.7): разбор 15 000 точек
 * не должен трогать поток отрисовки. Буферы уходят наружу как transferable.
 */

export type DecodeRequest = { buffer: ArrayBuffer };
export type DecodeResponse = { ok: true; track: DecodedTrack } | { ok: false; message: string };

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  try {
    const track = decodeTrack(event.data.buffer);
    const response: DecodeResponse = { ok: true, track };
    self.postMessage(response, { transfer: transferables(track) });
  } catch (error) {
    const response: DecodeResponse = { ok: false, message: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};
