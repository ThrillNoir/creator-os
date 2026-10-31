import { createHash } from "node:crypto";
import { runVideoThumbnailBatch } from "./video-thumbnail-storage-adapter.mjs";

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function receipt(planId, result) {
  return { ...result, planId,
    receiptId: `thumbnail-receipt:${digest([planId, result.creatorId, result.dryRun,
      result.sourceBytesBudgeted, result.nextCursor, result.results]).slice(0, 16)}` };
}
function identity(source) {
  return digest([source.creatorId, source.assetId, source.sourceKey, source.sourceRevision,
    source.etag, source.version, source.bytes, source.codec, source.state, source.posterKey]);
}
export async function planVideoThumbnailRun({ adapter, target, creatorId, afterId = "", maxItems = 2,
  maxSourceBytes = 3 * 1024 ** 3 }) {
  const rows = await adapter.listCandidates(creatorId, afterId, maxItems);
  const candidates = [];
  let budgeted = 0;
  for (const row of rows) {
    const source = await adapter.loadSource(creatorId, row.assetId);
    if (!source || source.posterKey != null || source.bytes !== row.bytes) throw new Error("thumbnail_plan_source_changed");
    const withinBudget = budgeted + row.bytes <= maxSourceBytes;
    if (withinBudget) budgeted += row.bytes;
    candidates.push({ assetId: row.assetId, bytes: row.bytes, codec: source.codec,
      sourceFingerprint: identity(source), status: withinBudget ? "planned" : "deferred_budget" });
  }
  const summary = { target, creatorId, afterId, maxItems, maxSourceBytes, candidates };
  return { ...summary, planId: `thumbnail:${digest(summary).slice(0, 16)}`, sourceBytesBudgeted: budgeted,
    nextCursor: candidates.at(-1)?.assetId ?? null };
}

export async function applyVideoThumbnailRun({ adapter, plan }) {
  const fresh = await planVideoThumbnailRun({ adapter, target: plan.target, creatorId: plan.creatorId,
    afterId: plan.afterId, maxItems: plan.maxItems, maxSourceBytes: plan.maxSourceBytes });
  if (fresh.planId !== plan.planId) throw new Error("thumbnail_plan_changed");
  const fingerprints = new Map(fresh.candidates.map((item) => [item.assetId, item.sourceFingerprint]));
  const guarded = { ...adapter, async loadSource(creatorId, assetId) {
    const source = await adapter.loadSource(creatorId, assetId);
    if (!source || identity(source) !== fingerprints.get(assetId)) throw new Error("thumbnail_plan_source_changed");
    return source;
  } };
  const result = await runVideoThumbnailBatch({ adapter: guarded, creatorId: plan.creatorId, afterId: plan.afterId,
    maxItems: plan.maxItems, maxSourceBytes: plan.maxSourceBytes,
    expectedAssetIds: plan.candidates.map((item) => item.assetId), execute: true });
  return receipt(plan.planId, result);
}

export async function runVideoThumbnailTimerTick({ adapter, target, creatorId, stateStore,
  maxItems = 2, maxSourceBytes = 3 * 1024 ** 3 }) {
  const state = await stateStore.read(creatorId);
  const afterId = state?.afterId ?? "";
  const plan = await planVideoThumbnailRun({ adapter, target, creatorId, afterId, maxItems, maxSourceBytes });
  if (!plan.candidates.length) {
    await stateStore.write(creatorId, { afterId: "" });
    return receipt(plan.planId, { creatorId, dryRun: false, sourceBytesBudgeted: 0, results: [], nextCursor: null });
  }
  const result = await applyVideoThumbnailRun({ adapter, plan });
  await stateStore.write(creatorId, { afterId: result.nextCursor ?? "" });
  return result;
}
