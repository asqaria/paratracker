import { runMigrations } from '@skyline/db';

/**
 * Точка входа для прод-деплоя: `node dist/migrate.js` перед запуском API.
 * Нужен только DATABASE_URL.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

await runMigrations(databaseUrl);
console.log(JSON.stringify({ level: 'info', msg: 'migrations applied' }));
