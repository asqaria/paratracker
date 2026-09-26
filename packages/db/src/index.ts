export { createDatabase, type Database, type DatabaseConnection } from './client.js';
export { citext, geography, type GeographyKind } from './columns.js';
export { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
export {
  createChannelListener,
  FLIGHT_QUEUED_CHANNEL,
  FLIGHT_STATUS_CHANNEL,
  notifyFlightQueued,
  notifyFlightStatus,
  type ChannelListener,
  type ChannelListenerOptions,
} from './notifications.js';
export {
  deleteFlights,
  findFlight,
  insertFlight,
  listExpiredAnonymousFlights,
  listUnfinishedFlights,
  markFlightFailed,
  markFlightProcessing,
  markFlightReady,
  requeueFlightsForBackfill,
  type ExpiredFlight,
  type FlightRecord,
  type NewFlight,
  type ProcessedFlight,
} from './repositories/flights.js';
export {
  findFlightDetails,
  listGlides,
  listThermals,
  type FlightDetailsRecord,
  type GlideRecord,
  type ThermalRecord,
} from './repositories/analysis.js';
export { readPostgisVersion } from './repositories/health.js';
export {
  attachNearbyFlights,
  createUserSite,
  listLogbookSites,
  type CreateSiteResult,
  type SiteRecord,
} from './repositories/sites.js';
export {
  claimFlights,
  listLogbook,
  listLogbookMap,
  type LogbookCursor,
  type LogbookEntryRecord,
  type LogbookMapFeature,
  type LogbookPage,
} from './repositories/logbook.js';
export {
  createSession,
  findUserProfile,
  revokeSession,
  rotateSession,
  signInWithOAuth,
  type NewSession,
  type OAuthIdentity,
  type RotateResult,
  type UserProfile,
} from './repositories/users.js';
export * from './schema.js';
