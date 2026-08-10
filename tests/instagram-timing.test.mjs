import test from "node:test";
import assert from "node:assert/strict";
import { calculateInstagramTiming, findNextRecommendedSlot } from "../src/lib/instagram-timing.ts";

test("ranks hours with stronger follower activity", () => {
  const result = calculateInstagramTiming({ media: [], followerActivity: [{ "9": 20, "18": 100 }], timeZone: "UTC", limit: 1 });
  assert.equal(result.recommendations[0].hour, 18);
  assert.equal(result.confidence, "building");
});

test("uses historical performance to distinguish weekdays at the same hour", () => {
  const base = { media_product_type: "FEED", media_type: "IMAGE", reach: 100, views: 100, likes: 10, comments: 0, saves: 0, shares: 0, total_interactions: 10 };
  const result = calculateInstagramTiming({
    media: [
      { ...base, published_at: "2026-07-27T18:00:00Z", reach: 1000, total_interactions: 100 },
      { ...base, published_at: "2026-07-28T18:00:00Z" },
    ],
    followerActivity: [{ "18": 100 }],
    timeZone: "UTC",
    limit: 2,
  });
  assert.equal(result.recommendations[0].weekdayLabel, "Monday");
  assert.equal(result.recommendations[0].hour, 18);
});

test("returns early confidence when only sparse post data exists", () => {
  const result = calculateInstagramTiming({
    media: [{ published_at: "2026-07-27T12:00:00Z", media_product_type: "FEED", media_type: "IMAGE", reach: 10, views: 10, likes: 1, comments: 0, saves: 0, shares: 0, total_interactions: 1 }],
    followerActivity: [],
    timeZone: "UTC",
  });
  assert.equal(result.confidence, "early");
  assert.equal(result.recommendations[0].sampleSize, 1);
});

test("selects an upcoming recommended slot while respecting spacing", () => {
  const recommendations = [
    { weekday: 1, weekdayLabel: "Monday", hour: 18, label: "Monday · 6:00 pm", score: 90, confidence: "building", sampleSize: 2, reason: "history" },
    { weekday: 2, weekdayLabel: "Tuesday", hour: 15, label: "Tuesday · 3:00 pm", score: 80, confidence: "building", sampleSize: 2, reason: "history" },
  ];
  const result = findNextRecommendedSlot({ recommendations, occupied: ["2026-08-03T10:00:00Z"], now: new Date("2026-08-02T00:00:00Z"), timeZone: "Australia/Perth", minimumSpacingHours: 4 });
  assert.ok(result);
  assert.equal(result.recommendation.weekdayLabel, "Tuesday");
});
