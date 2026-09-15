import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { flights, users } from './schema.js';

const sqlType = (table: typeof flights | typeof users, column: string): string | undefined =>
  getTableConfig(table)
    .columns.find((c) => c.name === column)
    ?.getSQLType();

describe('кастомные типы колонок', () => {
  it('геометрия — geography в WGS84, не geometry', () => {
    expect(sqlType(flights, 'track_simplified')).toBe('geography(LineStringZM,4326)');
    expect(sqlType(flights, 'bbox')).toBe('geography(Polygon,4326)');
  });

  it('email и username — citext', () => {
    expect(sqlType(users, 'email')).toBe('citext');
    expect(sqlType(users, 'username')).toBe('citext');
  });
});
