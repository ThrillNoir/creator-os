"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";
import { destinations, type Destination } from "@/lib/library";
import { issueFanslyBridgePairing } from "@/lib/fansly-pairing";

function values(formData: FormData, key: string) {
  return formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean);
}

export async function saveAssetAttributesAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const assetIds = [...new Set(values(formData, "assetId"))].slice(0, 50);
  if (!assetIds.length) throw new Error("Select at least one asset.");

  const safetyValue = String(formData.get("safety") ?? "");
  const safety = safetyValue === "sfw" || safetyValue === "nsfw" ? safetyValue : null;
  const isTeaser = formData.get("isTeaser") === "on" ? 1 : 0;
  const isMulti = formData.get("isMulti") === "on" ? 1 : 0;
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  const selectedDestinations = values(formData, "destination").filter((value): value is Destination => destinations.includes(value as Destination));
  const nsfwDestinations = new Set<Destination>(["x", "reddit", "subscription", "ppv"]);
  if (safety === "nsfw" && selectedDestinations.some((value) => !nsfwDestinations.has(value))) {
    throw new Error("NSFW assets can only be marked for X, Reddit, subscription or PPV.");
  }

  const { DB } = cloudflareEnv();
  const placeholders = assetIds.map(() => "?").join(",");
  const owned = await DB.prepare(`SELECT id FROM assets WHERE creator_id='adelaide' AND source_available=1 AND id IN (${placeholders})`).bind(...assetIds).all<{ id: string }>();
  if (owned.results.length !== assetIds.length) throw new Error("One or more selected assets are unavailable.");

  const replacePeople = formData.get("peopleMode") === "replace";
  const personIds = [...new Set(values(formData, "personId").map(Number).filter((value) => Number.isInteger(value) && value > 0))];
  if (replacePeople && personIds.length) {
    const peoplePlaceholders = personIds.map(() => "?").join(",");
    const ownedPeople = await DB.prepare(`SELECT id FROM people WHERE creator_id='adelaide' AND id IN (${peoplePlaceholders})`).bind(...personIds).all<{ id: number }>();
    if (ownedPeople.results.length !== personIds.length) throw new Error("One or more creator friends are unavailable.");
  }
  const paidConsentConfirmed = formData.get("paidConsentConfirmed") === "on";
  const paidEvidenceValue = String(formData.get("paidEvidence") ?? "");
  const paidEvidence = paidEvidenceValue === "onlyfans" || paidEvidenceValue === "fansly" ? paidEvidenceValue : null;
  if (paidConsentConfirmed && (!replacePeople || !personIds.length || !paidEvidence)) throw new Error("Choose the creator friend and where the signed release is held.");
  const includesPaidDestination = selectedDestinations.includes("subscription") || selectedDestinations.includes("ppv");
  if (isMulti && includesPaidDestination && (!replacePeople || !personIds.length || !paidConsentConfirmed || !paidEvidence)) {
    throw new Error("Paid multi-creator content requires a creator friend and confirmed OnlyFans or Fansly release.");
  }

  const actor = identity.email ?? "connect@thrillnoir.com";
  const statements = assetIds.flatMap((assetId) => {
    const snapshot = JSON.stringify({ safety, isTeaser: Boolean(isTeaser), isMulti: Boolean(isMulti), notes, destinations: selectedDestinations, people: replacePeople ? personIds : undefined, paidEvidence: paidConsentConfirmed ? paidEvidence : undefined });
    const peopleStatements = replacePeople ? [
      DB.prepare("DELETE FROM asset_people WHERE creator_id='adelaide' AND asset_id=?").bind(assetId),
      ...personIds.map((personId) => DB.prepare("INSERT INTO asset_people (asset_id,creator_id,person_id,role) VALUES (?,'adelaide',?,'creator_friend')").bind(assetId, personId)),
      ...(paidConsentConfirmed && paidEvidence ? personIds.map((personId) => DB.prepare(`
        INSERT INTO asset_paid_consent_attestations (asset_id,creator_id,person_id,evidence_platform,confirmed_by,confirmed_at,note,revoked_at)
        VALUES (?,'adelaide',?,?,?,CURRENT_TIMESTAMP,'Confirmed before paid-platform use',NULL)
        ON CONFLICT(asset_id,person_id) DO UPDATE SET evidence_platform=excluded.evidence_platform,confirmed_by=excluded.confirmed_by,
          confirmed_at=CURRENT_TIMESTAMP,note=excluded.note,revoked_at=NULL
      `).bind(assetId, personId, paidEvidence, actor)) : []),
    ] : [];
    return [
      DB.prepare(`
        INSERT INTO asset_classifications (asset_id,creator_id,safety,is_teaser,is_multi,notes,reviewed_by,reviewed_at,updated_at)
        VALUES (?,'adelaide',?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(asset_id) DO UPDATE SET safety=excluded.safety,is_teaser=excluded.is_teaser,is_multi=excluded.is_multi,
          notes=excluded.notes,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      `).bind(assetId, safety, isTeaser, isMulti, notes, actor),
      DB.prepare("DELETE FROM asset_destinations WHERE creator_id='adelaide' AND asset_id=?").bind(assetId),
      ...selectedDestinations.map((destination) => DB.prepare("INSERT INTO asset_destinations (asset_id,creator_id,destination) VALUES (?,'adelaide',?)").bind(assetId, destination)),
      ...peopleStatements,
      DB.prepare("INSERT INTO asset_classification_events (id,asset_id,creator_id,actor,event_type,snapshot) VALUES (? ,?,'adelaide',?,'attributes_saved',?)")
        .bind(crypto.randomUUID(), assetId, actor, snapshot),
    ];
  });
  await DB.batch(statements);
  revalidatePath("/library");

  const returnTo = String(formData.get("returnTo") ?? "/library");
  redirect(returnTo.startsWith("/library") ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=${assetIds.length}` : "/library");
}

export async function createRedditPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const existingPostId = String(formData.get("postId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "");
  const communityId = Number(formData.get("communityId"));
  const title = String(formData.get("title") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 10000);
  const contentRating = String(formData.get("contentRating") ?? "");
  const intentValue = String(formData.get("intent") ?? "draft");
  const intent = intentValue === "publish_now" ? "publish_now" : intentValue === "schedule" ? "schedule" : "draft";
  const plannedValue = String(formData.get("scheduledAt") ?? "").trim();
  if (!assetId || !Number.isInteger(communityId) || communityId < 1) throw new Error("Choose a Reddit-eligible asset and subreddit.");
  if (!title || title.length > 300) throw new Error("Reddit title must be between 1 and 300 characters.");
  if (contentRating !== "sfw" && contentRating !== "nsfw") throw new Error("Choose the Reddit content rating.");

  let scheduledAt: string | null = null;
  if (intent === "schedule") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(plannedValue)) throw new Error("Choose a planned date and time.");
    const parsed = new Date(`${plannedValue}:00+08:00`);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new Error("The planned time must be in the future.");
    scheduledAt = parsed.toISOString();
  } else if (intent === "publish_now") {
    scheduledAt = new Date().toISOString();
  }

  const env = cloudflareEnv();
  const { DB } = env;
  const [asset, community, account, pairing, existingPost] = await Promise.all([
    DB.prepare(`SELECT a.id,a.extension,c.safety FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id LEFT JOIN asset_classifications c ON c.asset_id=a.id WHERE a.id=? AND a.creator_id='adelaide' AND a.source_available=1 AND d.destination='reddit'`).bind(assetId).first<{ id: string; extension: string; safety: "sfw" | "nsfw" | null }>(),
    DB.prepare("SELECT id,allows_nsfw,status,last_verified_at FROM reddit_communities WHERE id=? AND creator_id='adelaide'").bind(communityId).first<{ id: number; allows_nsfw: number; status: string; last_verified_at: string }>(),
    DB.prepare("SELECT id,connection_status,publishing_authority FROM operational_accounts WHERE creator_id='adelaide' AND platform='reddit' ORDER BY label LIMIT 1").first<{ id: string; connection_status: string; publishing_authority: string }>(),
    DB.prepare("SELECT last_seen_at FROM reddit_bridge_tokens WHERE creator_id='adelaide' AND status='active' AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").first<{ last_seen_at: string | null }>(),
    existingPostId ? DB.prepare("SELECT id,status FROM social_posts WHERE id=? AND creator_id='adelaide' AND platform='reddit'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Reddit.");
  if (!asset.safety) throw new Error("Classify the asset as SFW or NSFW before creating a Reddit post.");
  if (!["jpg", "jpeg", "png", "webp", "gif"].includes(asset.extension.toLowerCase().replace(/^\./, ""))) throw new Error("The native Reddit bridge currently supports image posts. Native video will be enabled after its separate composer is verified.");
  if (asset.safety !== contentRating) throw new Error(`This asset is classified ${asset.safety.toUpperCase()}; use the matching Reddit content rating.`);
  if (!community || community.status !== "active") throw new Error("That subreddit is not active.");
  if (contentRating === "nsfw" && !community.allows_nsfw) throw new Error("That subreddit is not recorded as allowing NSFW posts.");
  const rulesCheckedAt = new Date(`${community.last_verified_at}T00:00:00Z`).getTime();
  if (!Number.isFinite(rulesCheckedAt) || Date.now() - rulesCheckedAt > 30 * 24 * 60 * 60 * 1000) throw new Error("Recheck this subreddit’s rules before scheduling a post.");
  if (!account) throw new Error("Add the Reddit account before creating a post.");
  if (intent !== "draft" && account.connection_status !== "connected") throw new Error("Reconnect and verify Reddit before approving native delivery.");
  if (intent !== "draft" && !pairing?.last_seen_at) throw new Error("Open and pair Adelaide’s Reddit browser before approving native delivery.");
  if (existingPostId && (!existingPost || !["draft", "scheduled"].includes(existingPost.status))) throw new Error("Only draft or scheduled Reddit posts can be edited.");

  const actor = identity.email ?? "connect@thrillnoir.com";
  const status = intent === "draft" ? "draft" : "scheduled";
  let postId = existingPostId || crypto.randomUUID();
  if (!existingPostId && status === "scheduled") {
    const intentWindow = intent === "publish_now" ? scheduledAt!.slice(0, 16) : scheduledAt;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(["adelaide", account.id, asset.id, caption, intent, intentWindow].join("|")));
    postId = `reddit-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  }
  const eventType = intent === "publish_now" ? "post_now_approved" : intent === "schedule" ? "post_scheduled" : existingPostId ? "draft_updated" : "draft_created";
  if (existingPostId) {
    const update = await DB.prepare(`UPDATE social_posts SET account_id=?,asset_id=?,community_id=?,title=?,caption=?,content_rating=?,status=?,scheduled_at=?,approved_by=?,approved_at=CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END,error=NULL,claimed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='reddit' AND status IN ('draft','scheduled')`)
      .bind(account.id, asset.id, community.id, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status, postId).run();
    if (!update.meta?.changes) throw new Error("This Reddit post changed before it could be saved. Refresh and try again.");
    await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,?,?)").bind(crypto.randomUUID(), postId, actor, eventType, JSON.stringify({ scheduledAt, communityId, contentRating, deliveryMode: "native_device" })).run();
  } else {
    await DB.batch([
      DB.prepare(`INSERT INTO social_posts (id,creator_id,platform,account_id,asset_id,community_id,title,caption,content_rating,status,scheduled_at,approved_by,approved_at) VALUES (?,'adelaide','reddit',?,?,?,?,?,?,?,?,?,CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(postId, account.id, asset.id, community.id, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status),
      DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,?,?)").bind(crypto.randomUUID(), postId, actor, eventType, JSON.stringify({ scheduledAt, communityId, contentRating, deliveryMode: "native_device" })),
    ]);
  }
  revalidatePath("/operations");
  if (intent === "publish_now") {
    try {
      const response = await env.REDDIT_SCHEDULER.fetch("https://reddit-scheduler/posts/reddit/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const result = await response.json() as { ok?: boolean; post?: { status?: string } };
      if (result.post?.status === "published") redirect("/operations?platform=reddit&section=past&published=now");
      if (result.post?.status === "failed") redirect("/operations?platform=reddit&section=past&delivery=failed");
    } catch (error) {
      if (typeof error === "object" && error && "digest" in error) throw error;
    }
    redirect("/operations?platform=reddit&section=upcoming&saved=queued");
  }
  redirect(`/operations?platform=reddit&section=upcoming&saved=${intent === "schedule" ? "scheduled" : "draft"}`);
}

export async function saveRedditCommunityAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const suppliedName = String(formData.get("name") ?? "").trim();
  let communityName = suppliedName;
  try {
    const url = new URL(suppliedName);
    communityName = url.pathname.match(/^\/r\/([^/]+)/i)?.[1] ?? suppliedName;
  } catch {
    communityName = suppliedName.replace(/^(?:www\.)?reddit\.com\/r\//i, "").replace(/^\/?r\//i, "").split(/[/?#]/)[0];
  }
  communityName = communityName.trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(communityName)) throw new Error("Enter a valid subreddit name, r/community, or Reddit community URL.");
  if (formData.get("rulesChecked") !== "yes") throw new Error("Open and check the community’s current rules before saving it.");

  const allowedPostTypesValue = String(formData.get("allowedPostTypes") ?? "image");
  const allowedPostTypes = ["image", "video", "image,video"].includes(allowedPostTypesValue) ? allowedPostTypesValue : "image";
  const boundedInteger = (key: string, maximum: number) => {
    const raw = String(formData.get(key) ?? "0").trim();
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${key} must be a whole number between 0 and ${maximum}.`);
    return value;
  };
  const allowsNsfw = formData.get("allowsNsfw") === "on" ? 1 : 0;
  const flairRequired = formData.get("flairRequired") === "on" ? 1 : 0;
  const creatorVerified = formData.get("creatorVerified") === "on" ? 1 : 0;
  const verificationRequired = formData.get("verificationRequired") === "on" ? 1 : 0;
  const cooldownHours = boundedInteger("cooldownHours", 720);
  const minimumAccountAgeDays = boundedInteger("minimumAccountAgeDays", 3650);
  const minimumKarma = boundedInteger("minimumKarma", 1000000);
  const titleGuidance = String(formData.get("titleGuidance") ?? "").trim().slice(0, 1000);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  const rulesUrl = `https://www.reddit.com/r/${communityName}/about/rules`;
  const rulesCheckedAt = new Date().toISOString().slice(0, 10);
  const actor = identity.email ?? "connect@thrillnoir.com";
  const detail = JSON.stringify({
    name: communityName,
    allowsNsfw: Boolean(allowsNsfw),
    flairRequired: Boolean(flairRequired),
    creatorVerified: Boolean(creatorVerified),
    verificationRequired: Boolean(verificationRequired),
    allowedPostTypes,
    cooldownHours,
    minimumAccountAgeDays,
    minimumKarma,
    rulesCheckedAt,
  });
  const { DB } = cloudflareEnv();
  await DB.batch([
    DB.prepare(`INSERT INTO reddit_communities
      (creator_id,name,rules_url,status,allows_nsfw,creator_verified,verification_required,flair_required,allowed_post_types,minimum_account_age_days,minimum_karma,cooldown_hours,title_guidance,notes,last_verified_at,updated_at)
      VALUES ('adelaide',?,?,'active',?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,name) DO UPDATE SET rules_url=excluded.rules_url,status='active',allows_nsfw=excluded.allows_nsfw,
        creator_verified=excluded.creator_verified,verification_required=excluded.verification_required,flair_required=excluded.flair_required,
        allowed_post_types=excluded.allowed_post_types,minimum_account_age_days=excluded.minimum_account_age_days,minimum_karma=excluded.minimum_karma,
        cooldown_hours=excluded.cooldown_hours,title_guidance=excluded.title_guidance,notes=excluded.notes,last_verified_at=excluded.last_verified_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(communityName, rulesUrl, allowsNsfw, creatorVerified, verificationRequired, flairRequired, allowedPostTypes, minimumAccountAgeDays, minimumKarma, cooldownHours, titleGuidance, notes, rulesCheckedAt),
    DB.prepare(`INSERT INTO reddit_community_events (id,community_id,creator_id,actor,event_type,detail)
      SELECT ?,id,'adelaide',?,'community_saved',? FROM reddit_communities WHERE creator_id='adelaide' AND name=?`)
      .bind(crypto.randomUUID(), actor, detail, communityName),
  ]);
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=communities&community=saved");
}

export async function cancelRedditPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const postId = String(formData.get("postId") ?? "");
  const { DB } = cloudflareEnv();
  const result = await DB.prepare("UPDATE social_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='reddit' AND status IN ('draft','scheduled')").bind(postId).run();
  if (!result.meta?.changes) throw new Error("Only draft or scheduled Reddit posts can be cancelled.");
  await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'post_cancelled','{}')").bind(crypto.randomUUID(), postId, identity.email ?? "connect@thrillnoir.com").run();
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=upcoming&saved=cancelled");
}

export async function reviewFailedRedditPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const postId = String(formData.get("postId") ?? "");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB } = cloudflareEnv();
  const result = await DB.prepare("UPDATE social_posts SET failure_reviewed_at=CURRENT_TIMESTAMP,failure_reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='reddit' AND status='failed' AND failure_reviewed_at IS NULL").bind(actor, postId).run();
  if (!result.meta?.changes) throw new Error("This failed post has already been reviewed or is no longer failed.");
  await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'failure_reviewed','{}')").bind(crypto.randomUUID(), postId, actor).run();
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=past&reviewed=1");
}

export async function startRedditReconnectAction() {
  const identity = await requireAccessIdentity();
  const env = cloudflareEnv();
  const callbackUrl = new URL("/api/operations/reddit/callback", env.APP_BASE_URL).toString();
  const response = await env.REDDIT_SCHEDULER.fetch("https://reddit-scheduler/connections/reddit/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callbackUrl, actor: identity.email }),
  });
  const result = await response.json() as { ok?: boolean; redirectUrl?: string; error?: string };
  if (!response.ok || !result.redirectUrl) throw new Error(result.error || "Reddit reconnection could not be started.");
  redirect(result.redirectUrl);
}

export async function openRedditBridgeAction() {
  await requireAccessIdentity();
  const { DB } = cloudflareEnv();
  const account = await DB.prepare("SELECT id,handle FROM operational_accounts WHERE id='adelaide-reddit-main' AND creator_id='adelaide' AND platform='reddit'").first<{ id: string; handle: string }>();
  if (!account) throw new Error("Adelaide’s Reddit account is not configured.");
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await DB.batch([
    DB.prepare("UPDATE reddit_bridge_tokens SET status='revoked' WHERE creator_id='adelaide' AND account_id=? AND status='active'").bind(account.id),
    DB.prepare("INSERT INTO reddit_bridge_tokens (id,creator_id,account_id,token_hash,status,expires_at) VALUES (?,'adelaide',?,?,'active',datetime('now','+90 days'))").bind(crypto.randomUUID(), account.id, tokenHash),
    DB.prepare("UPDATE operational_accounts SET publishing_mode='local_bridge',publishing_authority='device_only',warning_level='attention',warning_message='Finish pairing Adelaide’s signed Reddit browser for native scheduled posts.',last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(account.id),
  ]);
  redirect(`https://www.reddit.com/submit#creator_os_reddit_pair=${encodeURIComponent(token)}`);
}

export async function createInstagramPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const existingPostId = String(formData.get("postId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 2200);
  const intentValue = String(formData.get("intent") ?? "draft");
  const intent = intentValue === "publish_now" ? "publish_now" : intentValue === "schedule" ? "schedule" : "draft";
  const plannedValue = String(formData.get("scheduledAt") ?? "").trim();
  if (!assetId) throw new Error("Choose an Instagram-eligible asset.");
  if (!caption) throw new Error("Write the Instagram caption before approval.");

  let scheduledAt: string | null = null;
  if (intent === "schedule") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(plannedValue)) throw new Error("Choose a planned date and time.");
    const parsed = new Date(`${plannedValue}:00+08:00`);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new Error("The planned time must be in the future.");
    scheduledAt = parsed.toISOString();
  } else if (intent === "publish_now") {
    scheduledAt = new Date().toISOString();
  }

  const env = cloudflareEnv();
  const { DB } = env;
  const [asset, account, existingPost] = await Promise.all([
    DB.prepare(`SELECT a.id,a.extension,c.safety FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id LEFT JOIN asset_classifications c ON c.asset_id=a.id WHERE a.id=? AND a.creator_id='adelaide' AND a.source_available=1 AND d.destination='instagram'`).bind(assetId).first<{ id: string; extension: string; safety: "sfw" | "nsfw" | null }>(),
    DB.prepare("SELECT id,connection_status,publishing_authority FROM operational_accounts WHERE creator_id='adelaide' AND platform='instagram' ORDER BY label LIMIT 1").first<{ id: string; connection_status: string; publishing_authority: string }>(),
    existingPostId ? DB.prepare("SELECT id,status FROM social_posts WHERE id=? AND creator_id='adelaide' AND platform='instagram'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Instagram.");
  if (asset.safety !== "sfw") throw new Error("Instagram publishing requires an asset classified SFW.");
  const extension = asset.extension.toLowerCase().replace(/^\./, "");
  if (!["jpg", "jpeg", "png", "mp4", "mov"].includes(extension)) throw new Error("Instagram supports JPG, PNG, MP4 or MOV in this workflow.");
  if (!account) throw new Error("Add the Instagram account before creating a post.");
  if (intent !== "draft" && (account.connection_status !== "connected" || account.publishing_authority !== "confirmed")) throw new Error("Reconnect and verify Instagram before approving delivery.");
  if (existingPostId && (!existingPost || !["draft", "scheduled"].includes(existingPost.status))) throw new Error("Only draft or scheduled Instagram posts can be edited.");

  const actor = identity.email ?? "connect@thrillnoir.com";
  const status = intent === "draft" ? "draft" : "scheduled";
  let postId = existingPostId || crypto.randomUUID();
  if (!existingPostId && status === "scheduled") {
    const intentWindow = intent === "publish_now" ? scheduledAt!.slice(0, 16) : scheduledAt;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(["adelaide", account.id, asset.id, caption, intent, intentWindow].join("|")));
    postId = `instagram-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  }
  const eventType = intent === "publish_now" ? "post_now_approved" : intent === "schedule" ? "post_scheduled" : existingPostId ? "draft_updated" : "draft_created";
  if (existingPostId) {
    const update = await DB.prepare(`UPDATE social_posts SET account_id=?,asset_id=?,title='',caption=?,content_rating='sfw',status=?,scheduled_at=?,approved_by=?,approved_at=CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END,error=NULL,claimed_at=NULL,provider_container_id=NULL,provider_container_type=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='instagram' AND status IN ('draft','scheduled')`)
      .bind(account.id, asset.id, caption, status, scheduledAt, status === "scheduled" ? actor : null, status, postId).run();
    if (!update.meta?.changes) throw new Error("This Instagram post changed before it could be saved. Refresh and try again.");
    await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,?,?)").bind(crypto.randomUUID(), postId, actor, eventType, JSON.stringify({ scheduledAt, mediaType: ["mp4", "mov"].includes(extension) ? "reel" : "photo" })).run();
  } else {
    const inserted = await DB.prepare(`INSERT OR IGNORE INTO social_posts (id,creator_id,platform,account_id,asset_id,title,caption,content_rating,status,scheduled_at,approved_by,approved_at) VALUES (?,'adelaide','instagram',?,?,'',?,'sfw',?,?,?,CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(postId, account.id, asset.id, caption, status, scheduledAt, status === "scheduled" ? actor : null, status).run();
    if (!inserted.meta?.changes) redirect("/operations?platform=instagram&section=upcoming&saved=already_queued");
    await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,?,?)").bind(crypto.randomUUID(), postId, actor, eventType, JSON.stringify({ scheduledAt, mediaType: ["mp4", "mov"].includes(extension) ? "reel" : "photo" })).run();
  }
  revalidatePath("/operations");
  if (intent === "publish_now") {
    try {
      const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/posts/instagram/publish", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postId }),
      });
      const result = await response.json() as { post?: { status?: string } };
      if (result.post?.status === "published") redirect("/operations?platform=instagram&section=past&published=now");
      if (result.post?.status === "failed") redirect("/operations?platform=instagram&section=past&delivery=failed");
    } catch (error) {
      if (typeof error === "object" && error && "digest" in error) throw error;
    }
    redirect("/operations?platform=instagram&section=upcoming&saved=queued");
  }
  redirect(`/operations?platform=instagram&section=upcoming&saved=${intent === "schedule" ? "scheduled" : "draft"}`);
}

export async function cancelInstagramPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const postId = String(formData.get("postId") ?? "");
  const { DB } = cloudflareEnv();
  const result = await DB.prepare("UPDATE social_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='instagram' AND status IN ('draft','scheduled')").bind(postId).run();
  if (!result.meta?.changes) throw new Error("Only draft or scheduled Instagram posts can be cancelled.");
  await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'post_cancelled','{}')").bind(crypto.randomUUID(), postId, identity.email ?? "connect@thrillnoir.com").run();
  revalidatePath("/operations");
  redirect("/operations?platform=instagram&section=upcoming&saved=cancelled");
}

export async function reviewFailedInstagramPostAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const postId = String(formData.get("postId") ?? "");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB } = cloudflareEnv();
  const result = await DB.prepare("UPDATE social_posts SET failure_reviewed_at=CURRENT_TIMESTAMP,failure_reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='instagram' AND status='failed' AND failure_reviewed_at IS NULL").bind(actor, postId).run();
  if (!result.meta?.changes) throw new Error("This failed Instagram post has already been reviewed or is no longer failed.");
  await DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'failure_reviewed','{}')").bind(crypto.randomUUID(), postId, actor).run();
  revalidatePath("/operations");
  redirect("/operations?platform=instagram&section=past&reviewed=1");
}

export async function startInstagramReconnectAction() {
  const identity = await requireAccessIdentity();
  const env = cloudflareEnv();
  const callbackUrl = new URL("/api/operations/instagram/callback", env.APP_BASE_URL).toString();
  const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/connections/instagram/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callbackUrl, actor: identity.email }),
  });
  const result = await response.json() as { redirectUrl?: string; error?: string };
  if (!response.ok || !result.redirectUrl) throw new Error(result.error || "Instagram reconnection could not be started.");
  redirect(result.redirectUrl);
}

export async function refreshInstagramDataAction() {
  await requireAccessIdentity();
  const env = cloudflareEnv();
  const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/sync", { method: "POST" });
  const result = await response.json() as { ok?: boolean; errors?: string[]; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Instagram data could not be refreshed.");
  revalidatePath("/operations");
  revalidatePath("/messages");
  redirect("/operations?platform=instagram&section=analytics&saved=refreshed");
}

export async function refreshInstagramMessagesAction(formData: FormData) {
  await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const env = cloudflareEnv();
  const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/sync/messages", { method: "POST" });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Instagram messages could not be refreshed.");
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=instagram_messages_refreshed`);
}

export async function markInstagramThreadReadAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!threadId) throw new Error("Choose an Instagram conversation to mark as read.");
  const env = cloudflareEnv();
  const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/messages/instagram/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, actor: identity.email ?? "connect@thrillnoir.com" }),
  });
  const result = await response.json() as { ok?: boolean; markedSeen?: boolean; error?: string };
  if (!response.ok || !result.ok || !result.markedSeen) throw new Error(result.error || "Instagram did not confirm that the conversation was marked as read.");
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_thread_read`);
}

export async function sendInstagramQuickReplyAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!threadId) throw new Error("Choose an Instagram conversation.");
  if (!body || body.length > 1000) throw new Error("Instagram replies must contain between 1 and 1,000 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Instagram reply.");

  const env = cloudflareEnv();
  const thread = await env.DB.prepare(`SELECT t.id,t.connection_id,
      (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=t.creator_id AND m.thread_id=t.id AND m.direction='inbound') AS last_inbound_at,
      c.status,c.write_enabled,c.outbound_validated,c.emergency_paused
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id='adelaide' AND c.platform='instagram'`).bind(threadId)
    .first<{ id: string; connection_id: string; last_inbound_at: string | null; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!thread) throw new Error("That Instagram conversation is outside Adelaide’s workspace.");
  if (thread.status !== "connected" || !thread.write_enabled || !thread.outbound_validated || thread.emergency_paused) throw new Error("Instagram sending is not currently authorised.");
  const normalizedInbound = thread.last_inbound_at?.replace(" ", "T") ?? "";
  const lastInboundAt = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedInbound) ? normalizedInbound : `${normalizedInbound}Z`).getTime();
  if (!Number.isFinite(lastInboundAt) || Date.now() - lastInboundAt > 24 * 60 * 60_000) throw new Error("Instagram’s active reply window is closed. Ask the person to send a new message, refresh, then reply.");

  const actor = identity.email ?? "connect@thrillnoir.com";
  let draftId = `instagram-send-${requestId}`;
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO instagram_reply_drafts
    (id,creator_id,connection_id,thread_id,body,status,requested_by)
    VALUES (?,'adelaide',?,?,?,'draft',?)`).bind(draftId, thread.connection_id, thread.id, body, actor).run();
  if (inserted.meta?.changes) {
    await env.DB.prepare(`INSERT OR IGNORE INTO messaging_audit_events
      (id,creator_id,connection_id,thread_id,event_type,actor,detail)
      VALUES (?,'adelaide',?,?,'instagram_quick_send_requested',?,?)`)
      .bind(`instagram-send-audit-${requestId}`, thread.connection_id, thread.id, actor, JSON.stringify({ draftId, characters: body.length, enterToSend: true })).run();
  } else {
    const existing = await env.DB.prepare(`SELECT id,status FROM instagram_reply_drafts
      WHERE creator_id='adelaide' AND (id=? OR (thread_id=? AND body=? AND status IN ('draft','approved','sending')))
      ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).bind(draftId, thread.id, body, draftId).first<{ id: string; status: string }>();
    if (!existing) throw new Error("That Instagram reply could not be queued safely. Refresh Messages and try again.");
    draftId = existing.id;
    if (existing.status === "sent") redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_sent`);
    if (existing.status === "sending") redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_sending`);
    if (existing.status === "uncertain") redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_uncertain`);
    if (existing.status === "failed") redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_send_failed`);
  }

  let saved = "instagram_send_failed";
  try {
    const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/messages/instagram/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId }),
    });
    const result = await response.json() as { ok?: boolean; sent?: boolean; uncertain?: boolean };
    saved = response.ok && result.ok && result.sent ? "instagram_sent" : result.uncertain ? "instagram_uncertain" : "instagram_send_failed";
  } catch (error) {
    const message = `Outcome uncertain; check Instagram before sending again. ${error instanceof Error ? error.message : "The Instagram delivery service did not respond."}`.slice(0, 2000);
    await env.DB.batch([
      env.DB.prepare("UPDATE instagram_reply_drafts SET status='uncertain',error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND status='draft'").bind(message, draftId),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,detail) VALUES (?,'adelaide',?,?, 'instagram_reply_uncertain',?,?)")
        .bind(crypto.randomUUID(), thread.connection_id, thread.id, actor, JSON.stringify({ draftId, error: message })),
    ]);
    saved = "instagram_uncertain";
  }
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=${saved}`);
}

export async function validateInstagramReplyTargetAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!threadId) throw new Error("Choose an Instagram conversation to validate.");
  const env = cloudflareEnv();
  const response = await env.INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/messages/instagram/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId }),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) {
    const error = (result.error || "Instagram reply target validation failed.").slice(0, 500);
    await env.DB.batch([
      env.DB.prepare("UPDATE messaging_connections SET outbound_validated=0,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id='adelaide-messages-instagram' AND creator_id='adelaide'").bind(error),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,detail) VALUES (?,'adelaide','adelaide-messages-instagram',?,'instagram_reply_validation_failed',?,?)")
        .bind(crypto.randomUUID(), threadId, identity.email ?? "connect@thrillnoir.com", JSON.stringify({ error })),
    ]);
    redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_validation_failed`);
  }
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_validated`);
}

export async function createFanslyVaultJobsAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const assetIds = [...new Set(values(formData, "assetId"))].slice(0, 50);
  if (!assetIds.length) throw new Error("Choose at least one paid-ready asset.");
  const { DB } = cloudflareEnv();
  const placeholders = assetIds.map(() => "?").join(",");
  const [assets, missingConsent, account] = await Promise.all([
    DB.prepare(`
      SELECT a.id,a.extension,c.is_multi FROM assets a
      JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      WHERE a.creator_id='adelaide' AND a.source_available=1 AND a.id IN (${placeholders})
        AND EXISTS (SELECT 1 FROM asset_destinations d WHERE d.asset_id=a.id AND d.creator_id=a.creator_id AND d.destination IN ('subscription','ppv'))
    `).bind(...assetIds).all<{ id: string; extension: string; is_multi: number }>(),
    DB.prepare(`
      SELECT DISTINCT ap.asset_id FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.creator_id='adelaide' AND ap.asset_id IN (${placeholders}) AND pc.asset_id IS NULL
    `).bind(...assetIds).all<{ asset_id: string }>(),
    DB.prepare("SELECT id FROM operational_accounts WHERE id='adelaide-fansly-main' AND creator_id='adelaide' AND platform='fansly'").first<{ id: string }>(),
  ]);
  if (!account) throw new Error("Adelaide’s Fansly vault is not configured.");
  if (assets.results.length !== assetIds.length) throw new Error("Every selected asset must be available and tagged Subscription or PPV.");
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "heic", "mp4", "mov"]);
  if (assets.results.some((asset) => !allowed.has(asset.extension.toLowerCase().replace(/^\./, "")))) throw new Error("Fansly vault uploads support images and videos only.");
  if (missingConsent.results.length) throw new Error("Multi-creator assets require recorded paid-use consent before entering Fansly.");
  const actor = identity.email ?? "connect@thrillnoir.com";
  let created = 0;
  for (const assetId of assetIds) {
    const jobId = crypto.randomUUID();
    const inserted = await DB.prepare(`
      INSERT OR IGNORE INTO vault_upload_jobs (id,creator_id,account_id,asset_id,platform,status,approved_by)
      VALUES (?,'adelaide','adelaide-fansly-main',?,'fansly','approved',?)
    `).bind(jobId, assetId, actor).run();
    if (!inserted.meta?.changes) continue;
    created++;
    await DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'upload_approved','{}')").bind(crypto.randomUUID(), jobId, actor).run();
  }
  revalidatePath("/operations");
  redirect(`/operations?platform=fansly&section=queue&saved=${created ? "vault_queued" : "already_queued"}`);
}

export async function openFanslyVaultAction() {
  redirect(await issueFanslyBridgePairing("vault"));
}

export async function openFanslyMessagesAction() {
  redirect(await issueFanslyBridgePairing("messages"));
}

export async function verifyFanslyVaultJobAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const jobId = String(formData.get("jobId") ?? "");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB } = cloudflareEnv();
  const updated = await DB.prepare("UPDATE vault_upload_jobs SET status='verified',completed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='fansly' AND status='staged'").bind(jobId).run();
  if (!updated.meta?.changes) throw new Error("Only a staged Fansly upload can be confirmed.");
  await DB.batch([
    DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'upload_verified','{}')").bind(crypto.randomUUID(), jobId, actor),
    DB.prepare("UPDATE operational_accounts SET last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE id='adelaide-fansly-main'"),
  ]);
  revalidatePath("/operations");
  redirect("/operations?platform=fansly&section=queue&saved=vault_verified");
}

export async function retryFanslyVaultJobAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const jobId = String(formData.get("jobId") ?? "");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB } = cloudflareEnv();
  const updated = await DB.prepare("UPDATE vault_upload_jobs SET status='approved',claimed_at=NULL,completed_at=NULL,error=NULL,receipt='{}',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide' AND platform='fansly' AND status='failed'").bind(jobId).run();
  if (!updated.meta?.changes) throw new Error("Only a failed Fansly upload can be retried.");
  await DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide',?,'retry_approved','{}')").bind(crypto.randomUUID(), jobId, actor).run();
  revalidatePath("/operations");
  redirect("/operations?platform=fansly&section=queue&saved=retry_queued");
}

export async function setMessagingPauseAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const paused = String(formData.get("paused") ?? "") === "yes";
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB } = cloudflareEnv();
  await DB.batch([
    DB.prepare("UPDATE messaging_connections SET emergency_paused=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id='adelaide'").bind(paused ? 1 : 0),
    DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,event_type,actor,detail) VALUES (?,'adelaide','emergency_pause_changed',?,?)").bind(crypto.randomUUID(), actor, JSON.stringify({ paused })),
  ]);
  redirect(`/messages?saved=${paused ? "paused" : "resumed"}`);
}

export async function updateMessagingAuthorityAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const connectionId = String(formData.get("connectionId") ?? "");
  const modeValue = String(formData.get("mode") ?? "observe");
  const mode = modeValue === "assist" || modeValue === "operate" ? modeValue : "observe";
  const readEnabled = formData.get("readEnabled") === "on";
  const writeEnabled = formData.get("writeEnabled") === "on";
  const { DB } = cloudflareEnv();
  const connection = await DB.prepare("SELECT id,platform,status,outbound_validated FROM messaging_connections WHERE id=? AND creator_id='adelaide'").bind(connectionId).first<{ id: string; platform: string; status: string; outbound_validated: number }>();
  if (!connection) throw new Error("That messaging connection is outside Adelaide’s workspace.");
  if (writeEnabled && connection.status !== "connected") throw new Error("Connect this message stream before enabling sending.");
  if (mode !== "observe" && !writeEnabled) throw new Error("Assist and operate modes require draft authority.");
  if (mode === "operate" && !connection.outbound_validated) throw new Error("Controlled outbound validation is required before operate mode can be enabled.");
  const actor = identity.email ?? "connect@thrillnoir.com";
  await DB.batch([
    DB.prepare("UPDATE messaging_connections SET mode=?,read_enabled=?,write_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide'").bind(mode, readEnabled ? 1 : 0, writeEnabled ? 1 : 0, connectionId),
    DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail) VALUES (?,'adelaide',?,'permissions_updated',?,?)").bind(crypto.randomUUID(), connectionId, actor, JSON.stringify({ mode, readEnabled, writeEnabled })),
  ]);
  redirect("/messages?saved=authority");
}

export async function validateTelegramConnectorAction() {
  await requireAccessIdentity();
  const response = await cloudflareEnv().TELEGRAM_BRIDGE.fetch("https://telegram-bridge/validate", { method: "POST" });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) redirect("/messages?platform=telegram&saved=telegram_failed");
  redirect("/messages?platform=telegram&saved=telegram_validated");
}

export async function refreshTelegramMessagesAction(formData: FormData) {
  await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const response = await cloudflareEnv().TELEGRAM_BRIDGE.fetch("https://telegram-bridge/run", { method: "POST" });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Telegram replies could not be refreshed.");
  revalidatePath("/messages");
  redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=telegram_refreshed`);
}

export async function markCollectedThreadReadAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const { DB } = cloudflareEnv();
  const thread = await DB.prepare(`SELECT t.id,t.connection_id,c.platform FROM message_threads t
    JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id='adelaide' AND c.platform IN ('telegram','fansly')`).bind(threadId).first<{ id: string; connection_id: string; platform: string }>();
  if (!thread) throw new Error("That conversation is outside Adelaide’s collected message streams.");
  await DB.batch([
    DB.prepare("UPDATE message_threads SET unread_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide'").bind(thread.id),
    DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,detail) VALUES (?,'adelaide',?,?, 'collected_thread_marked_read',?,'{}')")
      .bind(crypto.randomUUID(), thread.connection_id, thread.id, identity.email ?? "connect@thrillnoir.com"),
  ]);
  revalidatePath("/messages");
  redirect(`/messages?platform=${thread.platform}&thread=${encodeURIComponent(thread.id)}&saved=thread_read`);
}

export async function sendTelegramCreatorMessageAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const message = String(formData.get("message") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!message || message.length > 4096) throw new Error("Telegram messages must contain between 1 and 4,096 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Telegram message.");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const { DB, TELEGRAM_BRIDGE } = cloudflareEnv();
  const connection = await DB.prepare(`SELECT id,status,write_enabled,outbound_validated,emergency_paused FROM messaging_connections
    WHERE id='adelaide-messages-telegram' AND creator_id='adelaide' AND platform='telegram'`).first<{ id: string; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!connection || connection.status !== "connected" || !connection.outbound_validated) throw new Error("Validate Adelaide’s Telegram connection before sending.");
  if (!connection.write_enabled) throw new Error("Enable Telegram sending before sending a message.");
  if (connection.emergency_paused) throw new Error("Messaging is paused for Adelaide.");
  const logId = `telegram-send-${requestId}`;
  const inserted = await DB.prepare("INSERT OR IGNORE INTO telegram_send_log (id,creator_id,connection_id,message_text,status,requested_by) VALUES (?,'adelaide',?,?,'queued',?)").bind(logId, connection.id, message, actor).run();
  if (!inserted.meta?.changes) {
    const existing = await DB.prepare("SELECT status FROM telegram_send_log WHERE id=? AND creator_id='adelaide'").bind(logId).first<{ status: string }>();
    const saved = existing?.status === "sent" ? "telegram_sent" : existing?.status === "failed" ? "telegram_failed" : "telegram_queued";
    redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${saved}`);
  }
  await DB.prepare("INSERT OR IGNORE INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail) VALUES (?,'adelaide',?,'telegram_message_approved',?,?)")
    .bind(`telegram-send-audit-${requestId}`, connection.id, actor, JSON.stringify({ logId, characters: message.length, enterToSend: true })).run();
  const response = await TELEGRAM_BRIDGE.fetch("https://telegram-bridge/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logId }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  revalidatePath("/messages");
  redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${response.ok && result.ok ? "telegram_sent" : "telegram_failed"}`);
}

export async function sendFanslyReplyAction(formData: FormData) {
  const identity = await requireAccessIdentity();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!body || body.length > 2000) throw new Error("Fansly replies must contain between 1 and 2,000 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Fansly reply.");
  const { DB } = cloudflareEnv();
  const thread = await DB.prepare(`SELECT t.id,t.connection_id,c.status,c.write_enabled,c.outbound_validated,c.emergency_paused FROM message_threads t
    JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id='adelaide' AND c.platform='fansly'`).bind(threadId)
    .first<{ id: string; connection_id: string; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!thread) throw new Error("Choose a collected Fansly conversation first.");
  if (thread.status !== "connected" || !thread.write_enabled || !thread.outbound_validated || thread.emergency_paused) throw new Error("Fansly device sending is not currently authorised.");
  const actor = identity.email ?? "connect@thrillnoir.com";
  const draftId = `fansly-send-${requestId}`;
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO premium_message_drafts
      (id,creator_id,connection_id,thread_id,platform,body,status,requested_by,approved_by)
      VALUES (?,'adelaide',?,?,'fansly',?,'approved',?,?)`).bind(draftId, thread.connection_id, thread.id, body, actor, actor),
    DB.prepare(`INSERT OR IGNORE INTO messaging_audit_events
      (id,creator_id,connection_id,thread_id,event_type,actor,detail)
      VALUES (?,'adelaide',?,?, 'fansly_device_send_approved',?,?)`).bind(`fansly-send-audit-${requestId}`, thread.connection_id, thread.id, actor, JSON.stringify({ draftId, characters: body.length, directComposer: true })),
  ]);
  revalidatePath("/messages");
  redirect(`/messages?platform=fansly&thread=${encodeURIComponent(thread.id)}&saved=fansly_reply_queued`);
}
