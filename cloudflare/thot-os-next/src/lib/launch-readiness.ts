import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { getGrowthInsights, type GrowthInsights } from "./growth-insights";

export type ReadinessStatus = "ready" | "attention" | "blocked";

export type LaunchReadinessCheck = {
  id: "tenant_integrity" | "provider_receipts" | "analytics_collection" | "metric_coverage" | "public_profile" | "production_cutover";
  title: string;
  status: ReadinessStatus;
  summary: string;
  observedAt: string | null;
};

export type CreatorLaunchReadiness = {
  generatedAt: string;
  scope: "staging";
  checks: LaunchReadinessCheck[];
  summary: Record<ReadinessStatus, number>;
};

type CollectionRun = {
  status: "running" | "completed" | "skipped" | "failed";
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

type ProfileState = {
  profile_status: "draft" | "active" | "paused" | "retired";
  published_version_id: string | null;
  approved_versions: number;
};

function hasQuality(insights: GrowthInsights, quality: "stale" | "unavailable") {
  return insights.summary.dataQuality.includes(quality);
}

export function buildCreatorLaunchReadiness(input: {
  generatedAt?: string;
  unresolvedTenantExceptions: number;
  uncertainProviderReceipts: number;
  collection: CollectionRun | null;
  profile: ProfileState | null;
  insights: GrowthInsights;
}): CreatorLaunchReadiness {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const checks: LaunchReadinessCheck[] = [];
  checks.push(input.unresolvedTenantExceptions === 0
    ? { id: "tenant_integrity", title: "Creator-data isolation", status: "ready", summary: "No unresolved tenant-integrity exceptions are recorded for this creator workspace.", observedAt: generatedAt }
    : { id: "tenant_integrity", title: "Creator-data isolation", status: "blocked", summary: `${input.unresolvedTenantExceptions} unresolved tenant-integrity exception${input.unresolvedTenantExceptions === 1 ? "" : "s"} must be resolved or explicitly quarantined before operational use.`, observedAt: generatedAt });
  checks.push(input.uncertainProviderReceipts === 0
    ? { id: "provider_receipts", title: "External-operation reconciliation", status: "ready", summary: "No provider operation is awaiting reconciliation for this creator.", observedAt: generatedAt }
    : { id: "provider_receipts", title: "External-operation reconciliation", status: "blocked", summary: `${input.uncertainProviderReceipts} provider receipt${input.uncertainProviderReceipts === 1 ? " is" : "s are"} uncertain. Verify the provider outcome before any retry.`, observedAt: generatedAt });

  if (!input.collection) {
    checks.push({ id: "analytics_collection", title: "Official analytics collection", status: "attention", summary: "No creator-scoped analytics collection receipt exists yet. Growth evidence remains unavailable.", observedAt: null });
  } else if (input.collection.status === "failed" || input.collection.status === "running") {
    checks.push({ id: "analytics_collection", title: "Official analytics collection", status: "attention", summary: input.collection.status === "failed" ? "The latest read failed. Inspect the retained receipt and allow the bounded retry before relying on fresh evidence." : "A read is in progress. Wait for its durable receipt before using the resulting evidence.", observedAt: input.collection.completed_at ?? input.collection.started_at });
  } else if (hasQuality(input.insights, "stale") || hasQuality(input.insights, "unavailable")) {
    checks.push({ id: "analytics_collection", title: "Official analytics collection", status: "attention", summary: "The retained official observation is stale or unavailable. Do not use it to change a content plan yet.", observedAt: input.insights.summary.latestObservedAt });
  } else {
    checks.push({ id: "analytics_collection", title: "Official analytics collection", status: "ready", summary: "The latest provider read completed and its observation is current enough for review.", observedAt: input.collection.completed_at ?? input.collection.started_at });
  }

  const { officialMedia, completeMetricMedia } = input.insights.summary;
  checks.push(officialMedia > 0 && completeMetricMedia >= 6
    ? { id: "metric_coverage", title: "Growth metric coverage", status: "ready", summary: `${completeMetricMedia}/${officialMedia} official media observations meet the complete weighted-metric contract. Recommendations remain human-review only.`, observedAt: input.insights.summary.latestObservedAt }
    : { id: "metric_coverage", title: "Growth metric coverage", status: "attention", summary: `${completeMetricMedia}/${officialMedia} official media observations meet the complete weighted-metric contract. Missing fields stay unavailable; no format recommendation is enabled.`, observedAt: input.insights.summary.latestObservedAt });

  if (input.profile?.profile_status === "active" && input.profile.published_version_id) {
    checks.push({ id: "public_profile", title: "Public-profile rollback", status: "ready", summary: "An immutable published version exists and can be withdrawn through the dedicated workflow if needed.", observedAt: generatedAt });
  } else if ((input.profile?.approved_versions ?? 0) > 0) {
    checks.push({ id: "public_profile", title: "Public-profile approval", status: "ready", summary: "An explicitly approved immutable version is available. Publishing still requires a separate human confirmation.", observedAt: generatedAt });
  } else {
    checks.push({ id: "public_profile", title: "Public-profile approval", status: "attention", summary: "No explicitly approved public-profile version exists. No public creator route can be enabled from this workspace.", observedAt: generatedAt });
  }

  checks.push({ id: "production_cutover", title: "Production cutover", status: "blocked", summary: "Isolated production foundations exist, but no custom domain, private Access policy, WAF/rate-limit policy, creator approval or public profile is enabled. This staging screen cannot authorize a launch.", observedAt: generatedAt });
  const summary = checks.reduce<Record<ReadinessStatus, number>>((counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }), { ready: 0, attention: 0, blocked: 0 });
  return { generatedAt, scope: "staging", checks, summary };
}

export async function getCreatorLaunchReadiness(creatorId: string) {
  const { DB } = cloudflareEnv();
  const [uncertainReceipts, collection, profile, insights] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT COUNT(*) AS count FROM external_operation_receipts WHERE creator_id=@creator AND status='uncertain'").first<{ count: number }>(),
    creatorPrepare(DB, creatorId, "SELECT status,started_at,completed_at,error FROM instagram_analytics_collection_runs WHERE creator_id=@creator ORDER BY started_at DESC LIMIT 1").first<CollectionRun>(),
    creatorPrepare(DB, creatorId, `SELECT p.status AS profile_status,p.published_version_id,
      (SELECT COUNT(*) FROM creator_public_profile_versions v WHERE v.creator_id=@creator AND v.status='approved') AS approved_versions
      FROM creator_public_profiles p WHERE p.creator_id=@creator`).first<ProfileState>(),
    getGrowthInsights(creatorId),
  ]);
  // This exception table can reference the creator either as the affected or
  // related workspace. It cannot use creatorPrepare because both positions
  // are intentionally checked.
  const integrityResult = await DB.prepare("SELECT COUNT(*) AS count FROM tenant_integrity_exceptions WHERE (creator_id=? OR related_creator_id=?) AND resolved_at IS NULL")
    .bind(creatorId, creatorId).first<{ count: number }>();
  return buildCreatorLaunchReadiness({
    unresolvedTenantExceptions: integrityResult?.count ?? 0,
    uncertainProviderReceipts: uncertainReceipts?.count ?? 0,
    collection: collection ?? null,
    profile: profile ?? null,
    insights,
  });
}
