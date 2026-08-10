"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approvePostPackage,
  approveCreatorReminder,
  completeCaptionTask,
  completeResearchTask,
  confirmComposioIdentity,
  confirmServiceIdentity,
  confirmPublicationMatch,
  confirmLocalBridgeIdentity,
  captureInstagramOutcomeSnapshots,
  createAccount,
  createCaptionTask,
  createCreator,
  createPerson,
  createPostBundle,
  createPublicationJob,
  createResearchFinding,
  createResearchTask,
  createRedditCommunity,
  createRedditTarget,
  disconnectPlatformConnection,
  disconnectCreatorService,
  approveRedditTarget,
  failAgentTask,
  getAgentTask,
  getAccounts,
  getPostPackage,
  getPublicationJobs,
  getScheduledPosts,
  getInstagramAnalyticsData,
  getPostPackagePeople,
  importAnalyticsMetrics,
  approvePublicationJob,
  getRecentCaptions,
  getVoiceProfile,
  markAgentTaskRunning,
  markPostPublished,
  prepareLocalBridgeConnection,
  reschedulePostPackage,
  saveCreatorReminderRule,
  saveCreatorLoginProfile,
  setConnectionPublishingAuthority,
  saveVoiceProfile,
  updatePostPackage,
  updateMessagingConnection,
  setMessagingEmergencyPause,
  type MessagingMode,
  issueLocalBridgePairing,
  createMessageDraft,
  approveLocalBridgeDraftForSend,
  createVaultUploadJobs,
  recordPaidUseAttestations,
  retryVaultUploadJob,
  verifyVaultUploadJob,
  saveCreatorFinancialSettings,
  savePlatformConnection,
} from "@/lib/db";
import { runAgentTask } from "@/lib/agents/runtime";
import { CREATOR_COOKIE, getActiveCreator } from "@/lib/current-creator";
import { cookies } from "next/headers";
import { evaluateCaption } from "@/lib/caption-quality";
import { normaliseAnalyticsRows, parseCsv } from "@/lib/csv";
import { executeInstagramPublicationJob } from "@/lib/publishing/composio-instagram";
import { executeXQuikPublicationJob } from "@/lib/publishing/xquik-x";
import { listXQuikAccounts } from "@/lib/integrations/xquik";
import { encryptSecret } from "@/lib/integrations/secrets";
import { sendAgencyMessageToCreator, sendApprovedCreatorReminder, sendApprovedPostToTelegram } from "@/lib/handoff/telegram";
import { syncInstagramAnalytics } from "@/lib/analytics/instagram";
import { calculateInstagramTiming, findNextRecommendedSlot } from "@/lib/instagram-timing";
import { getBridgeProfileDirectory } from "@/lib/local-bridge/launcher";
import { getLocalBridgeUrl, isLocalBridgePlatform } from "@/lib/local-bridge/config";
import { createHash } from "node:crypto";

export async function createPostAction(formData: FormData) {
  const creator = await getActiveCreator();
  const assetIds = formData.getAll("assetIds").map(String);
  const accountIds = formData.getAll("accountIds").map(String);
  const personIds = formData.getAll("personIds").map(Number).filter(Number.isInteger);
  const creatorNotes = String(formData.get("creatorNotes") ?? "").trim();
  const scheduledAt = String(formData.get("scheduledAt") ?? "");
  if (assetIds.length === 0 || accountIds.length === 0 || !creatorNotes) {
    const missing = [
      assetIds.length === 0 ? "asset" : "",
      accountIds.length === 0 ? "destination" : "",
      !creatorNotes ? "notes" : "",
    ].filter(Boolean).join(",");
    redirect(`/content/new?missing=${missing}`);
  }
  const { postIds } = createPostBundle({ creatorId: creator.id, assetIds, accountIds, personIds, creatorNotes, scheduledAt });
  revalidatePath("/approvals");
  redirect(`/approvals/${postIds[0]}`);
}

export async function approvePostAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) throw new Error("Invalid post package.");
  const creator = await getActiveCreator();
  const post = getPostPackage(id);
  if (!post || post.creator_id !== creator.id) throw new Error("Post package is outside the active creator workspace.");
  const people = getPostPackagePeople(id);
  const voice = getVoiceProfile(creator.id);
  const issues = evaluateCaption({
    caption: post.caption,
    platform: post.platform,
    phrasesToAvoid: voice?.phrases_to_avoid,
    recentCaptions: getRecentCaptions(creator.id, id),
    allowedHandles: people.flatMap((person) =>
      person.tags.split(" · ").map((tag) => tag.split(":").slice(1).join(":")).filter(Boolean)
    ),
  });
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  if (blockers.length) {
    throw new Error(`Approval blocked: ${blockers.map((issue) => issue.message).join(" ")}`);
  }
  approvePostPackage(id);
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
}

export async function updatePostAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const accountId = String(formData.get("accountId") ?? "");
  const creatorNotes = String(formData.get("creatorNotes") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();
  const scheduledAt = String(formData.get("scheduledAt") ?? "");
  if (!Number.isInteger(id) || !accountId || !creatorNotes) {
    throw new Error("Post, destination and creator notes are required.");
  }
  const creator = await getActiveCreator();
  const post = (await import("@/lib/db")).getPostPackage(id);
  if (!post || post.creator_id !== creator.id) throw new Error("Post package is outside the active creator workspace.");
  updatePostPackage({ id, accountId, creatorNotes, caption, scheduledAt });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  revalidatePath(`/handoff/${id}`);
}

export async function sendApprovedPostToTelegramAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) throw new Error("Invalid post package.");
  const creator = await getActiveCreator();
  try {
    await sendApprovedPostToTelegram(creator.id, id);
  } catch {
    revalidatePath(`/approvals/${id}`);
    redirect(`/approvals/${id}?telegram=failed`);
  }
  revalidatePath(`/approvals/${id}`);
  revalidatePath(`/handoff/${id}`);
  redirect(`/approvals/${id}?telegram=sent`);
}

export async function sendAgencyMessageToCreatorAction(formData: FormData) {
  const creator = await getActiveCreator();
  const message = String(formData.get("message") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "");
  let result = "sent";
  try {
    await sendAgencyMessageToCreator(creator.id, message);
  } catch {
    result = "failed";
  }
  revalidatePath("/");
  revalidatePath("/messages");
  if (returnTo === "messages") redirect(`/messages?telegram=${result}`);
  redirect(`/?telegram=${result}`);
}

export async function syncInstagramAnalyticsAction() {
  const creator = await getActiveCreator();
  await syncInstagramAnalytics(creator.id);
  revalidatePath("/analytics");
  revalidatePath("/schedule");
  revalidatePath("/reporting");
}

export async function createPersonAction(formData: FormData) {
  const creator = await getActiveCreator();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const stageName = String(formData.get("stageName") ?? "").trim();
  const consentStatus = String(formData.get("consentStatus") ?? "not_recorded");
  const taggingPreference = String(formData.get("taggingPreference") ?? "ask_each_time");
  const privateNotes = String(formData.get("privateNotes") ?? "").trim();
  if (!displayName) throw new Error("A name is required.");
  const platforms = ["instagram", "facebook", "threads", "tiktok", "youtube", "x", "reddit", "onlyfans", "fansly"];
  createPerson({
    creatorId: creator.id,
    displayName,
    stageName,
    consentStatus,
    taggingPreference,
    privateNotes,
    tags: platforms.map((platform) => ({
      platform,
      handle: String(formData.get(`${platform}Handle`) ?? "").trim(),
    })),
  });
  revalidatePath("/people");
  revalidatePath("/content/new");
}

export async function saveVoiceProfileAction(formData: FormData) {
  const creator = await getActiveCreator();
  saveVoiceProfile(creator.id, {
    display_name: String(formData.get("displayName") ?? "Thrill Noir"),
    perspective: String(formData.get("perspective") ?? "brand_voice"),
    tone_notes: String(formData.get("toneNotes") ?? "").trim(),
    vocabulary: String(formData.get("vocabulary") ?? "").trim(),
    phrases_to_avoid: String(formData.get("phrasesToAvoid") ?? "").trim(),
    emoji_style: String(formData.get("emojiStyle") ?? "light"),
    hashtag_style: String(formData.get("hashtagStyle") ?? "minimal"),
    approved_examples: String(formData.get("approvedExamples") ?? "").trim(),
  });
  revalidatePath("/voice");
  revalidatePath("/approvals");
}

export async function createResearchFindingAction(formData: FormData) {
  const creator = await getActiveCreator();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (!sourceUrl || !summary) throw new Error("A source URL and finding summary are required.");
  createResearchFinding({
    creator_id: creator.id,
    platform: String(formData.get("platform") ?? "all"),
    source_name: String(formData.get("sourceName") ?? "").trim() || new URL(sourceUrl).hostname,
    source_url: sourceUrl,
    summary,
    recommendation: String(formData.get("recommendation") ?? "").trim(),
    confidence: String(formData.get("confidence") ?? "medium"),
    observed_at: String(formData.get("observedAt") ?? new Date().toISOString().slice(0, 10)),
    expires_at: String(formData.get("expiresAt") ?? "") || null,
  });
  revalidatePath("/research");
}

export async function queueCaptionTaskAction(formData: FormData) {
  const postId = Number(formData.get("postId"));
  const provider = String(formData.get("provider") ?? "codex");
  if (!Number.isInteger(postId) || (provider !== "codex" && provider !== "claude")) {
    throw new Error("Invalid caption task.");
  }
  const creator = await getActiveCreator();
  const post = (await import("@/lib/db")).getPostPackage(postId);
  if (!post || post.creator_id !== creator.id) throw new Error("Post package is outside the active creator workspace.");
  createCaptionTask(postId, provider);
  revalidatePath("/agents");
  revalidatePath(`/approvals/${postId}`);
}

function extractAgentCaption(provider: string, stdout: string) {
  const lines = stdout.split("\n").filter(Boolean);
  let caption = "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (provider === "codex" && event.type === "item.completed" && event.item?.type === "agent_message") {
        caption = event.item.text ?? caption;
      }
      if (provider === "claude" && event.type === "result") {
        caption = event.result ?? caption;
      }
    } catch {
      // Ignore non-JSON progress lines from a provider.
    }
  }
  return caption.trim();
}

export async function runCaptionTaskAction(formData: FormData) {
  const taskId = Number(formData.get("taskId"));
  const task = getAgentTask(taskId);
  if (!task || task.status !== "awaiting_approval") throw new Error("Task is not ready for approval.");
  const creator = await getActiveCreator();
  if (task.creator_id !== creator.id) throw new Error("Agent task is outside the active creator workspace.");
  const post = task.post_package_id ? getPostPackage(task.post_package_id) : undefined;
  if (task.role === "creator_manager" && !post) throw new Error("Caption task has no post package.");
  markAgentTaskRunning(taskId);
  try {
    const { stdout } = await runAgentTask({
      provider: task.provider as "codex" | "claude",
      prompt: task.prompt,
      workspace: process.cwd(),
      mode: "plan",
      approvedForExecution: true,
    });
    const output = extractAgentCaption(task.provider, stdout);
    if (!output) throw new Error("The agent returned no result.");
    if (task.role === "research_agent") completeResearchTask(taskId, output);
    else completeCaptionTask(taskId, output);
  } catch (error) {
    failAgentTask(taskId, error instanceof Error ? error.message : "Agent execution failed.");
  }
  revalidatePath("/agents");
  if (task.post_package_id) revalidatePath(`/approvals/${task.post_package_id}`);
}

export async function queueResearchTaskAction(formData: FormData) {
  const creator = await getActiveCreator();
  const provider = String(formData.get("provider") ?? "codex");
  const platform = String(formData.get("platform") ?? "all");
  const question = String(formData.get("question") ?? "").trim();
  if ((provider !== "codex" && provider !== "claude") || !question) throw new Error("Provider and research question are required.");
  createResearchTask({ creatorId: creator.id, provider, platform, question });
  revalidatePath("/research");
  revalidatePath("/agents");
  redirect("/agents");
}

export async function switchCreatorAction(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  const creator = (await import("@/lib/db")).getCreator(creatorId);
  if (!creator) throw new Error("Creator workspace not found.");
  const cookieStore = await cookies();
  cookieStore.set(CREATOR_COOKIE, creator.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function createCreatorAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const accent = String(formData.get("accent") ?? "#6f4df6");
  if (!name) throw new Error("Creator name is required.");
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("Choose a valid workspace colour.");
  const creatorId = createCreator({ name, accent });
  const cookieStore = await cookies();
  cookieStore.set(CREATOR_COOKIE, creatorId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/accounts");
}

export async function createAccountAction(formData: FormData) {
  const creator = await getActiveCreator();
  const label = String(formData.get("label") ?? "").trim();
  const platform = String(formData.get("platform") ?? "");
  const handle = String(formData.get("handle") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const category = String(formData.get("category") ?? "public_promotion");
  const publishingMode = String(formData.get("publishingMode") ?? "manual_handoff");
  const platforms = ["instagram", "facebook", "threads", "tiktok", "youtube", "x", "reddit", "myroomz", "onlyfans", "fansly", "other"];
  if (!label || !handle || !platforms.includes(platform)) throw new Error("Account label, platform and handle are required.");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a complete account URL.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Account URL must use HTTPS or HTTP.");
  createAccount({ creatorId: creator.id, label, platform, handle, url: parsedUrl.toString(), category, publishingMode });
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/content/new");
  revalidatePath(`/creators/${creator.id}`);
}

export async function disconnectPlatformAction(formData: FormData) {
  const creator = await getActiveCreator();
  const accountId = String(formData.get("accountId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const account = getAccounts(creator.id).find((item) => item.id === accountId);
  const expectedProviders = account?.platform === "instagram" ? ["meta_instagram", "composio_instagram"] : account?.platform === "youtube" ? ["google_youtube"] : account?.platform === "reddit" ? ["reddit"] : account?.platform === "x" ? ["xquik_x"] : [];
  if (!account || !expectedProviders.includes(provider)) throw new Error("Connection is outside the active creator workspace.");
  disconnectPlatformConnection(creator.id, accountId, provider);
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/connections");
  revalidatePath(`/creators/${creator.id}`);
}

export async function verifyXQuikConnectionAction(formData: FormData) {
  const creator = await getActiveCreator();
  const accountId = String(formData.get("accountId") ?? "");
  const account = getAccounts(creator.id).find((item) => item.id === accountId && item.platform === "x");
  if (!account) throw new Error("Choose an X destination in the active creator workspace.");
  const expected = account.handle.trim().toLowerCase().replace(/^@/, "");
  const match = (await listXQuikAccounts()).find((item) => item.xUsername.toLowerCase().replace(/^@/, "") === expected);
  if (!match) throw new Error(`XQuik did not return the expected @${expected} account.`);
  if (match.health !== "healthy") throw new Error(`XQuik reports @${expected} as ${match.health}. Resolve that state first.`);
  const key = process.env.XQUIK_API_KEY?.trim();
  if (!key) throw new Error("Add XQUIK_API_KEY to the private THOT OS environment first.");
  savePlatformConnection({
    creatorId: creator.id, accountId, provider: "xquik_x", externalAccountId: match.id,
    externalUsername: match.xUsername, scopes: ["x:tweets:write", "x:accounts:read"],
    tokenCiphertext: encryptSecret(key), tokenExpiresAt: null,
    providerMetadata: { xUserId: match.xUserId, health: match.health }, identityConfirmed: true,
  });
  revalidatePath(`/creators/${creator.id}`);
}

export async function saveCreatorLoginProfileAction(formData: FormData) {
  const creator = await getActiveCreator();
  const googleEmail = String(formData.get("googleEmail") ?? "").trim().toLowerCase();
  const chromeProfileLabel = String(formData.get("chromeProfileLabel") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (googleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail)) throw new Error("Enter a valid Google account email.");
  saveCreatorLoginProfile({ creatorId: creator.id, googleEmail, chromeProfileLabel, notes });
  revalidatePath(`/creators/${creator.id}`);
}

export async function openLocalPlatformAction(formData: FormData) {
  const creator = await getActiveCreator();
  const accountId = String(formData.get("accountId") ?? "");
  const destination = String(formData.get("destination") ?? "login");
  const account = getAccounts(creator.id).find((item) => item.id === accountId);
  if (!account || !isLocalBridgePlatform(account.platform)) throw new Error("Choose an OnlyFans or Fansly account in this creator workspace.");
  if (!["login", "inbox", "earnings", "vault"].includes(destination)) throw new Error("Unsupported bridge destination.");
  const profileDirectory = getBridgeProfileDirectory(creator.id, account.id);
  prepareLocalBridgeConnection({ creatorId: creator.id, accountId: account.id, platform: account.platform, profileDirectory, expectedUsername: account.handle });
  const pairingToken = destination === "inbox" || destination === "vault" ? issueLocalBridgePairing({creatorId:creator.id,accountId:account.id,platform:account.platform}) : undefined;
  revalidatePath(`/creators/${creator.id}`);
  const nativeUrl=getLocalBridgeUrl(account.platform,destination as "login" | "inbox" | "earnings" | "vault");
  redirect(pairingToken?`${nativeUrl}#creator_os_pair=${encodeURIComponent(pairingToken)}`:nativeUrl);
}

export async function confirmLocalPlatformIdentityAction(formData: FormData) {
  const creator = await getActiveCreator();
  const accountId = String(formData.get("accountId") ?? "");
  const observedUsername = String(formData.get("observedUsername") ?? "").trim();
  if (formData.get("identityConfirmed") !== "yes") throw new Error("Confirm the signed-in platform identity.");
  const account = getAccounts(creator.id).find((item) => item.id === accountId);
  if (!account || !isLocalBridgePlatform(account.platform)) throw new Error("Connection is outside the active creator workspace.");
  confirmLocalBridgeIdentity({ creatorId: creator.id, accountId, observedUsername });
  revalidatePath(`/creators/${creator.id}`);
}

export async function updateMessagingConnectionAction(formData: FormData) {
  const creator = await getActiveCreator();
  const connectionId = Number(formData.get("connectionId"));
  const mode = String(formData.get("mode") ?? "observe") as MessagingMode;
  if (!Number.isInteger(connectionId) || !["observe","assist","operate"].includes(mode)) throw new Error("Choose a valid messaging connection and mode.");
  updateMessagingConnection({
    creatorId: creator.id,
    connectionId,
    mode,
    readEnabled: formData.get("readEnabled") === "yes",
    writeEnabled: formData.get("writeEnabled") === "yes",
  });
  revalidatePath("/messages");
}

export async function setMessagingEmergencyPauseAction(formData: FormData) {
  const creator = await getActiveCreator();
  setMessagingEmergencyPause(creator.id, formData.get("paused") === "yes");
  revalidatePath("/messages");
}

export async function createMessageDraftAction(formData: FormData) {
  const creator = await getActiveCreator();
  const threadId = Number(formData.get("threadId"));
  const body = String(formData.get("body") ?? "");
  if (!Number.isInteger(threadId)) throw new Error("Choose a valid conversation.");
  createMessageDraft({creatorId:creator.id,threadId,body,authorName:"BR"});
  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
}

export async function approveMessageDraftForSendAction(formData: FormData) {
  const creator = await getActiveCreator();
  const threadId = Number(formData.get("threadId"));
  const draftId = Number(formData.get("draftId"));
  if (!Number.isInteger(threadId) || !Number.isInteger(draftId)) throw new Error("Choose a valid reply draft.");
  approveLocalBridgeDraftForSend({creatorId:creator.id,draftId,approvedBy:"BR"});
  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
}

export async function createVaultUploadJobsAction(formData:FormData){
  const creator=await getActiveCreator();
  const assetIds=formData.getAll("assetIds").map(String);
  const platforms=formData.getAll("platforms").map(String).filter((value):value is "onlyfans"|"fansly"=>value==="onlyfans"||value==="fansly");
  let created=0;
  try{
    if(formData.get("paidConsentConfirmed")==="yes"){
      const evidencePlatform=formData.get("evidencePlatform")==="fansly"?"fansly":"onlyfans";
      recordPaidUseAttestations({creatorId:creator.id,assetIds,evidencePlatform,confirmedBy:"BR",note:String(formData.get("consentNote")||"")});
    }
    created=createVaultUploadJobs({creatorId:creator.id,assetIds,platforms,approvedBy:"BR"});
  }catch(error){
    const message=error instanceof Error?error.message:"The vault batch could not be approved.";
    redirect(`/vault?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/vault");
  revalidatePath("/library/asset");
  redirect(`/vault?notice=${created?"queued":"already_queued"}`);
}

export async function retryVaultUploadJobAction(formData:FormData){
  const creator=await getActiveCreator();
  const jobId=Number(formData.get("jobId"));
  if(!Number.isInteger(jobId))throw new Error("Choose a valid vault upload.");
  retryVaultUploadJob({creatorId:creator.id,jobId,approvedBy:"BR"});
  revalidatePath("/vault");
  redirect("/vault?notice=retry_queued");
}

export async function verifyVaultUploadJobAction(formData:FormData){
  const creator=await getActiveCreator();
  const jobId=Number(formData.get("jobId"));
  if(!Number.isInteger(jobId))throw new Error("Choose a valid vault upload.");
  verifyVaultUploadJob({creatorId:creator.id,jobId,verifiedBy:"BR"});
  revalidatePath("/vault");
  redirect("/vault?notice=verified");
}

export async function confirmComposioIdentityAction(formData: FormData) {
  const creator = await getActiveCreator();
  const requestId = Number(formData.get("requestId"));
  if (!Number.isInteger(requestId) || formData.get("identityConfirmed") !== "yes") {
    throw new Error("Confirm the verified username before assigning it to this creator.");
  }
  confirmComposioIdentity(creator.id, requestId);
  revalidatePath("/accounts");
  revalidatePath("/connections");
  revalidatePath(`/creators/${creator.id}`);
}

export async function setConnectionPublishingAuthorityAction(formData: FormData) {
  const creator = await getActiveCreator();
  const connectionId = Number(formData.get("connectionId"));
  if (!Number.isInteger(connectionId)) throw new Error("Invalid platform connection.");
  setConnectionPublishingAuthority({
    creatorId: creator.id,
    connectionId,
    allowed: formData.get("allowed") === "yes",
  });
  revalidatePath("/connections");
  revalidatePath(`/creators/${creator.id}`);
}

export async function confirmServiceIdentityAction(formData: FormData) {
  const creator = await getActiveCreator();
  const requestId = Number(formData.get("requestId"));
  if (!Number.isInteger(requestId) || formData.get("identityConfirmed") !== "yes") throw new Error("Confirm the service identity before assigning it.");
  confirmServiceIdentity(creator.id, requestId);
  revalidatePath(`/creators/${creator.id}`);
}

export async function disconnectCreatorServiceAction(formData: FormData) {
  const creator = await getActiveCreator();
  const service = String(formData.get("service") ?? "");
  if (!["dropbox", "reddit", "youtube", "telegram"].includes(service)) throw new Error("Unknown creator service.");
  disconnectCreatorService(creator.id, service);
  revalidatePath(`/creators/${creator.id}`);
}

export async function createPublicationJobAction(formData: FormData) {
  const creator = await getActiveCreator();
  const postPackageId = Number(formData.get("postPackageId"));
  const mode = String(formData.get("mode") ?? "test_private");
  if (!Number.isInteger(postPackageId) || (mode !== "test_private" && mode !== "live")) throw new Error("Invalid publishing request.");
  createPublicationJob({ creatorId: creator.id, postPackageId, mode });
  revalidatePath("/publishing");
  redirect("/publishing");
}

export async function approvePublicationJobAction(formData: FormData) {
  const creator = await getActiveCreator();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) throw new Error("Invalid publishing job.");
  approvePublicationJob(creator.id, id);
  revalidatePath("/publishing");
}

export async function executePublicationJobAction(formData: FormData) {
  const creator = await getActiveCreator();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) throw new Error("Invalid publishing job.");
  try {
    const job = getPublicationJobs(creator.id).find((item) => item.id === id);
    if (job?.provider === "xquik_x") await executeXQuikPublicationJob(creator.id, id);
    else await executeInstagramPublicationJob(creator.id, id);
  } finally {
    revalidatePath("/publishing");
    revalidatePath("/approvals");
    revalidatePath("/schedule");
    revalidatePath("/reporting");
  }
}

export async function importAnalyticsCsvAction(formData: FormData) {
  const creator = await getActiveCreator();
  const platform = String(formData.get("platform") ?? "").trim();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file.");
  if (file.size > 2 * 1024 * 1024) throw new Error("CSV import is limited to 2 MB.");
  const csv=await file.text();
  const rows = normaliseAnalyticsRows(parseCsv(csv));
  const result=importAnalyticsMetrics({creatorId:creator.id,platform,sourceName:file.name,contentHash:createHash("sha256").update(csv).digest("hex"),rows});
  revalidatePath("/analytics");
  revalidatePath("/reporting");
  redirect(`/analytics?notice=${result.created?"imported":"duplicate_import"}`);
}

export async function saveCreatorFinancialSettingsAction(formData:FormData){
  const creator=await getActiveCreator();
  const agencySplitPercent=Number(formData.get("agencySplitPercent"));
  saveCreatorFinancialSettings({creatorId:creator.id,agencySplitPercent});
  revalidatePath("/reporting");
  redirect("/reporting?notice=split_saved");
}

export async function saveRedditCommunityAction(formData: FormData) {
  const creator = await getActiveCreator();
  const nonNegativeInteger = (name: string, fallback: number) => {
    const value = Number(formData.get(name) ?? fallback);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  };
  const rulesUrl = String(formData.get("rulesUrl") ?? "").trim();
  let parsedRules: URL;
  try {
    parsedRules = new URL(rulesUrl);
  } catch {
    throw new Error("Enter the subreddit rules URL.");
  }
  if (!["reddit.com", "www.reddit.com"].includes(parsedRules.hostname)) throw new Error("Rules URL must be on reddit.com.");
  createRedditCommunity({
    creatorId: creator.id,
    name: String(formData.get("name") ?? ""),
    rulesUrl: parsedRules.toString(),
    allowsNsfw: formData.get("allowsNsfw") === "on",
    creatorVerified: formData.get("creatorVerified") === "on",
    verificationRequired: formData.get("verificationRequired") === "on",
    flairRequired: formData.get("flairRequired") === "on",
    allowedPostTypes: String(formData.get("allowedPostTypes") ?? "image"),
    minimumAccountAgeDays: nonNegativeInteger("minimumAccountAgeDays", 0),
    minimumKarma: nonNegativeInteger("minimumKarma", 0),
    cooldownHours: Math.max(1, nonNegativeInteger("cooldownHours", 24)),
    titleGuidance: String(formData.get("titleGuidance") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim(),
    lastVerifiedAt: String(formData.get("lastVerifiedAt") ?? ""),
  });
  revalidatePath("/reddit");
}

export async function queueRedditTargetAction(formData: FormData) {
  const creator = await getActiveCreator();
  createRedditTarget({
    creatorId: creator.id,
    postPackageId: Number(formData.get("postPackageId")),
    communityId: Number(formData.get("communityId")),
    title: String(formData.get("title") ?? ""),
    flair: String(formData.get("flair") ?? ""),
    contentRating: formData.get("contentRating") === "nsfw" ? "nsfw" : "sfw",
    scheduledAt: String(formData.get("scheduledAt") ?? ""),
  });
  revalidatePath("/reddit");
}

export async function createRedditPostFromAssetAction(formData: FormData) {
  const creator = await getActiveCreator();
  const assetId = String(formData.get("assetId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const scheduledAt = String(formData.get("scheduledAt") ?? "");
  const db = await import("@/lib/db");
  const eligibleAsset = db.getLibraryAssets({creatorId: creator.id, destination: "reddit", limit: 500}).find((asset) => asset.id === assetId);
  if (!eligibleAsset) throw new Error("Choose an asset marked suitable for Reddit in this creator workspace.");

  let accountId = String(formData.get("accountId") ?? "");
  const redditAccounts = db.getAccounts(creator.id).filter((account) => account.platform === "reddit");
  if (!redditAccounts.some((account) => account.id === accountId)) accountId = redditAccounts[0]?.id ?? "";
  if (!accountId) {
    const identity = db.getCreatorServiceConnections(creator.id).find((connection) => connection.service === "reddit" && connection.status === "connected" && connection.identity_confirmed_at);
    if (!identity) throw new Error("Connect and verify a Reddit identity before creating a Reddit post.");
    const handle = identity.display_name.replace(/^u\//i, "") || identity.external_account_id || "reddit";
    accountId = db.createAccount({creatorId: creator.id, label: `${creator.name} Reddit`, platform: "reddit", handle: `u/${handle}`, url: `https://www.reddit.com/user/${encodeURIComponent(handle)}`, category: "public_promotion", publishingMode: "desktop_assisted"});
  }

  const reusablePackage = db.getPostPackages(creator.id).find((post) => post.platform === "reddit" && post.account_id === accountId && post.asset_id === assetId && post.status === "approved" && post.caption === title);
  let postId = reusablePackage?.id;
  if (!postId) {
    const {postIds} = db.createPostBundle({creatorId: creator.id, assetIds: [assetId], accountIds: [accountId], personIds: [], creatorNotes: "Created in Reddit operations", scheduledAt});
    postId = postIds[0];
    db.updatePostPackage({id: postId, accountId, creatorNotes: "Created in Reddit operations", caption: title, scheduledAt});
    db.approvePostPackage(postId);
  }
  db.createRedditTarget({
    creatorId: creator.id,
    postPackageId: postId,
    communityId: Number(formData.get("communityId")),
    title,
    flair: String(formData.get("flair") ?? ""),
    contentRating: formData.get("contentRating") === "nsfw" ? "nsfw" : "sfw",
    scheduledAt,
  });
  revalidatePath("/reddit");
  revalidatePath("/approvals");
  revalidatePath("/schedule");
  redirect("/reddit?tab=upcoming&notice=target_saved");
}

export async function approveRedditTargetAction(formData: FormData) {
  const creator = await getActiveCreator();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) throw new Error("Invalid Reddit target.");
  approveRedditTarget(creator.id, id);
  const target = (await import("@/lib/db")).getRedditTarget(id);
  const scheduledForFuture = Boolean(target?.scheduled_at && new Date(target.scheduled_at).getTime() > Date.now());
  let notice = scheduledForFuture ? "scheduled" : "posted";
  if (!scheduledForFuture) {
    try { await (await import("@/lib/publishing/composio-reddit")).publishApprovedRedditTarget(creator.id,id); }
    catch { notice = "post_failed"; }
  }
  revalidatePath("/reddit");
  revalidatePath("/activity");
  redirect(`/reddit?tab=${scheduledForFuture?"upcoming":"past"}&notice=${notice}`);
}

export async function retryRedditTargetAction(formData:FormData){
  const creator=await getActiveCreator();
  const id=Number(formData.get("id"));
  if(!Number.isInteger(id))throw new Error("Invalid Reddit target.");
  (await import("@/lib/db")).resetFailedRedditTarget(creator.id,id);
  let notice="posted";
  try{await (await import("@/lib/publishing/composio-reddit")).publishApprovedRedditTarget(creator.id,id);}
  catch{notice="post_failed";}
  revalidatePath("/reddit");revalidatePath("/activity");
  redirect(`/reddit?tab=${notice==="posted"?"past":"upcoming"}&notice=${notice}`);
}

export async function postRedditTargetNowAction(formData:FormData){
  const creator=await getActiveCreator();
  const id=Number(formData.get("id"));
  if(!Number.isInteger(id))throw new Error("Invalid Reddit target.");
  let notice="posted";
  try{await (await import("@/lib/publishing/composio-reddit")).publishApprovedRedditTarget(creator.id,id);}
  catch{notice="post_failed";}
  revalidatePath("/reddit");revalidatePath("/activity");
  redirect(`/reddit?tab=${notice==="posted"?"past":"upcoming"}&notice=${notice}`);
}

export async function reschedulePostAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const scheduledAt = String(formData.get("scheduledAt") ?? "");
  const creator = await getActiveCreator();
  const post = (await import("@/lib/db")).getPostPackage(id);
  if (!post || post.creator_id !== creator.id) throw new Error("Post package is outside the active creator workspace.");
  reschedulePostPackage(id, scheduledAt);
  revalidatePath("/schedule");
  revalidatePath(`/approvals/${id}`);
}

export async function scheduleAtRecommendedTimeAction(formData: FormData) {
  const creator = await getActiveCreator();
  const id = Number(formData.get("id"));
  const post = getPostPackage(id);
  if (!post || post.creator_id !== creator.id || post.platform !== "instagram") throw new Error("Choose an Instagram package in the active creator workspace.");
  const instagram = getInstagramAnalyticsData(creator.id);
  const timing = calculateInstagramTiming({ media: instagram.media, followerActivity: instagram.followerActivity.map((item) => item.hourly), timeZone: "Australia/Perth", limit: 5 });
  const next = findNextRecommendedSlot({
    recommendations: timing.recommendations,
    occupied: getScheduledPosts(creator.id).filter((item) => item.id !== id && item.platform === "instagram").map((item) => item.scheduled_at!).filter(Boolean),
    timeZone: "Australia/Perth",
    minimumSpacingHours: 4,
  });
  if (!next) throw new Error("No recommendation is available yet. Sync Instagram analytics first.");
  reschedulePostPackage(id, next.date.toISOString());
  revalidatePath("/schedule");
  revalidatePath(`/approvals/${id}`);
}

export async function saveCreatorReminderRuleAction(formData: FormData) {
  const creator = await getActiveCreator();
  saveCreatorReminderRule({
    creatorId:creator.id,enabled:formData.get("enabled")==="yes",
    leadMinutes:Number(formData.get("leadMinutes")||30),overdueMinutes:Number(formData.get("overdueMinutes")||30),
    timezone:"Australia/Perth",
  });
  revalidatePath("/schedule");
}

export async function approveCreatorReminderAction(formData: FormData) {
  const creator=await getActiveCreator();
  const id=Number(formData.get("id"));
  if(!Number.isInteger(id)) throw new Error("Invalid reminder.");
  approveCreatorReminder(creator.id,id);
  revalidatePath("/schedule");
}

export async function sendCreatorReminderAction(formData: FormData) {
  const creator=await getActiveCreator();
  const id=Number(formData.get("id"));
  if(!Number.isInteger(id)) throw new Error("Invalid reminder.");
  try{await sendApprovedCreatorReminder(creator.id,id);}catch{revalidatePath("/schedule");redirect("/schedule?reminder=failed");}
  revalidatePath("/schedule");
  redirect("/schedule?reminder=sent");
}

export async function markPostPublishedAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const creator = await getActiveCreator();
  const post = (await import("@/lib/db")).getPostPackage(id);
  if (!post || post.creator_id !== creator.id) throw new Error("Post package is outside the active creator workspace.");
  markPostPublished(id);
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  if (String(formData.get("returnTo") ?? "") === "schedule") redirect("/schedule");
}

export async function confirmInstagramPublicationMatchAction(formData: FormData) {
  const creator=await getActiveCreator();
  const postPackageId=Number(formData.get("postPackageId"));
  const externalMediaId=String(formData.get("externalMediaId")||"");
  const media=getInstagramAnalyticsData(creator.id).media.find(item=>item.media_id===externalMediaId);
  if(!Number.isInteger(postPackageId)||!media) throw new Error("Choose a verified Instagram post.");
  confirmPublicationMatch({creatorId:creator.id,postPackageId,externalMediaId,permalink:media.permalink,matchMethod:"manual"});
  captureInstagramOutcomeSnapshots(creator.id);
  revalidatePath(`/approvals/${postPackageId}`);revalidatePath("/activity");revalidatePath("/analytics");
}
