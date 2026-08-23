type LocalPreviewRuntime = {
  nodeEnv?: string;
  userAgent?: string;
  signingSecret?: string;
};

function currentUserAgent() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/**
 * The age-gated preview is a local Node development aid. It is deliberately
 * unavailable from an OpenNext/workerd runtime even if a local harness happens
 * to expose NODE_ENV=development.
 */
export function localAdultPreviewAvailable({ nodeEnv = process.env.NODE_ENV, userAgent = currentUserAgent(), signingSecret = process.env.LOCAL_ADULT_PREVIEW_SIGNING_SECRET }: LocalPreviewRuntime = {}) {
  // Do not advertise an age-gate link that cannot issue and verify its
  // short-lived session. There is intentionally no generated or committed
  // fallback secret: a developer must supply a local-only signing value.
  return nodeEnv === "development" && userAgent !== "Cloudflare-Workers" && typeof signingSecret === "string" && signingSecret.length >= 32;
}
