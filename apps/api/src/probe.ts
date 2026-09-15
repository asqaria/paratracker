import type { S3Client } from '@aws-sdk/client-s3';
import { readPostgisVersion, type Database } from '@skyline/db';

import type { HealthProbe } from './health.js';
import { checkBucket } from './storage.js';

export function createHealthProbe(deps: { db: Database; storage: S3Client; bucket: string }): HealthProbe {
  return {
    postgisVersion: () => readPostgisVersion(deps.db),
    storage: (signal) => checkBucket(deps.storage, deps.bucket, signal),
  };
}
