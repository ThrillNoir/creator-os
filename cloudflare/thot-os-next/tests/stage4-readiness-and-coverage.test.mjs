import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Stage 4 records bounded per-media insight coverage without treating unavailable metrics as zero", async () => {
  const [scheduler, migration, operations] = await Promise.all([
    readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../thot-os-app/migrations/0038_instagram_analytics_metric_coverage.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/operations.ts", import.meta.url), "utf8"),
  ]);
  assert.match(scheduler, /const MAX_MEDIA_INSIGHT_LOOKUPS = 25/);
  assert.match(scheduler, /INSTAGRAM_GET_IG_MEDIA_INSIGHTS/);
  assert.match(scheduler, /period: "lifetime"/);
  assert.match(scheduler, /mediaInsightsAttempted/);
  assert.match(scheduler, /completeMetricMedia/);
  assert.match(scheduler, /viewCount === null \|\| viewCount === 0/);
  assert.match(migration, /ADD COLUMN media_insights_attempted/);
  assert.match(migration, /ADD COLUMN complete_metric_media/);
  assert.match(migration, /ADD COLUMN missing_share_media/);
  assert.match(operations, /media_insights_succeeded,complete_metric_media/);
});

test("Stage 4 launch-readiness surfaces staging evidence and keeps production blocked", async () => {
  const [model, page, route, shell] = await Promise.all([
    readFile(new URL("../src/lib/launch-readiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/launch-readiness/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/launch-readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(model, /status: "blocked"[\s\S]*Production is deliberately unprovisioned/);
  assert.match(model, /status='uncertain'/);
  assert.match(model, /resolved_at IS NULL/);
  assert.match(model, /completeMetricMedia >= 6/);
  assert.match(page, /cannot deploy, publish, refresh a provider or change a public profile/);
  assert.match(route, /requireCreatorContext\("manage_identity"\)/);
  assert.match(route, /cache-control": "no-store/);
  assert.match(shell, /Launch readiness/);
});
