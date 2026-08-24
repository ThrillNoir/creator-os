/// <reference path="../thot-os-public-links/worker-configuration.d.ts" />
/// <reference path="../thot-os-public-links/src/protected-action-env.d.ts" />

interface Env {
  CONTACT_PROFILES: KVNamespace;
  CONTACT_EVENTS: AnalyticsEngineDataset;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
}
