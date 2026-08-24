// Intentionally source-only: the release config must explicitly add these
// bindings and origins before a remote deployment can activate protected flows.
interface Env {
  /** Source-only protected media bindings; staging config intentionally omits them. */
  MEDIA?: R2Bucket;
  PUBLIC_MEDIA?: R2Bucket;
  ADULT_MEDIA?: R2Bucket;
  PUBLIC_MEDIA_DELIVERY_ENABLED?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
  ADULT_MEDIA_DELIVERY_ENABLED?: string;
  CONTACT_PROFILES?: KVNamespace;
  ADULT_PROFILES?: KVNamespace;
  BOOKING_ACTION_BASE_URL?: string;
  ADULT_GATEWAY_BASE_URL?: string;
  SAFE_PUBLIC_PROFILE_BASE_URL?: string;
  /** Missing or invalid is fail-closed. Configure only through Wrangler vars. */
  PUBLIC_PROFILE_PUBLICATION_MODE?: "disabled" | "synthetic-only" | "enabled";
  PUBLIC_PROFILE_SYNTHETIC_CREATOR_IDS?: string;
  ADULT_PROFILE_PUBLICATION_MODE?: "disabled" | "synthetic-only" | "enabled";
  ADULT_PROFILE_SYNTHETIC_CREATOR_IDS?: string;
  ADULT_PROFILE_PUBLISH?: Workflow<Parameters<import("./index").AdultProfilePublishWorkflow["run"]>[0]["payload"]>;
  ADULT_PROFILE_WITHDRAW?: Workflow<Parameters<import("./index").AdultProfileWithdrawWorkflow["run"]>[0]["payload"]>;
}
