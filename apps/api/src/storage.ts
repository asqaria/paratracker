import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { Config } from './config.js';
import type { FlightRoutesDeps } from './flights.js';

type StorageConfig = Pick<
  Config,
  'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'
>;

/** S3-совместимое хранилище: MinIO локально, R2 в проде (ТЗ §4.2). */
export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

/** Бросает, если бакет недоступен: нет сети, неверные ключи или бакета нет. */
export async function checkBucket(client: S3Client, bucket: string, signal: AbortSignal): Promise<void> {
  await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
}

/** Чтение и запись объектов для маршрутов полётов. */
export function createObjectStorage(client: S3Client, bucket: string): FlightRoutesDeps['storage'] {
  return {
    put: async (key, bytes, contentType) => {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    get: async (key) => {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`empty object body: ${key}`);
      return response.Body.transformToByteArray();
    },
  };
}
