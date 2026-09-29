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
export {
  createGlider,
  deleteGlider,
  listGliders,
  setFlightGlider,
  updateGlider,
  type GliderRecord,
  type GliderRef,
  type SetFlightGliderResult,
} from './repositories/gliders.js';
export { readPostgisVersion } from './repositories/health.js';
export {
  ensureShareToken,
  findSharedFlight,
  findSharePreview,
  resetShareToken,
  setFlightPrivacy,
  type SharePreviewRecord,
} from './repositories/sharing.js';
export { findThermalReview, saveThermalReview, type ThermalReviewRecord } from './repositories/reviews.js';
export { seasonStats, type SeasonStats, type SeasonTotals } from './repositories/stats.js';
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
  findPublicProfile,
  findUserIdByUsername,
  findUserProfile,
  revokeSession,
  rotateSession,
  signInWithOAuth,
  updateUserProfile,
  type NewSession,
  type OAuthIdentity,
  type PublicProfile,
  type RotateResult,
  type UpdateProfileResult,
  type UserProfile,
} from './repositories/users.js';
export * from './schema.js';
export { listSameDayFlights, type SameDayRecord } from './repositories/same-day.js';
export {
  followCounts,
  likedBy,
  listFeed,
  setFollow,
  setLike,
  type FeedCursor,
  type FeedPage,
  type FeedRecord,
  type FollowCounts,
  type FollowState,
  type LikeState,
} from './repositories/social.js';
export {
  addComment,
  deleteComment,
  findComment,
  listComments,
  type CommentRecord,
  type CommentRef,
} from './repositories/comments.js';
export { listForecastSites, listSiteForecasts, saveSiteForecast, type ForecastSiteRecord, type SiteForecastRecord } from './repositories/forecast.js';
