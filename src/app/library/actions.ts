"use server";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveCreator } from "@/lib/current-creator";
import { ASSET_DESTINATIONS, copyAssetClassification, enqueueAutomationEvent, getAssetCount, markAutomationEventDispatched, markAutomationEventDispatchFailed, markAutomationEventDispatching, refreshIndexedAssets, saveAssetClassification, setAssetTagsBulk, type AssetDestination } from "@/lib/db";
import { enqueueStagingJob } from "@/lib/cloudflare/staging-gateway";

const execFileAsync = promisify(execFile);

export async function syncLibraryAction() {
  const creator = await getActiveCreator();
  let notice = "sync_failed";

  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await execFileAsync(process.execPath, [path.join(process.cwd(), "scripts/index-library.mjs")], {
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024,
        });
        refreshIndexedAssets();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    if (lastError) throw lastError;
    const assetCount = getAssetCount(creator.id);
    const idempotencyKey = `library-sync:${creator.id}:${Date.now()}`;
    const event = enqueueAutomationEvent({
      creatorId: creator.id,
      eventType: "library.indexed",
      source: "creator-os.library",
      queue: "intake",
      idempotencyKey,
      payload: { creatorId: creator.id, assetCount },
    });
    try {
      markAutomationEventDispatching(creator.id,idempotencyKey);
      await enqueueStagingJob({
        queue: "intake",
        creatorId: creator.id,
        eventType: "library.indexed",
        idempotencyKey,
        payload: { creatorId: creator.id, eventId: event.event.id, assetCount },
      });
      markAutomationEventDispatched(creator.id,idempotencyKey);
    } catch (error) {
      markAutomationEventDispatchFailed(creator.id,idempotencyKey,error instanceof Error?error.message:"Cloudflare dispatch failed.");
      console.warn("Cloudflare intake dispatch skipped", error);
    }
    revalidatePath("/library");
    revalidatePath("/automation");
    revalidatePath("/library/asset");
    revalidatePath("/content/new");
    notice = `sync_complete&count=${assetCount}`;
  } catch (error) {
    console.error("Library sync failed", error);
    const detail = error instanceof Error ? `${error.message}${"stderr" in error && typeof error.stderr === "string" ? ` · ${error.stderr}` : ""}`.slice(0, 500) : "unknown error";
    notice = `sync_failed&detail=${encodeURIComponent(detail)}`;
  }

  redirect(`/library?notice=${notice}`);
}

export async function updateAssetTagsAction(formData: FormData) {
  const creator = await getActiveCreator();
  const assetId = String(formData.get("assetId") || "");
  const safetyValue=String(formData.get("safety")||"");
  const safety=safetyValue==="sfw"||safetyValue==="nsfw"?safetyValue:null;
  const destinations=formData.getAll("destinations").map(String).filter((item):item is AssetDestination=>ASSET_DESTINATIONS.includes(item as AssetDestination));
  saveAssetClassification({
    creatorId:creator.id,assetId,safety,destinations,
    isTeaser:formData.get("isTeaser")==="yes",isMulti:formData.get("isMulti")==="yes",
    teaserForAssetId:String(formData.get("teaserForAssetId")||"")||null,
    notes:String(formData.get("notes")||""),
    personIds:formData.getAll("personIds").map(Number).filter(Number.isInteger),actor:"BR",
  });
  revalidatePath("/library");
  revalidatePath("/library/asset");
  revalidatePath("/vault");
  revalidatePath("/operations", "layout");
  const returnTo=String(formData.get("returnTo")||"");
  if(returnTo){
    const parsed=new URL(returnTo,"http://creator-os.local");
    if(parsed.pathname==="/library"){
      parsed.searchParams.set("notice","asset_saved");
      parsed.searchParams.set("savedAsset",assetId);
      redirect(`${parsed.pathname}?${parsed.searchParams.toString()}`);
    }
  }
  redirect(`/library/asset?asset=${encodeURIComponent(assetId)}&notice=saved`);
}

export async function beginClassificationCopyAction(formData:FormData){
  const creator=await getActiveCreator();
  const sourceAssetId=String(formData.get("assetId")||"");
  const {getLibraryAsset}=await import("@/lib/db");
  if(!getLibraryAsset(creator.id,sourceAssetId))throw new Error("Source asset is outside this workspace.");
  redirect(`/library?view=list&copyFrom=${encodeURIComponent(sourceAssetId)}`);
}

export async function applyClassificationCopyAction(formData:FormData){
  const creator=await getActiveCreator();
  const sourceAssetId=String(formData.get("sourceAssetId")||"");
  const targetAssetIds=formData.getAll("targetAssetIds").map(String);
  const fields=formData.getAll("fields").map(String);
  if(!fields.length)throw new Error("Choose at least one classification field to copy.");
  const count=copyAssetClassification({creatorId:creator.id,sourceAssetId,targetAssetIds,fields,actor:"BR batch copy"});
  revalidatePath("/library");revalidatePath("/library/asset");revalidatePath("/vault");revalidatePath("/operations","layout");
  redirect(`/library?view=list&notice=batch_saved&count=${count}`);
}

export async function updateVisibleAssetTagsAction(formData: FormData) {
  const creator = await getActiveCreator();
  const assetIds = [...new Set(formData.getAll("assetIds").map(String).filter(Boolean))];
  setAssetTagsBulk(creator.id, assetIds.map((assetId) => ({
    assetId,
    tags: formData.getAll(`tags:${assetId}`).map(String),
  })));
  revalidatePath("/library");
  revalidatePath("/library/asset");
  revalidatePath("/content/new");
}
