/// <reference path="../thot-os-public-links/worker-configuration.d.ts" />
/// <reference path="../thot-os-public-links/src/protected-action-env.d.ts" />

interface Env {
  ADULT_PROFILES: KVNamespace;
  ADULT_MEDIA: R2Bucket;
  ADULT_EVENTS: AnalyticsEngineDataset;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  AGE_SESSION_SECRET: string;
}
