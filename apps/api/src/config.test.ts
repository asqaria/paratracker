import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://skyline:skyline@127.0.0.1:5432/skyline',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'skyline',
};

describe('loadConfig', () => {
  it('подставляет значения по умолчанию и приводит типы', () => {
    const config = loadConfig({ ...valid, API_PORT: '8080', S3_FORCE_PATH_STYLE: 'false' });
    expect(config).toMatchObject({ API_HOST: '127.0.0.1', API_PORT: 8080, LOG_LEVEL: 'info', S3_FORCE_PATH_STYLE: false });
  });

  it('называет отсутствующую переменную в ошибке', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
