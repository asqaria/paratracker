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

  it('вход выключен по умолчанию', () => {
    const config = loadConfig(valid);
    expect(config.AUTH_JWT_SECRET).toBeUndefined();
    expect(config.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(config.PUBLIC_URL).toBe('http://localhost:5173');
  });

  it('короткий секрет JWT не принимает', () => {
    expect(() => loadConfig({ ...valid, AUTH_JWT_SECRET: 'short' })).toThrow(/AUTH_JWT_SECRET/);
  });

  it('Google без секрета JWT или без client secret — ошибка конфига, а не молчаливо выключенный вход', () => {
    const secret = 'x'.repeat(32);
    expect(() => loadConfig({ ...valid, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toThrow(/AUTH_JWT_SECRET/);
    expect(() => loadConfig({ ...valid, AUTH_JWT_SECRET: secret, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(loadConfig({ ...valid, AUTH_JWT_SECRET: secret, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }).GOOGLE_CLIENT_ID).toBe('id');
  });
});
