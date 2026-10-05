"use server";

import { headers } from "next/headers";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { createContentDownloadLink, revokeContentDownloadLink, listContentDownloadLinks } from "@/lib/content-download-links";

const STAGING_HOST = "thot-os-staging.thot-os.workers.dev";
const STAGING_DOWNLOAD_BASE = "https://thot-os-downloads-staging.thot-os.workers.dev";

async function downloadBase() {
  const host = (await headers()).get("host") ?? "";
  if (process.env.CONTENT_DOWNLOAD_LINKS_LOCAL === "1" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return "http://127.0.0.1:8791";
  const env = cloudflareEnv() as { CONTENT_DOWNLOAD_LINKS_ENABLED?: string };
  if (host === STAGING_HOST && env.CONTENT_DOWNLOAD_LINKS_ENABLED === "1") return STAGING_DOWNLOAD_BASE;
  throw new Error("Content links are unavailable.");
}

export async function generateContentLinkAction(formData: FormData) {
  const base = await downloadBase();
  const context = await requireCreatorContext("mutate");
  const link = await createContentDownloadLink(cloudflareEnv().DB, {
    actor: { creatorId: context.creator.creator_id, email: context.email },
    assetId: String(formData.get("assetId") ?? ""),
    title: String(formData.get("title") ?? ""),
    sharingConfirmed: formData.get("sharingConfirmed") === "yes",
  });
  return { id: link.id, url: `${base}/d/${link.token}`, expiresAt: link.expiresAt };
}

export async function revokeContentLinkAction(linkId: string) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  const revoked = await revokeContentDownloadLink(cloudflareEnv().DB, {
    actor: { creatorId: context.creator.creator_id, email: context.email }, linkId,
  });
  if (!revoked) throw new Error("That link is unavailable or already revoked.");
}

export async function listContentLinksAction(assetId: string) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  return listContentDownloadLinks(cloudflareEnv().DB, {
    actor: { creatorId: context.creator.creator_id, email: context.email }, assetId,
  });
}
