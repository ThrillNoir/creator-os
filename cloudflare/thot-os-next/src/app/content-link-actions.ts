"use server";

import { headers } from "next/headers";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { ContentDownloadLinkError, createContentDownloadLink, revokeContentDownloadLink, listContentDownloadLinks } from "@/lib/content-download-links";

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
  const customMessage = formData.get("customMessage");
  if (customMessage !== null && typeof customMessage !== "string") return { ok: false as const, code: "invalid_request" as const };
  try {
    const link = await createContentDownloadLink(cloudflareEnv().DB, {
      actor: { creatorId: context.creator.creator_id, email: context.email },
      assetId: String(formData.get("assetId") ?? ""),
      title: String(formData.get("title") ?? ""),
      customMessage: customMessage ?? undefined,
      sharingConfirmed: formData.get("sharingConfirmed") === "yes",
    });
    return { ok: true as const, link: { id: link.id, url: `${base}/d/${link.token}`, expiresAt: link.expiresAt } };
  } catch (error) {
    if (error instanceof ContentDownloadLinkError) return { ok: false as const, code: error.code };
    throw error;
  }
}

export async function revokeContentLinkAction(linkId: string) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  const revoked = await revokeContentDownloadLink(cloudflareEnv().DB, {
    actor: { creatorId: context.creator.creator_id, email: context.email }, linkId,
  });
  return { ok: revoked };
}

export async function listContentLinksAction(assetId: string) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  return listContentDownloadLinks(cloudflareEnv().DB, {
    actor: { creatorId: context.creator.creator_id, email: context.email }, assetId,
  });
}
