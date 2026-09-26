import {
  claimFlights,
  createChannelListener,
  createGlider,
  createUserSite,
  deleteGlider,
  createDatabase,
  createSession,
  findFlight,
  findFlightDetails,
  findThermalReview,
  findUserProfile,
  FLIGHT_STATUS_CHANNEL,
  insertFlight,
  listGlides,
  listLogbook,
  listLogbookMap,
  listGliders,
  listLogbookSites,
  listThermals,
  notifyFlightQueued,
  revokeSession,
  saveThermalReview,
  seasonStats,
  rotateSession,
  setFlightGlider,
  signInWithOAuth,
  updateGlider,
} from '@skyline/db';

import tzlookup from '@photostructure/tz-lookup';

import { buildApp } from './app.js';
import { createGoogleOAuth } from './auth/google.js';
import type { AuthDeps } from './auth/routes.js';
import { loadConfig } from './config.js';
import { HEALTH_CHECK_TIMEOUT_S } from './constants.js';
import { createFlightEventHub } from './events.js';
import { createHealthProbe } from './probe.js';
import { createObjectStorage, createStorageClient } from './storage.js';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const s3 = createStorageClient(config);
const storage = createObjectStorage(s3, config.S3_BUCKET);

/** Вход (задача 2.10): без секрета JWT выключен, все загрузки анонимные. */
const auth: AuthDeps | undefined = config.AUTH_JWT_SECRET
  ? {
      jwtSecret: new TextEncoder().encode(config.AUTH_JWT_SECRET),
      publicUrl: config.PUBLIC_URL.replace(/\/+$/, ''),
      google:
        config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
          ? createGoogleOAuth({ clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET })
          : null,
      users: {
        signIn: (identity) => signInWithOAuth(database.db, identity),
        profile: (id) => findUserProfile(database.db, id),
      },
      sessions: {
        create: (session) => createSession(database.db, session),
        rotate: (args) => rotateSession(database.db, args),
        revoke: (tokenHash, now) => revokeSession(database.db, tokenHash, now),
      },
    }
  : undefined;

/** События конвейера приходят от воркера через LISTEN/NOTIFY, без опроса базы. */
const events = createFlightEventHub();

const app = buildApp({
  logger: {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
  ...(auth
    ? {
        auth,
        logbook: {
          list: (query) => listLogbook(database.db, query),
          map: (userId) => listLogbookMap(database.db, userId),
          sites: (userId) => listLogbookSites(database.db, userId),
          stats: (userId, year) => seasonStats(database.db, userId, year),
          claim: (userId, claims) => claimFlights(database.db, userId, claims),
        },
        sites: {
          // Таймзона места — по координатам взлёта (IANA): из неё местное время полёта (2.14).
          create: (args) => createUserSite(database.db, { ...args, timezoneAt: (lat, lon) => tzlookup(lat, lon) }),
        },
        gliders: {
          list: (userId) => listGliders(database.db, userId),
          create: (userId, input) => createGlider(database.db, userId, input),
          update: (userId, id, input) => updateGlider(database.db, userId, id, input),
          remove: (userId, id) => deleteGlider(database.db, userId, id),
          setFlightGlider: (args) => setFlightGlider(database.db, args),
        },
        reviews: {
          find: (flightId, userId) => findThermalReview(database.db, flightId, userId),
          save: (args) => saveThermalReview(database.db, args),
        },
      }
    : {}),
  health: {
    probe: createHealthProbe({ db: database.db, storage: s3, bucket: config.S3_BUCKET }),
    timeoutS: HEALTH_CHECK_TIMEOUT_S,
  },
  flights: {
    repository: {
      insert: (flight) => insertFlight(database.db, flight),
      find: (id) => findFlight(database.db, id),
    },
    storage,
    events,
    onQueued: (flightId) => notifyFlightQueued(database.db, flightId),
  },
  analysis: {
    details: (id) => findFlightDetails(database.db, id),
    thermals: (flightId) => listThermals(database.db, flightId),
    glides: (flightId) => listGlides(database.db, flightId),
  },
  // Ключ ArcGIS остаётся на сервере; без него подложка Esri просто недоступна.
  tiles: {
    tileUrlTemplate: config.ARCGIS_TILE_URL ?? null,
    apiKey: config.ARCGIS_API_KEY ?? null,
  },
});

const statusListener = createChannelListener({
  connectionString: config.DATABASE_URL,
  channels: [FLIGHT_STATUS_CHANNEL],
  onNotification: (_channel, payload) => events.handleNotification(payload),
  onError: (error) => app.log.error({ err: error }, 'flight status listener error'),
});

// Упавшее простаивающее соединение не должно ронять процесс.
database.pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

app.addHook('onClose', async () => {
  await statusListener.stop();
  await database.close();
  s3.destroy();
});

const shutdown = (signal: NodeJS.Signals): void => {
  app.log.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    },
  );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await statusListener.start();
await app.listen({ host: config.API_HOST, port: config.API_PORT });
