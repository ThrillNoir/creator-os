import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGrowthInsights } from "../src/lib/growth-metrics.ts";

const observation = (overrides = {}) => ({
  media_id: crypto.randomUUID(),
  permalink: "https://www.instagram.com/p/observed-media/",
  media_type: "IMAGE",
  media_product_type: "FEED",
  published_at: "2026-08-01T10:00:00.000Z",
  like_count: 5,
  comments_count: 1,
  view_count: 100,
  saved_count: 1,
  shares_count: 1,
  collected_at: "2026-08-16T10:00:00.000Z",
  source: "instagram_api",
  ...overrides,
});

test("growth insights ignore imports and never replace incomplete official metrics with zero", () => {
  const result = buildGrowthInsights({
    generatedAt: "2026-08-17T10:00:00.000Z",
    observations: [
      observation({ media_id: "official-complete" }),
      observation({ media_id: "official-incomplete", saved_count: null }),
      observation({ media_id: "imported-outlier", source: "creator_import", view_count: 10, like_count: 1000 }),
    ],
  });
  assert.equal(result.summary.officialMedia, 2);
  assert.equal(result.summary.completeMetricMedia, 1);
  assert.equal(result.summary.metricCoveragePercent, 50);
  assert.deepEqual(result.summary.dataQuality, ["official", "incomplete"]);
  assert.match(result.recommendations.find((item) => item.id === "metric_coverage").summary, /excluded from the comparison/);
  assert.equal(result.recommendations.some((item) => item.id === "format_repeat"), false);
});

test("growth insights label stale and unavailable evidence without making it actionable", () => {
  const unavailable = buildGrowthInsights({ observations: [], generatedAt: "2026-08-17T10:00:00.000Z" });
  assert.deepEqual(unavailable.summary.dataQuality, ["unavailable"]);
  const stale = buildGrowthInsights({
    observations: [observation({ collected_at: "2026-07-01T10:00:00.000Z" })],
    generatedAt: "2026-08-17T10:00:00.000Z",
  });
  assert.deepEqual(stale.summary.dataQuality, ["official", "stale"]);
  assert.equal(stale.recommendations.some((item) => item.id === "refresh_official_data"), true);
  assert.equal(stale.recommendations.every((item) => item.actionBoundary === "human_review_only"), true);
});

test("growth insight evidence exposes only HTTPS Instagram media permalinks", () => {
  const unsafe = buildGrowthInsights({ observations: [observation({ permalink: "javascript:alert(1)" })] });
  const trusted = buildGrowthInsights({ observations: [observation({ permalink: "https://www.instagram.com/p/observed-media/" })] });
  assert.equal(unsafe.recommendations[0].evidence.sourceUrl, null);
  assert.equal(trusted.recommendations[0].evidence.sourceUrl, "https://www.instagram.com/p/observed-media/");
});

test("growth insights produce a human-review-only format signal from a sufficiently complete official sample", () => {
  const observations = [
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `reel-${index}`, media_product_type: "REELS", like_count: 12, comments_count: 3, saved_count: 6, shares_count: 3 })),
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `feed-${index}`, media_product_type: "FEED", like_count: 3, comments_count: 0, saved_count: 0, shares_count: 0 })),
  ];
  const result = buildGrowthInsights({ observations, generatedAt: "2026-08-17T10:00:00.000Z" });
  const recommendation = result.recommendations.find((item) => item.id === "format_repeat");
  assert.ok(recommendation);
  assert.equal(recommendation.confidence, "building");
  assert.equal(recommendation.actionBoundary, "human_review_only");
  assert.match(recommendation.summary, /never schedules, publishes or approves/i);
  assert.equal(recommendation.evidence.source, "instagram_api");
  assert.equal(recommendation.evidence.sampleSize, 6);
  assert.equal(result.summary.freshComparableMedia, 12);
});

test("all-stale complete metrics trigger refresh and cannot recommend a format", () => {
  const observations = [
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `stale-reel-${index}`, media_product_type: "REELS", like_count: 12, comments_count: 3, saved_count: 6, shares_count: 3, collected_at: "2026-07-01T10:00:00.000Z" })),
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `stale-feed-${index}`, media_product_type: "FEED", like_count: 3, comments_count: 0, saved_count: 0, shares_count: 0, collected_at: "2026-07-01T10:00:00.000Z" })),
  ];
  const result = buildGrowthInsights({ observations, generatedAt: "2026-08-17T10:00:00.000Z" });
  assert.equal(result.summary.completeMetricMedia, 12);
  assert.equal(result.summary.freshComparableMedia, 0);
  assert.equal(result.summary.metricCoveragePercent, 100);
  assert.ok(result.recommendations.some((item) => item.id === "refresh_official_data"));
  assert.ok(result.recommendations.some((item) => item.id === "insufficient_sample"));
  assert.equal(result.recommendations.some((item) => item.category === "format"), false);
});

test("a mostly stale sample cannot create format recommendations from one fresh observation", () => {
  const observations = [
    observation({ media_id: "fresh-reel", media_product_type: "REELS", like_count: 12, comments_count: 3, saved_count: 6, shares_count: 3, collected_at: "2026-08-16T10:00:00.000Z" }),
    ...Array.from({ length: 11 }, (_, index) => observation({ media_id: `old-feed-${index}`, media_product_type: "FEED", like_count: 0, comments_count: 0, saved_count: 0, shares_count: 0, collected_at: "2026-07-01T10:00:00.000Z" })),
  ];
  const result = buildGrowthInsights({ observations, generatedAt: "2026-08-17T10:00:00.000Z" });
  assert.equal(result.summary.completeMetricMedia, 12);
  assert.equal(result.summary.freshComparableMedia, 1);
  assert.ok(result.recommendations.some((item) => item.id === "insufficient_sample"));
  assert.equal(result.recommendations.some((item) => item.category === "format"), false);
});

test("missing, invalid and future observation times are unavailable and excluded from comparisons", () => {
  const observations = [
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `invalid-${index}`, collected_at: index % 2 ? "not-a-date" : null })),
    ...Array.from({ length: 6 }, (_, index) => observation({ media_id: `future-${index}`, media_product_type: "REELS", like_count: 12, comments_count: 3, saved_count: 6, shares_count: 3, collected_at: "2026-08-18T10:00:00.000Z" })),
  ];
  const result = buildGrowthInsights({ observations, generatedAt: "2026-08-17T10:00:00.000Z" });
  assert.equal(result.summary.completeMetricMedia, 12);
  assert.equal(result.summary.freshComparableMedia, 0);
  assert.ok(result.summary.dataQuality.includes("unavailable"));
  assert.ok(result.recommendations.some((item) => item.id === "refresh_official_data"));
  assert.equal(result.recommendations.some((item) => item.category === "format"), false);
});

test("invalid calendar timestamps are unavailable while SQLite timestamps remain accepted", () => {
  const result = buildGrowthInsights({
    observations: [
      observation({ media_id: "invalid-calendar", collected_at: "2026-02-30T10:00:00.000Z" }),
      observation({ media_id: "sqlite-time", collected_at: "2026-03-02 10:00:00" }),
    ],
    generatedAt: "2026-03-02T10:00:00.000Z",
  });
  assert.equal(result.summary.completeMetricMedia, 2);
  assert.equal(result.summary.freshComparableMedia, 1);
  assert.ok(result.summary.dataQuality.includes("unavailable"));
  assert.ok(result.recommendations.some((item) => item.id === "refresh_official_data"));
});

test("complete zero-view metrics count toward coverage but are not comparison-eligible", () => {
  const result = buildGrowthInsights({
    observations: [
      observation({ media_id: "zero-views", view_count: 0, like_count: 0, comments_count: 0, saved_count: 0, shares_count: 0 }),
      observation({ media_id: "positive-views" }),
      observation({ media_id: "incomplete", saved_count: null }),
    ],
    generatedAt: "2026-08-17T10:00:00.000Z",
  });
  assert.equal(result.summary.completeMetricMedia, 2);
  assert.equal(result.summary.metricCoveragePercent, 67);
  assert.equal(result.summary.freshComparableMedia, 1);
  assert.deepEqual(result.summary.dataQuality, ["official", "incomplete"]);
  assert.match(result.recommendations.find((item) => item.id === "metric_coverage").summary, /1 official media observation is incomplete/);
  assert.match(result.recommendations.find((item) => item.id === "insufficient_sample").summary, /1 media item has complete metrics and positive views/);
});

test("growth insight database and API boundaries remain creator-scoped and read-only", async () => {
  const [library, route, page] = await Promise.all([
    readFile(new URL("../src/lib/growth-insights.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/growth/insights/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/growth/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(library, /creator_id=@creator[\s\S]*source='instagram_api'/);
  assert.match(library, /WHERE o\.creator_id=@creator AND o\.source='instagram_api'/);
  assert.match(route, /getCreatorContext\(creatorId\)/);
  assert.match(route, /cache-control": "no-store/);
  assert.doesNotMatch(page, /createInstagramPostAction|refreshInstagramDataAction|<form\b/);
  assert.match(page, /cannot like, comment, follow, message, create, schedule, approve or publish/i);
  assert.match(page, /no exclusive link to individual posts, subscribers or spend/i);
  assert.match(page, /does not guess post revenue/i);
});
