// Intentionally source-only: the release config must explicitly add these
// bindings and origins before a remote deployment can activate protected flows.
interface Env {
  CONTACT_PROFILES?: KVNamespace;
  ADULT_PROFILES?: KVNamespace;
  BOOKING_ACTION_BASE_URL?: string;
  ADULT_GATEWAY_BASE_URL?: string;
  SAFE_PUBLIC_PROFILE_BASE_URL?: string;
  ADULT_PROFILE_PUBLISH?: Workflow<Parameters<import("./index").AdultProfilePublishWorkflow["run"]>[0]["payload"]>;
  ADULT_PROFILE_WITHDRAW?: Workflow<Parameters<import("./index").AdultProfileWithdrawWorkflow["run"]>[0]["payload"]>;
}
