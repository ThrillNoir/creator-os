import "server-only";

import path from "node:path";
import {
  completePublicationJob,
  failPublicationJob,
  getCreator,
  getCreatorServiceConnections,
  getPostPackageAssets,
  getPublicationJobForExecution,
  markPublicationJobExecuting,
  recordPublicationJobProgress,
} from "@/lib/db";
import { executeComposioTool } from "@/lib/integrations/composio";
import { createSignedPublicMediaUrl, getPublicMediaConfiguration } from "@/lib/public-media";

type IdResponse = { id?: string; creation_id?: string; media_id?: string; post_id?: string };

function responseId(value: IdResponse, label: string) {
  const id = value.id || value.creation_id || value.media_id || value.post_id;
  if (!id) throw new Error(`${label} returned no Instagram ID.`);
  return String(id);
}

export function getInstagramPublishingReadiness() {
  const media = getPublicMediaConfiguration();
  return { ready: media.ready, publicMediaReady: media.ready, dropboxReady: false };
}

export function getCreatorInstagramPublishingReadiness(creatorId: string) {
  const media = getPublicMediaConfiguration();
  const dropboxReady = Boolean(getCreatorServiceConnections(creatorId).find((item) => item.service === "dropbox" && item.status === "connected" && item.identity_confirmed_at));
  return { ready: media.ready || dropboxReady, publicMediaReady: media.ready, dropboxReady };
}

export async function executeInstagramPublicationJob(creatorId: string, jobId: number) {
  const job = getPublicationJobForExecution(creatorId, jobId);
  if (!job || job.provider !== "composio_instagram" || job.platform !== "instagram") throw new Error("Instagram publishing job not found.");
  if (job.status !== "approved_for_execution") throw new Error("This job still needs final publishing approval.");
  if (job.post_status !== "approved" || !job.post_approved_at) throw new Error("The approved content package is no longer current.");
  if (!job.identity_confirmed_at || !job.publishing_authorized_at) throw new Error("Instagram publishing authority is locked.");
  const dropbox = getCreatorServiceConnections(creatorId).find((item) => item.service === "dropbox" && item.status === "connected" && item.identity_confirmed_at);
  if (!getPublicMediaConfiguration().ready && !dropbox) throw new Error("Connect Dropbox or add a public HTTPS media origin before executing Instagram publishing.");
  const metadata = JSON.parse(job.provider_metadata || "{}") as { connectedAccountId?: string };
  if (!metadata.connectedAccountId || !job.external_account_id) throw new Error("The verified Composio connection is incomplete.");
  const assets = getPostPackageAssets(job.post_package_id);
  if (assets.length < 1 || assets.length > 10) throw new Error("Instagram publishing requires between 1 and 10 assets.");
  const imageExtensions = new Set([".jpg", ".jpeg", ".png"]);
  const videoExtensions = new Set([".mp4", ".mov"]);
  const kinds = assets.map((asset) => {
    const extension = path.extname(asset.basename).toLowerCase();
    if (imageExtensions.has(extension)) return "image" as const;
    if (videoExtensions.has(extension)) return "video" as const;
    throw new Error(`Instagram cannot publish ${extension || "this file type"}. Use JPG, PNG, MP4 or MOV.`);
  });
  if (assets.length > 1 && kinds.some((kind) => kind !== "image")) {
    throw new Error("The first direct-publishing release supports image-only carousels. Mixed/video carousels remain in handoff mode.");
  }
  const entityId = `creator-os:${creatorId}:${job.account_id}`;
  const tool = <T,>(slug: string, args: Record<string, unknown>) => executeComposioTool<T>({
    slug,
    connectedAccountId: metadata.connectedAccountId!,
    entityId,
    arguments: args,
  });
  markPublicationJobExecuting(creatorId, jobId);
  try {
    const urls = await Promise.all(assets.map(async (asset) => {
      if (!dropbox) return createSignedPublicMediaUrl(creatorId, asset.relative_path);
      const creator = getCreator(creatorId);
      const marker = `${path.sep}Dropbox${path.sep}`;
      const markerIndex = creator?.media_source?.indexOf(marker) ?? -1;
      if (!creator?.media_source || markerIndex < 0) throw new Error("The creator media source is not inside the connected Dropbox folder.");
      const rootInDropbox = creator.media_source.slice(markerIndex + marker.length).split(path.sep).join("/");
      const dropboxPath = `/${[rootInDropbox, asset.relative_path].filter(Boolean).join("/")}`;
      const temporary = await executeComposioTool<{ link?: string }>({
        slug: "DROPBOX_GET_TEMPORARY_LINK",
        connectedAccountId: dropbox.connected_account_id,
        entityId: `creator-os:${creatorId}:service:dropbox`,
        arguments: { path: dropboxPath },
      });
      if (!temporary.link) throw new Error("Dropbox did not return a temporary media link.");
      return temporary.link;
    }));
    let creationId: string;
    let containerType: string;
    if (assets.length > 1) {
      const container = await tool<IdResponse>("INSTAGRAM_CREATE_CAROUSEL_CONTAINER", {
        ig_user_id: job.external_account_id,
        caption: job.caption,
        child_image_urls: urls,
      });
      creationId = responseId(container, "Carousel container");
      containerType = "carousel";
    } else {
      const isVideo = kinds[0] === "video";
      const container = await tool<IdResponse>("INSTAGRAM_CREATE_MEDIA_CONTAINER", {
        ig_user_id: job.external_account_id,
        caption: job.caption,
        content_type: isVideo ? "reel" : "photo",
        ...(isVideo ? { video_url: urls[0], media_type: "REELS", share_to_feed: true } : { image_url: urls[0] }),
      });
      creationId = responseId(container, "Media container");
      containerType = isVideo ? "reel" : "photo";
    }
    const progress = { provider: "composio_instagram", containerType, creationId, assetCount: assets.length, phase: "container_created" };
    recordPublicationJobProgress(creatorId, jobId, progress);
    if (job.mode === "test_private") {
      completePublicationJob({ creatorId, id: jobId, externalPostId: creationId, receipt: { ...progress, phase: "validated_not_published" }, validationOnly: true });
      return;
    }
    const published = await tool<IdResponse>("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", {
      ig_user_id: job.external_account_id,
      creation_id: creationId,
      max_wait_seconds: containerType === "reel" ? 180 : 60,
    });
    const externalPostId = responseId(published, "Instagram publish");
    completePublicationJob({
      creatorId,
      id: jobId,
      externalPostId,
      receipt: { ...progress, phase: "published", externalPostId },
      validationOnly: false,
    });
  } catch (error) {
    failPublicationJob(creatorId, jobId, error instanceof Error ? error.message : "Instagram publishing failed.");
    throw error;
  }
}
