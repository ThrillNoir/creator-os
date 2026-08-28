import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { boundedRetryAfterMs, canStartPreviewPoll, hasPendingPreviewJobs, nextPreviewPollDelayIndex, previewPollDelayMs, previewProgressChanged } from "../src/lib/preview-polling.ts";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const idle = { total: 0, ready: 0, queued: 0, processing: 0, failed: 0 };
const pending = { total: 3, ready: 1, queued: 1, processing: 1, failed: 0 };

test("preview polling has no work for empty and video-only image progress", () => {
  assert.equal(hasPendingPreviewJobs(idle), false);
  assert.equal(canStartPreviewPoll({ progress: idle, visible: true, online: true, inFlight: false }), false);
  assert.equal(canStartPreviewPoll({ progress: pending, visible: true, online: true, inFlight: false }), true);
});

test("preview polling backs off, resets on progress, and honours bounded server hints", () => {
  assert.equal(previewPollDelayMs(0), 5_000);
  assert.equal(previewPollDelayMs(1), 15_000);
  assert.equal(previewPollDelayMs(2), 30_000);
  assert.equal(previewPollDelayMs(3), 60_000);
  assert.equal(previewPollDelayMs(99), 60_000);
  assert.equal(nextPreviewPollDelayIndex(0, false), 1);
  assert.equal(nextPreviewPollDelayIndex(2, false), 3);
  assert.equal(nextPreviewPollDelayIndex(3, false), 3);
  assert.equal(nextPreviewPollDelayIndex(3, true), 0);
  assert.equal(boundedRetryAfterMs("1"), 5_000);
  assert.equal(boundedRetryAfterMs("120"), 60_000);
  assert.equal(boundedRetryAfterMs("invalid"), null);
  assert.equal(previewProgressChanged(pending, { ...pending, ready: 2, queued: 0 }), true);
  assert.equal(previewProgressChanged(pending, pending), false);
});

test("preview polling pauses hidden or offline tabs and prevents concurrent requests", () => {
  assert.equal(canStartPreviewPoll({ progress: pending, visible: false, online: true, inFlight: false }), false);
  assert.equal(canStartPreviewPoll({ progress: pending, visible: true, online: false, inFlight: false }), false);
  assert.equal(canStartPreviewPoll({ progress: pending, visible: true, online: true, inFlight: true }), false);
  assert.equal(canStartPreviewPoll({ progress: pending, visible: true, online: true, inFlight: false }), true);
});

test("Library poller excludes video extensions and uses cancellable one-shot scheduling", async () => {
  const [library, component, route] = await Promise.all([
    source("src/lib/library.ts"),
    source("src/components/preview-progress.tsx"),
    source("src/app/api/library/preview-status/route.ts"),
  ]);
  const previewQuery = library.slice(library.indexOf("function previewProgressStatement"), library.indexOf("function toPreviewProgress"));
  assert.doesNotMatch(previewQuery, /'mp4'|'mov'|'m4v'|'webm'/);
  assert.match(component, /controller\?\.abort\(\)/);
  assert.match(component, /window\.clearTimeout/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /window\.addEventListener\("offline"/);
  assert.doesNotMatch(component, /setInterval/);
  assert.match(route, /"retry-after": "5"/);
});
