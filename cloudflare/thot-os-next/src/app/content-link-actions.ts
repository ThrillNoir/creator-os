"use server";

import { headers } from "next/headers";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { ContentDownloadLinkError, createContentDownloadLink, revokeContentDownloadLink, listContentDownloadLinks } from "@/lib/content-download-links";
import { DownloadSaleError, getDownloadSales, updateDownloadSale } from "@/lib/content-download-sales";

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
  const recipientReference = formData.get("recipientReference");
  const saleAmount = formData.get("saleAmount");
  const saleCurrency = formData.get("saleCurrency");
  if ([customMessage, recipientReference, saleAmount, saleCurrency].some((value) => value !== null && typeof value !== "string")) return { ok: false as const, code: "invalid_request" as const };
  const text = (value: FormDataEntryValue | null) => typeof value === "string" ? value : undefined;
  try {
    const link = await createContentDownloadLink(cloudflareEnv().DB, {
      actor: { creatorId: context.creator.creator_id, email: context.email },
      assetId: String(formData.get("assetId") ?? ""),
      title: String(formData.get("title") ?? ""),
      customMessage: text(customMessage),
      recipientReference: text(recipientReference),
      saleAmount: text(saleAmount),
      saleCurrency: text(saleCurrency),
      sharingConfirmed: formData.get("sharingConfirmed") === "yes",
    });
    return { ok: true as const, link: { id: link.id, url: `${base}/d/${link.token}`, expiresAt: link.expiresAt } };
  } catch (error) {
    if (error instanceof ContentDownloadLinkError || error instanceof DownloadSaleError) return { ok: false as const, code: error.code };
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

export async function listDownloadSalesAction(assetId: string, offset = 0) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  return getDownloadSales(cloudflareEnv().DB, { actor: { creatorId: context.creator.creator_id, email: context.email }, assetId, offset });
}

export async function updateDownloadSaleAction(formData: FormData) {
  await downloadBase();
  const context = await requireCreatorContext("mutate");
  const recipientReference = formData.get("recipientReference");
  const saleAmount = formData.get("saleAmount");
  const saleCurrency = formData.get("saleCurrency");
  const expectedRevisionValue = formData.get("expectedRevision");
  const expectedRevision = typeof expectedRevisionValue === "string" && /^\d+$/.test(expectedRevisionValue) ? Number(expectedRevisionValue) : Number.NaN;
  const operation = formData.get("operation");
  if ([recipientReference, saleAmount, saleCurrency].some((value) => value !== null && typeof value !== "string")
    || !Number.isSafeInteger(expectedRevision) || !["save", "clear_recipient", "void"].includes(String(operation))) return { ok: false as const, code: "invalid_request" as const };
  try {
    const ok = await updateDownloadSale(cloudflareEnv().DB, {
      actor: { creatorId: context.creator.creator_id, email: context.email },
      linkId: String(formData.get("linkId") ?? ""),
      recipientReference: operation === "save" ? recipientReference ?? undefined : undefined,
      saleAmount: saleAmount ?? undefined,
      saleCurrency: saleCurrency ?? undefined,
      expectedRevision,
      operation: operation as "save" | "clear_recipient" | "void",
    });
    return { ok };
  } catch (error) {
    if (error instanceof DownloadSaleError) return { ok: false as const, code: error.code };
    throw error;
  }
}
