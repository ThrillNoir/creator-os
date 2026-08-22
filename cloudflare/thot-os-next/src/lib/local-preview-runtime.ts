type LocalPreviewRuntime = {
  nodeEnv?: string;
  userAgent?: string;
};

function currentUserAgent() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/**
 * The age-gated preview is a local Node development aid. It is deliberately
 * unavailable from an OpenNext/workerd runtime even if a local harness happens
 * to expose NODE_ENV=development.
 */
export function localAdultPreviewAvailable({ nodeEnv = process.env.NODE_ENV, userAgent = currentUserAgent() }: LocalPreviewRuntime = {}) {
  return nodeEnv === "development" && userAgent !== "Cloudflare-Workers";
}
