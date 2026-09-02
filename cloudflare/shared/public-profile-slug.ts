// Private product routes must never become public creator profiles.
const reserved = new Set([
  "accounts", "activity", "admin", "agents", "analytics", "approvals", "api", "auth",
  "automation", "calendar", "connections", "content", "creators", "finance", "go",
  "growth", "healthz", "health", "handoff", "launch-readiness", "library", "login",
  "logout", "messages", "migration", "money", "operations", "people", "public-profile",
  "publishing", "reddit", "reporting", "research", "schedule", "settings", "staging-qa",
  "vault", "voice",
]);

export function isPublicCreatorSlug(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) && !reserved.has(value);
}
