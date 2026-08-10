import "server-only";

import path from "node:path";
import { completePublicationJob, failPublicationJob, getPostPackageAssets, getPublicationJobForExecution, markPublicationJobExecuting, recordPublicationJobProgress } from "@/lib/db";
import { createSignedPublicMediaUrl, getPublicMediaConfiguration } from "@/lib/public-media";
import { createXQuikPost, listXQuikAccounts } from "@/lib/integrations/xquik";

export async function executeXQuikPublicationJob(creatorId: string, jobId: number) {
  const job = getPublicationJobForExecution(creatorId, jobId);
  if (!job || job.provider !== "xquik_x" || job.platform !== "x") throw new Error("XQuik publishing job not found.");
  if (job.status !== "approved_for_execution" || job.post_status !== "approved" || !job.post_approved_at) throw new Error("This X post still needs current content and publishing approval.");
  if (!job.identity_confirmed_at || !job.publishing_authorized_at) throw new Error("X publishing authority is locked.");

  const accounts = await listXQuikAccounts();
  const connected = accounts.find((item) => item.id === job.external_account_id && item.xUsername.toLowerCase() === job.external_username.toLowerCase());
  if (!connected) throw new Error("The verified XQuik account no longer matches this destination.");
  if (connected.health !== "healthy") throw new Error(`XQuik reports this X account as ${connected.health}. Resolve that state before publishing.`);

  const assets = getPostPackageAssets(job.post_package_id);
  const images = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
  const videos = new Set([".mp4"]);
  const kinds = assets.map((asset) => images.has(path.extname(asset.basename).toLowerCase()) ? "image" : videos.has(path.extname(asset.basename).toLowerCase()) ? "video" : "unsupported");
  if (kinds.includes("unsupported") || assets.length > 4 || (kinds.includes("video") && (assets.length !== 1 || kinds.includes("image")))) {
    throw new Error("XQuik supports up to four images or one MP4 video per post.");
  }
  if (job.caption.length > 280) throw new Error("This X caption exceeds 280 characters. Shorten it before approval.");
  if (assets.length && !getPublicMediaConfiguration().ready) throw new Error("Configure a public HTTPS THOT OS media origin before XQuik can fetch attached media.");

  markPublicationJobExecuting(creatorId, jobId);
  try {
    const media = assets.map((asset) => createSignedPublicMediaUrl(creatorId, asset.relative_path));
    const validation = { provider: "xquik_x", accountId: connected.id, username: connected.xUsername, health: connected.health, assetCount: assets.length };
    recordPublicationJobProgress(creatorId, jobId, validation);
    if (job.mode === "test_private") {
      completePublicationJob({ creatorId, id: jobId, externalPostId: `validation:${connected.id}`, receipt: { ...validation, phase: "validated_not_published" }, validationOnly: true });
      return;
    }
    const result = await createXQuikPost({ account: connected.xUsername, text: job.caption, media, idempotencyKey: job.idempotency_key });
    const externalPostId = String((result.result as { id?: string } | undefined)?.id || result.tweetId || "");
    if (!externalPostId || result.terminal !== true || result.success === false) throw new Error(String(result.message || result.error || "XQuik did not confirm the published post."));
    completePublicationJob({ creatorId, id: jobId, externalPostId, receipt: { ...validation, phase: "published", xquik: result }, validationOnly: false });
  } catch (error) {
    failPublicationJob(creatorId, jobId, error instanceof Error ? error.message : "XQuik publishing failed.");
    throw error;
  }
}
