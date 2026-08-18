"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { destinations, type Destination } from "@/lib/library";
import { issueFanslyBridgePairing } from "@/lib/fansly-pairing";
import { fetchInternalService } from "@/lib/internal-service";

function values(formData: FormData, key: string) {
  return formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean);
}

type PublicProfileLinkInput = {
  id: string;
  label: string;
  destinationUrl: string;
  destinationHost: string;
  sortOrder: number;
};

type PublicProfileVersionRow = {
  id: string;
  profile_id: string;
  creator_id: string;
  slug: string;
  published_version_id: string | null;
  version_number: number;
  display_name: string;
  headline: string;
  bio: string;
  content_checksum: string;
  status: string;
};

const publicProfileSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const publicProfileId = /^[a-zA-Z0-9_-]{1,160}$/;

function publicText(value: FormDataEntryValue | null, maximum: number, label: string, { required = false, collapseWhitespace = false }: { required?: boolean; collapseWhitespace?: boolean } = {}) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  const normalized = (collapseWhitespace ? text.replace(/\s+/g, " ") : text).trim();
  if (required && !normalized) throw new Error(`Enter a ${label}.`);
  if (normalized.length > maximum) throw new Error(`Enter a ${label} of up to ${maximum} characters.`);
  return normalized;
}

function publicProfileSlugValue(value: FormDataEntryValue | null) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!publicProfileSlug.test(slug) || slug.length > 80) throw new Error("Use a public URL slug of lowercase letters, numbers and single hyphens.");
  return slug;
}

function approvedPublicDestination(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Every public link needs a complete HTTPS destination."); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("Every public link must be a credential-free HTTPS destination.");
  return { destinationUrl: url.toString(), destinationHost: url.hostname.toLowerCase() };
}

function publicProfileLinks(formData: FormData) {
  const labels = formData.getAll("linkLabel").map((value) => String(value).replace(/\s+/g, " ").trim());
  const destinations = formData.getAll("linkDestination").map((value) => String(value).trim());
  if (labels.length !== destinations.length || labels.length > 8) throw new Error("A public profile can contain up to eight links.");
  const links = labels.flatMap((label, index): PublicProfileLinkInput[] => {
    const destination = destinations[index];
    if (!label && !destination) return [];
    if (!label || !destination || label.length > 80) throw new Error("Every public link needs a label of up to 80 characters and an HTTPS destination.");
    const approved = approvedPublicDestination(destination);
    return [{ id: crypto.randomUUID(), label, ...approved, sortOrder: index }];
  });
  if (!links.length) throw new Error("Add at least one explicit HTTPS destination before saving this public profile.");
  return links;
}

async function publicProfileChecksum(content: { displayName: string; headline: string; bio: string; links: Array<Pick<PublicProfileLinkInput, "label" | "destinationUrl" | "destinationHost" | "sortOrder">> }) {
  const canonical = JSON.stringify({ ...content, links: content.links.map((link) => ({ label: link.label, destinationUrl: link.destinationUrl, destinationHost: link.destinationHost, sortOrder: link.sortOrder })) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function submittedPublicProfileVersionId(formData: FormData) {
  const id = String(formData.get("versionId") ?? "");
  if (!publicProfileId.test(id)) throw new Error("The requested public profile version is invalid.");
  return id;
}

function cleanFanslyHandle(value: FormDataEntryValue | null) {
  const handle = String(value ?? "").trim().replace(/^@+/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9._-]{2,80}$/.test(handle)) throw new Error("Enter the expected Fansly handle without spaces.");
  return `@${handle}`;
}

function browserInstallationId(value: FormDataEntryValue | null) {
  const installationId = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)) {
    throw new Error("Paste the installation ID shown by this Chrome profile’s THOT OS extension.");
  }
  return installationId;
}

async function requestRedditFlairRefresh(env: CloudflareEnv, creatorId: string, communityId: number) {
  const response = await fetchInternalService(env, "reddit", "reddit.communities.read", env.REDDIT_SCHEDULER, "https://reddit-scheduler/communities/reddit/flairs/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creatorId, communityId }),
  });
  const result = await response.json() as { ok?: boolean; error?: string; flairRequired?: boolean; flairs?: unknown[] };
  if (!response.ok || !result.ok) throw new Error(result.error || "Reddit did not return its current flair choices.");
  return result;
}

export async function addFanslyAccountAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const label = String(formData.get("label") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const handle = cleanFanslyHandle(formData.get("handle"));
  const profileLabel = String(formData.get("profileLabel") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const installationId = browserInstallationId(formData.get("installationId"));
  if (label.length < 2 || profileLabel.length < 2) throw new Error("Enter recognisable account and Chrome profile labels.");

  const { DB } = cloudflareEnv();
  const [existingAccount, installedProfile] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id FROM operational_accounts WHERE creator_id=@creator AND platform='fansly' LIMIT 1").first<{ id: string }>(),
    DB.prepare("SELECT id,creator_id,label,status FROM browser_profiles WHERE installation_id=?").bind(installationId).first<{ id: string; creator_id: string; label: string; status: string }>(),
  ]);
  if (existingAccount) throw new Error("A Fansly account is already configured for this creator. Complete its setup instead of adding another account.");
  if (installedProfile && installedProfile.creator_id !== creatorId) throw new Error("That THOT OS extension profile is assigned to another creator workspace.");
  if (installedProfile?.status === "revoked") throw new Error("That Chrome profile has been revoked. Use an active THOT OS extension profile.");
  const profileId = installedProfile?.id ?? crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const actor = humanAuditActor(identity);
  const statements = [
    ...(installedProfile ? [] : [creatorPrepare(DB, creatorId, "INSERT INTO browser_profiles (id,creator_id,label,created_by,installation_id) VALUES (?,@creator,?,?,?)").bind(profileId, profileLabel, identity.email, installationId)]),
    creatorPrepare(DB, creatorId, `INSERT INTO operational_accounts
      (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,warning_level,warning_message)
      VALUES (?,@creator,'fansly',?,?,'not_connected','local_bridge','device_only','attention','Sign in and confirm the native Fansly identity before pairing this browser bridge.')`).bind(accountId, label, handle),
    creatorPrepare(DB, creatorId, "INSERT INTO account_browser_profiles (creator_id,account_id,platform,profile_id,assigned_by) VALUES (@creator,?,'fansly',?,?)").bind(accountId, profileId, identity.email),
    creatorPrepare(DB, creatorId, `INSERT INTO messaging_connections
      (id,creator_id,account_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
      VALUES (?,@creator,?,'fansly',?,?,'observe',0,0,0,'not_connected','Confirm the signed-in Fansly identity and pair the assigned browser before collecting messages.')`).bind(connectionId, accountId, label, handle),
    identityAuditStatement(DB, actor, "fansly_account_added", accountId, { profileId, installationIdSuffix: installationId.slice(-6), administrativeAction: true }),
  ];
  if (!installedProfile) statements.push(identityAuditStatement(DB, actor, "browser_profile_registered", profileId, { label: profileLabel, installationIdSuffix: installationId.slice(-6), administrativeAction: true }));
  await DB.batch(statements);
  revalidatePath("/accounts");
  revalidatePath("/operations");
  revalidatePath("/messages");
  redirect("/accounts?saved=fansly_added");
}

export async function assignFanslyBrowserProfileAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const profileLabel = String(formData.get("profileLabel") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const installationId = browserInstallationId(formData.get("installationId"));
  if (profileLabel.length < 2) throw new Error("Enter a recognisable Chrome profile label.");

  const { DB } = cloudflareEnv();
  const [account, assignment, installedProfile] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,label,handle FROM operational_accounts WHERE creator_id=@creator AND platform='fansly' LIMIT 1").first<{ id: string; label: string; handle: string }>(),
    creatorPrepare(DB, creatorId, "SELECT profile_id FROM account_browser_profiles WHERE creator_id=@creator AND account_id=(SELECT id FROM operational_accounts WHERE creator_id=@creator AND platform='fansly' LIMIT 1)").first<{ profile_id: string }>(),
    DB.prepare("SELECT id,creator_id,status FROM browser_profiles WHERE installation_id=?").bind(installationId).first<{ id: string; creator_id: string; status: string }>(),
  ]);
  if (!account) throw new Error("Add a Fansly account before assigning its Chrome profile.");
  if (assignment) throw new Error("This Fansly account already has a Chrome profile assignment.");
  if (installedProfile && installedProfile.creator_id !== creatorId) throw new Error("That THOT OS extension profile is assigned to another creator workspace.");
  if (installedProfile?.status === "revoked") throw new Error("That Chrome profile has been revoked. Use an active THOT OS extension profile.");

  const profileId = installedProfile?.id ?? crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const actor = humanAuditActor(identity);
  const statements = [
    ...(installedProfile ? [] : [creatorPrepare(DB, creatorId, "INSERT INTO browser_profiles (id,creator_id,label,created_by,installation_id) VALUES (?,@creator,?,?,?)").bind(profileId, profileLabel, identity.email, installationId)]),
    creatorPrepare(DB, creatorId, "INSERT INTO account_browser_profiles (creator_id,account_id,platform,profile_id,assigned_by) VALUES (@creator,?,'fansly',?,?)").bind(account.id, profileId, identity.email),
    creatorPrepare(DB, creatorId, `UPDATE operational_accounts SET connection_status='not_connected',external_identity_confirmed_at=NULL,last_checked_at=NULL,warning_level='attention',warning_message='Chrome profile assigned. Sign in natively and confirm the visible identity before pairing this browser bridge.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator`).bind(account.id),
    creatorPrepare(DB, creatorId, `INSERT INTO messaging_connections
      (id,creator_id,account_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
      VALUES (?,@creator,?,'fansly',?,?,'observe',0,0,0,'not_connected','Confirm the signed-in Fansly identity and pair the assigned browser before collecting messages.')
      ON CONFLICT(creator_id,platform,display_name) DO UPDATE SET account_id=excluded.account_id,status='not_connected',last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`).bind(connectionId, account.id, account.label, account.handle),
    identityAuditStatement(DB, actor, "fansly_browser_profile_assigned", account.id, { profileId, installationIdSuffix: installationId.slice(-6), administrativeAction: true }),
  ];
  if (!installedProfile) statements.push(identityAuditStatement(DB, actor, "browser_profile_registered", profileId, { label: profileLabel, installationIdSuffix: installationId.slice(-6), administrativeAction: true }));
  await DB.batch(statements);
  revalidatePath("/accounts");
  revalidatePath("/operations");
  revalidatePath("/messages");
  redirect("/accounts?saved=fansly_profile_assigned");
}

export async function confirmFanslyIdentityAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  if (formData.get("identityConfirmed") !== "yes") throw new Error("Confirm the signed-in native identity before continuing.");
  const observedHandle = cleanFanslyHandle(formData.get("observedHandle"));
  const { DB } = cloudflareEnv();
  const account = await creatorPrepare(DB, creatorId, `SELECT oa.id,oa.handle FROM operational_accounts oa
    JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
    JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id AND bp.status<>'revoked'
    WHERE oa.creator_id=@creator AND oa.platform='fansly' LIMIT 1`).first<{ id: string; handle: string }>();
  if (!account) throw new Error("Assign an active THOT OS Chrome profile before confirming the native identity.");
  if (account.handle.toLowerCase() !== observedHandle.toLowerCase()) throw new Error("The signed-in Fansly handle does not match this creator’s configured account.");
  const actor = humanAuditActor(identity);
  await DB.batch([
    creatorPrepare(DB, creatorId, `UPDATE operational_accounts SET connection_status='needs_check',external_identity_confirmed_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='attention',warning_message='Native identity confirmed. Pair the assigned THOT OS Chrome profile before staging vault uploads.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator`).bind(account.id),
    creatorPrepare(DB, creatorId, "UPDATE messaging_connections SET status='device_bridge_ready',last_error='Browser identity confirmed; bridge pairing is still required.',updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator AND account_id=? AND platform='fansly'").bind(account.id),
    identityAuditStatement(DB, actor, "fansly_identity_confirmed", account.id, { administrativeAction: true }),
  ]);
  revalidatePath("/accounts");
  revalidatePath("/operations");
  redirect("/accounts?saved=fansly_identity_confirmed");
}

export async function syncDropboxCatalogueAction() {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const env = cloudflareEnv();
  let notice = "sync_failed";
  let detail = "";
  try {
    const response = await fetchInternalService(env, "vault_catalogue", "vault.catalogue.refresh", env.VAULT_BRIDGE, "https://vault-bridge/catalogue/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; assets?: number; previews?: { ready?: number; queued?: number; processing?: number; failed?: number }; error?: string };
    if (!response.ok || !result.ok || typeof result.assets !== "number") throw new Error(result.error || `Dropbox catalogue refresh failed (${response.status}).`);
    const previews = result.previews ?? {};
    await identityAuditStatement(env.DB, humanAuditActor(identity), "dropbox_catalogue_refreshed", creatorId, { assets: result.assets, previewsQueued: previews.queued ?? 0, previewsReady: previews.ready ?? 0, previewsFailed: previews.failed ?? 0, readOnlySource: true }).run();
    revalidatePath("/library");
    revalidatePath("/operations");
    notice = `sync_complete&count=${result.assets}&previewQueued=${previews.queued ?? 0}&previewReady=${previews.ready ?? 0}&previewFailed=${previews.failed ?? 0}`;
  } catch (error) {
    detail = (error instanceof Error ? error.message : "Dropbox catalogue refresh failed.").slice(0, 300);
  }
  redirect(`/library?notice=${notice}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`);
}

export async function saveDropboxCatalogueSourceAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const root = String(formData.get("dropboxRoot") ?? "").trim().replace(/\/+$/, "");
  const linkValue = String(formData.get("dropboxLink") ?? "").trim();
  if (!root.startsWith("/") || root.includes("..") || root.length > 500) throw new Error("Enter the Dropbox folder path starting with /.");
  let link = "";
  if (linkValue) {
    let parsed: URL;
    try { parsed = new URL(linkValue); } catch { throw new Error("Enter a complete Dropbox folder or file link."); }
    if (parsed.protocol !== "https:" || !["dropbox.com", "www.dropbox.com"].includes(parsed.hostname.toLowerCase())) throw new Error("Use an https://www.dropbox.com folder or file link.");
    link = parsed.toString();
  }
  const { DB } = cloudflareEnv();
  const updated = await creatorPrepare(DB, creatorId, "UPDATE creators SET dropbox_root=?,dropbox_link=? WHERE id=@creator AND status='active'").bind(root, link || null).run();
  if (!updated.meta?.changes) throw new Error("This creator workspace is not available.");
  await identityAuditStatement(DB, humanAuditActor(identity), "dropbox_catalogue_source_saved", creatorId, { hasReferenceLink: Boolean(link), readOnlySource: true }).run();
  revalidatePath("/accounts");
  revalidatePath("/library");
  redirect("/accounts?saved=dropbox_source_saved");
}

export async function saveAssetAttributesAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
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
  const owned = await creatorPrepare(DB, creatorId, `SELECT id FROM assets WHERE creator_id=@creator AND source_available=1 AND id IN (${placeholders})`).bind(...assetIds).all<{ id: string }>();
  if (owned.results.length !== assetIds.length) throw new Error("One or more selected assets are unavailable.");

  const replacePeople = formData.get("peopleMode") === "replace";
  const personIds = [...new Set(values(formData, "personId").map(Number).filter((value) => Number.isInteger(value) && value > 0))];
  if (replacePeople && personIds.length) {
    const peoplePlaceholders = personIds.map(() => "?").join(",");
    const ownedPeople = await creatorPrepare(DB, creatorId, `SELECT id FROM people WHERE creator_id=@creator AND id IN (${peoplePlaceholders})`).bind(...personIds).all<{ id: number }>();
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

  const actor = identity.email;
  const statements = assetIds.flatMap((assetId) => {
    const snapshot = JSON.stringify({ safety, isTeaser: Boolean(isTeaser), isMulti: Boolean(isMulti), notes, destinations: selectedDestinations, people: replacePeople ? personIds : undefined, paidEvidence: paidConsentConfirmed ? paidEvidence : undefined });
    const peopleStatements = replacePeople ? [
      creatorPrepare(DB, creatorId, "DELETE FROM asset_people WHERE creator_id=@creator AND asset_id=?").bind(assetId),
      ...personIds.map((personId) => creatorPrepare(DB, creatorId, "INSERT INTO asset_people (asset_id,creator_id,person_id,role) VALUES (?,@creator,?,'creator_friend')").bind(assetId, personId)),
      ...(paidConsentConfirmed && paidEvidence ? personIds.map((personId) => creatorPrepare(DB, creatorId, `
        INSERT INTO asset_paid_consent_attestations (asset_id,creator_id,person_id,evidence_platform,confirmed_by,confirmed_at,note,revoked_at)
        VALUES (?,@creator,?,?,?,CURRENT_TIMESTAMP,'Confirmed before paid-platform use',NULL)
        ON CONFLICT(asset_id,person_id) DO UPDATE SET evidence_platform=excluded.evidence_platform,confirmed_by=excluded.confirmed_by,
          confirmed_at=CURRENT_TIMESTAMP,note=excluded.note,revoked_at=NULL
      `).bind(assetId, personId, paidEvidence, actor)) : []),
    ] : [];
    return [
      creatorPrepare(DB, creatorId, `
        INSERT INTO asset_classifications (asset_id,creator_id,safety,is_teaser,is_multi,notes,reviewed_by,reviewed_at,updated_at)
        VALUES (?,@creator,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(asset_id) DO UPDATE SET safety=excluded.safety,is_teaser=excluded.is_teaser,is_multi=excluded.is_multi,
          notes=excluded.notes,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      `).bind(assetId, safety, isTeaser, isMulti, notes, actor),
      creatorPrepare(DB, creatorId, "DELETE FROM asset_destinations WHERE creator_id=@creator AND asset_id=?").bind(assetId),
      ...selectedDestinations.map((destination) => creatorPrepare(DB, creatorId, "INSERT INTO asset_destinations (asset_id,creator_id,destination) VALUES (?,@creator,?)").bind(assetId, destination)),
      ...peopleStatements,
      creatorPrepare(DB, creatorId, "INSERT INTO asset_classification_events (id,asset_id,creator_id,actor,actor_role,event_type,snapshot) VALUES (? ,?,@creator,?,?,'attributes_saved',?)")
        .bind(crypto.randomUUID(), assetId, actor, identity.creator.role, snapshot),
    ];
  });
  await DB.batch(statements);
  revalidatePath("/library");

  const returnTo = String(formData.get("returnTo") ?? "/library");
  redirect(returnTo.startsWith("/library") ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=${assetIds.length}` : "/library");
}

export async function createRedditPostAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const existingPostId = String(formData.get("postId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "");
  const communityId = Number(formData.get("communityId"));
  const flairId = String(formData.get("flairId") ?? "").trim();
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
  const [asset, community, selectedFlair, account, existingPost] = await Promise.all([
    creatorPrepare(DB, creatorId, `SELECT a.id,a.extension,c.safety FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id LEFT JOIN asset_classifications c ON c.asset_id=a.id WHERE a.id=? AND a.creator_id=@creator AND a.source_available=1 AND d.destination='reddit'`).bind(assetId).first<{ id: string; extension: string; safety: "sfw" | "nsfw" | null }>(),
    creatorPrepare(DB, creatorId, "SELECT id,name,allows_nsfw,status,last_verified_at,flair_required,flairs_checked_at FROM reddit_communities WHERE id=? AND creator_id=@creator").bind(communityId).first<{ id: number; name: string; allows_nsfw: number; status: string; last_verified_at: string; flair_required: number; flairs_checked_at: string | null }>(),
    flairId ? creatorPrepare(DB, creatorId, "SELECT flair_id,flair_text,fetched_at FROM reddit_community_flairs WHERE creator_id=@creator AND community_id=? AND flair_id=? AND active=1").bind(communityId, flairId).first<{ flair_id: string; flair_text: string; fetched_at: string }>() : Promise.resolve(null),
    creatorPrepare(DB, creatorId, "SELECT id,connection_status,publishing_authority FROM operational_accounts WHERE creator_id=@creator AND platform='reddit' ORDER BY label LIMIT 1").first<{ id: string; connection_status: string; publishing_authority: string }>(),
    existingPostId ? creatorPrepare(DB, creatorId, "SELECT id,status FROM social_posts WHERE id=? AND creator_id=@creator AND platform='reddit'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Reddit.");
  if (!asset.safety) throw new Error("Classify the asset as SFW or NSFW before creating a Reddit post.");
  if (!["jpg", "jpeg", "png", "webp", "gif"].includes(asset.extension.toLowerCase().replace(/^\./, ""))) throw new Error("Reddit API publishing currently supports image posts. Native video will be enabled after its separate media flow is verified.");
  if (asset.safety !== contentRating) throw new Error(`This asset is classified ${asset.safety.toUpperCase()}; use the matching Reddit content rating.`);
  if (!community || community.status !== "active") throw new Error("That subreddit is not active.");
  if (flairId && !selectedFlair) throw new Error("That Reddit flair is no longer available for the selected subreddit. Refresh its flairs and choose again.");
  if (intent !== "draft" && community.flair_required && !selectedFlair) throw new Error(`r/${community.name} requires post flair. Refresh its flairs and choose one before publishing.`);
  if (intent !== "draft" && community.flair_required && !community.flairs_checked_at) throw new Error(`Refresh r/${community.name} to load its current Reddit flair requirements before publishing.`);
  if (contentRating === "nsfw" && !community.allows_nsfw) throw new Error("That subreddit is not recorded as allowing NSFW posts.");
  const rulesCheckedAt = new Date(`${community.last_verified_at}T00:00:00Z`).getTime();
  if (!Number.isFinite(rulesCheckedAt) || Date.now() - rulesCheckedAt > 30 * 24 * 60 * 60 * 1000) throw new Error("Recheck this subreddit’s rules before scheduling a post.");
  if (!account) throw new Error("Add the Reddit account before creating a post.");
  if (intent !== "draft" && (account.connection_status !== "connected" || account.publishing_authority !== "confirmed")) throw new Error("Reconnect and verify Reddit before approving API delivery.");
  if (existingPostId && (!existingPost || !["draft", "scheduled"].includes(existingPost.status))) throw new Error("Only draft or scheduled Reddit posts can be edited.");

  const actor = identity.email;
  const status = intent === "draft" ? "draft" : "scheduled";
  let postId = existingPostId || crypto.randomUUID();
  if (!existingPostId && status === "scheduled") {
    const intentWindow = intent === "publish_now" ? scheduledAt!.slice(0, 16) : scheduledAt;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([creatorId, account.id, asset.id, community.id, title, caption, contentRating, selectedFlair?.flair_id ?? "", intent, intentWindow].join("|")));
    postId = `reddit-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  }
  const eventType = intent === "publish_now" ? "post_now_approved" : intent === "schedule" ? "post_scheduled" : existingPostId ? "draft_updated" : "draft_created";
  if (existingPostId) {
    const update = await creatorPrepare(DB, creatorId, `UPDATE social_posts SET account_id=?,asset_id=?,community_id=?,reddit_flair_id=?,reddit_flair_text=?,title=?,caption=?,content_rating=?,status=?,scheduled_at=?,approved_by=?,approved_at=CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END,error=NULL,claimed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='reddit' AND status IN ('draft','scheduled')`)
      .bind(account.id, asset.id, community.id, selectedFlair?.flair_id ?? null, selectedFlair?.flair_text ?? null, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status, postId).run();
    if (!update.meta?.changes) throw new Error("This Reddit post changed before it could be saved. Refresh and try again.");
    await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, communityId, contentRating, flairId: selectedFlair?.flair_id ?? null, flairText: selectedFlair?.flair_text ?? null, deliveryMode: "reddit_api" })).run();
  } else {
    await DB.batch([
      creatorPrepare(DB, creatorId, `INSERT INTO social_posts (id,creator_id,platform,account_id,asset_id,community_id,reddit_flair_id,reddit_flair_text,title,caption,content_rating,status,scheduled_at,approved_by,approved_at) VALUES (?,@creator,'reddit',?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(postId, account.id, asset.id, community.id, selectedFlair?.flair_id ?? null, selectedFlair?.flair_text ?? null, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status),
      creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, communityId, contentRating, flairId: selectedFlair?.flair_id ?? null, flairText: selectedFlair?.flair_text ?? null, deliveryMode: "reddit_api" })),
    ]);
  }
  revalidatePath("/operations");
  if (intent === "publish_now") {
    try {
      const response = await fetchInternalService(env, "reddit", "reddit.publish.execute", env.REDDIT_SCHEDULER, "https://reddit-scheduler/posts/reddit/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, creatorId }),
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
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
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
  const actor = identity.email;
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
    creatorPrepare(DB, creatorId, `INSERT INTO reddit_communities
      (creator_id,name,rules_url,status,allows_nsfw,creator_verified,verification_required,flair_required,allowed_post_types,minimum_account_age_days,minimum_karma,cooldown_hours,title_guidance,notes,last_verified_at,updated_at)
      VALUES (@creator,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,name) DO UPDATE SET rules_url=excluded.rules_url,status='active',allows_nsfw=excluded.allows_nsfw,
        creator_verified=excluded.creator_verified,verification_required=excluded.verification_required,flair_required=excluded.flair_required,
        allowed_post_types=excluded.allowed_post_types,minimum_account_age_days=excluded.minimum_account_age_days,minimum_karma=excluded.minimum_karma,
        cooldown_hours=excluded.cooldown_hours,title_guidance=excluded.title_guidance,notes=excluded.notes,last_verified_at=excluded.last_verified_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(communityName, rulesUrl, allowsNsfw, creatorVerified, verificationRequired, flairRequired, allowedPostTypes, minimumAccountAgeDays, minimumKarma, cooldownHours, titleGuidance, notes, rulesCheckedAt),
    creatorPrepare(DB, creatorId, `INSERT INTO reddit_community_events (id,community_id,creator_id,actor,actor_role,event_type,detail)
      SELECT ?,id,@creator,?,?,'community_saved',? FROM reddit_communities WHERE creator_id=@creator AND name=?`)
      .bind(crypto.randomUUID(), actor, identity.creator.role, detail, communityName),
  ]);
  const savedCommunity = await creatorPrepare(DB, creatorId, "SELECT id FROM reddit_communities WHERE creator_id=@creator AND name=?").bind(communityName).first<{ id: number }>();
  let flairState = "unavailable";
  if (savedCommunity) {
    try {
      await requestRedditFlairRefresh(cloudflareEnv(), creatorId, savedCommunity.id);
      flairState = "synced";
    } catch {}
  }
  revalidatePath("/operations");
  redirect(`/operations?platform=reddit&section=communities&community=saved&flairs=${flairState}`);
}

export async function refreshRedditFlairsAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const communityId = Number(formData.get("communityId"));
  if (!Number.isInteger(communityId) || communityId < 1) throw new Error("Choose a saved Reddit community.");
  const community = await creatorPrepare(cloudflareEnv().DB, creatorId, "SELECT id FROM reddit_communities WHERE id=? AND creator_id=@creator AND status='active'").bind(communityId).first<{ id: number }>();
  if (!community) throw new Error("That Reddit community is not active in this creator workspace.");
  await requestRedditFlairRefresh(cloudflareEnv(), creatorId, community.id);
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=communities&flairs=synced");
}

export async function cancelRedditPostAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const postId = String(formData.get("postId") ?? "");
  const { DB } = cloudflareEnv();
  const result = await creatorPrepare(DB, creatorId, "UPDATE social_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='reddit' AND status IN ('draft','scheduled')").bind(postId).run();
  if (!result.meta?.changes) throw new Error("Only draft or scheduled Reddit posts can be cancelled.");
  await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'post_cancelled','{}')").bind(crypto.randomUUID(), postId, identity.email, identity.creator.role).run();
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=upcoming&saved=cancelled");
}

export async function reviewFailedRedditPostAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const postId = String(formData.get("postId") ?? "");
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  const result = await creatorPrepare(DB, creatorId, "UPDATE social_posts SET failure_reviewed_at=CURRENT_TIMESTAMP,failure_reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='reddit' AND status='failed' AND failure_reviewed_at IS NULL").bind(actor, postId).run();
  if (!result.meta?.changes) throw new Error("This failed post has already been reviewed or is no longer failed.");
  await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'failure_reviewed','{}')").bind(crypto.randomUUID(), postId, actor, identity.creator.role).run();
  revalidatePath("/operations");
  redirect("/operations?platform=reddit&section=past&reviewed=1");
}

export async function startRedditReconnectAction() {
  const identity = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  const callbackUrl = new URL("/api/operations/reddit/callback", env.APP_BASE_URL).toString();
  const response = await fetchInternalService(env, "reddit", "reddit.connection.manage", env.REDDIT_SCHEDULER, "https://reddit-scheduler/connections/reddit/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callbackUrl, creatorId: identity.creator.creator_id }),
  });
  const result = await response.json() as { ok?: boolean; redirectUrl?: string; error?: string };
  if (!response.ok || !result.redirectUrl) throw new Error(result.error || "Reddit reconnection could not be started.");
  await identityAuditStatement(env.DB, humanAuditActor(identity), "reddit_connection_requested", "reddit", { providerCallback: true }).run();
  redirect(result.redirectUrl);
}

export async function createInstagramPostAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
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
    creatorPrepare(DB, creatorId, `SELECT a.id,a.extension,c.safety FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id LEFT JOIN asset_classifications c ON c.asset_id=a.id WHERE a.id=? AND a.creator_id=@creator AND a.source_available=1 AND d.destination='instagram'`).bind(assetId).first<{ id: string; extension: string; safety: "sfw" | "nsfw" | null }>(),
    creatorPrepare(DB, creatorId, "SELECT id,connection_status,publishing_authority FROM operational_accounts WHERE creator_id=@creator AND platform='instagram' ORDER BY label LIMIT 1").first<{ id: string; connection_status: string; publishing_authority: string }>(),
    existingPostId ? creatorPrepare(DB, creatorId, "SELECT id,status FROM social_posts WHERE id=? AND creator_id=@creator AND platform='instagram'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Instagram.");
  if (asset.safety !== "sfw") throw new Error("Instagram publishing requires an asset classified SFW.");
  const extension = asset.extension.toLowerCase().replace(/^\./, "");
  if (!["jpg", "jpeg", "png", "mp4", "mov"].includes(extension)) throw new Error("Instagram supports JPG, PNG, MP4 or MOV in this workflow.");
  if (!account) throw new Error("Add the Instagram account before creating a post.");
  if (intent !== "draft" && (account.connection_status !== "connected" || account.publishing_authority !== "confirmed")) throw new Error("Reconnect and verify Instagram before approving delivery.");
  if (existingPostId && (!existingPost || !["draft", "scheduled"].includes(existingPost.status))) throw new Error("Only draft or scheduled Instagram posts can be edited.");

  const actor = identity.email;
  const status = intent === "draft" ? "draft" : "scheduled";
  let postId = existingPostId || crypto.randomUUID();
  if (!existingPostId && status === "scheduled") {
    const intentWindow = intent === "publish_now" ? scheduledAt!.slice(0, 16) : scheduledAt;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([creatorId, account.id, asset.id, caption, intent, intentWindow].join("|")));
    postId = `instagram-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  }
  const eventType = intent === "publish_now" ? "post_now_approved" : intent === "schedule" ? "post_scheduled" : existingPostId ? "draft_updated" : "draft_created";
  if (existingPostId) {
    const update = await creatorPrepare(DB, creatorId, `UPDATE social_posts SET account_id=?,asset_id=?,title='',caption=?,content_rating='sfw',status=?,scheduled_at=?,approved_by=?,approved_at=CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END,error=NULL,claimed_at=NULL,provider_container_id=NULL,provider_container_type=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='instagram' AND status IN ('draft','scheduled')`)
      .bind(account.id, asset.id, caption, status, scheduledAt, status === "scheduled" ? actor : null, status, postId).run();
    if (!update.meta?.changes) throw new Error("This Instagram post changed before it could be saved. Refresh and try again.");
    await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, mediaType: ["mp4", "mov"].includes(extension) ? "reel" : "photo" })).run();
  } else {
    const inserted = await creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO social_posts (id,creator_id,platform,account_id,asset_id,title,caption,content_rating,status,scheduled_at,approved_by,approved_at) VALUES (?,@creator,'instagram',?,?,'',?,'sfw',?,?,?,CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(postId, account.id, asset.id, caption, status, scheduledAt, status === "scheduled" ? actor : null, status).run();
    if (!inserted.meta?.changes) redirect("/operations?platform=instagram&section=upcoming&saved=already_queued");
    await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, mediaType: ["mp4", "mov"].includes(extension) ? "reel" : "photo" })).run();
  }
  revalidatePath("/operations");
  if (intent === "publish_now") {
    try {
      const response = await fetchInternalService(env, "instagram", "instagram.publish.execute", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/posts/instagram/publish", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postId, creatorId }),
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
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const postId = String(formData.get("postId") ?? "");
  const { DB } = cloudflareEnv();
  const result = await creatorPrepare(DB, creatorId, "UPDATE social_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='instagram' AND status IN ('draft','scheduled')").bind(postId).run();
  if (!result.meta?.changes) throw new Error("Only draft or scheduled Instagram posts can be cancelled.");
  await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'post_cancelled','{}')").bind(crypto.randomUUID(), postId, identity.email, identity.creator.role).run();
  revalidatePath("/operations");
  redirect("/operations?platform=instagram&section=upcoming&saved=cancelled");
}

export async function reviewFailedInstagramPostAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const postId = String(formData.get("postId") ?? "");
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  const result = await creatorPrepare(DB, creatorId, "UPDATE social_posts SET failure_reviewed_at=CURRENT_TIMESTAMP,failure_reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='instagram' AND status='failed' AND failure_reviewed_at IS NULL").bind(actor, postId).run();
  if (!result.meta?.changes) throw new Error("This failed Instagram post has already been reviewed or is no longer failed.");
  await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'failure_reviewed','{}')").bind(crypto.randomUUID(), postId, actor, identity.creator.role).run();
  revalidatePath("/operations");
  redirect("/operations?platform=instagram&section=past&reviewed=1");
}

export async function startInstagramReconnectAction() {
  const identity = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  const callbackUrl = new URL("/api/operations/instagram/callback", env.APP_BASE_URL).toString();
  const response = await fetchInternalService(env, "instagram", "instagram.connection.manage", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/connections/instagram/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callbackUrl, creatorId: identity.creator.creator_id }),
  });
  const result = await response.json() as { redirectUrl?: string; error?: string };
  if (!response.ok || !result.redirectUrl) throw new Error(result.error || "Instagram reconnection could not be started.");
  await identityAuditStatement(env.DB, humanAuditActor(identity), "instagram_connection_requested", "instagram", { providerCallback: true }).run();
  redirect(result.redirectUrl);
}

export async function refreshInstagramDataAction() {
  const identity = await requireCreatorContext("mutate");
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "instagram", "instagram.sync.execute", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/sync/analytics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; errors?: string[]; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Instagram data could not be refreshed.");
  revalidatePath("/operations");
  redirect("/operations?platform=instagram&section=analytics&saved=refreshed");
}

export async function refreshInstagramMessagesAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const threadId = String(formData.get("threadId") ?? "").trim();
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "instagram", "instagram.messages.sync", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/sync/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Instagram messages could not be refreshed.");
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=instagram_messages_refreshed`);
}

export async function markInstagramThreadReadAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!threadId) throw new Error("Choose an Instagram conversation to mark as read.");
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "instagram", "instagram.messages.write", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/messages/instagram/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, creatorId: identity.creator.creator_id }),
  });
  const result = await response.json() as { ok?: boolean; markedSeen?: boolean; error?: string };
  if (!response.ok || !result.ok || !result.markedSeen) throw new Error(result.error || "Instagram did not confirm that the conversation was marked as read.");
  await identityAuditStatement(env.DB, humanAuditActor(identity), "instagram_thread_marked_read", threadId, { providerConfirmed: true }).run();
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_thread_read`);
}

export async function sendInstagramQuickReplyAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const threadId = String(formData.get("threadId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!threadId) throw new Error("Choose an Instagram conversation.");
  if (!body || body.length > 1000) throw new Error("Instagram replies must contain between 1 and 1,000 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Instagram reply.");

  const env = cloudflareEnv();
  const thread = await creatorPrepare(env.DB, creatorId, `SELECT t.id,t.connection_id,
      (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=t.creator_id AND m.thread_id=t.id AND m.direction='inbound') AS last_inbound_at,
      c.status,c.write_enabled,c.outbound_validated,c.emergency_paused
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=@creator AND c.platform='instagram'`).bind(threadId)
    .first<{ id: string; connection_id: string; last_inbound_at: string | null; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!thread) throw new Error("That Instagram conversation is outside this creator workspace.");
  if (thread.status !== "connected" || !thread.write_enabled || !thread.outbound_validated || thread.emergency_paused) throw new Error("Instagram sending is not currently authorised.");
  const normalizedInbound = thread.last_inbound_at?.replace(" ", "T") ?? "";
  const lastInboundAt = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedInbound) ? normalizedInbound : `${normalizedInbound}Z`).getTime();
  if (!Number.isFinite(lastInboundAt) || Date.now() - lastInboundAt > 24 * 60 * 60_000) throw new Error("Instagram’s active reply window is closed. Ask the person to send a new message, refresh, then reply.");

  const actor = identity.email;
  let draftId = `instagram-send-${requestId}`;
  const inserted = await creatorPrepare(env.DB, creatorId, `INSERT OR IGNORE INTO instagram_reply_drafts
    (id,creator_id,connection_id,thread_id,body,status,requested_by)
    VALUES (?,@creator,?,?,?,'draft',?)`).bind(draftId, thread.connection_id, thread.id, body, actor).run();
  if (inserted.meta?.changes) {
    await creatorPrepare(env.DB, creatorId, `INSERT OR IGNORE INTO messaging_audit_events
      (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail)
      VALUES (?,@creator,?,?,'instagram_quick_send_requested',?,?,?)`)
      .bind(`instagram-send-audit-${requestId}`, thread.connection_id, thread.id, actor, identity.creator.role, JSON.stringify({ draftId, characters: body.length, enterToSend: true })).run();
  } else {
    const existing = await creatorPrepare(env.DB, creatorId, `SELECT id,status FROM instagram_reply_drafts
      WHERE creator_id=@creator AND (id=? OR (thread_id=? AND body=? AND status IN ('draft','approved','sending')))
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
    const response = await fetchInternalService(env, "instagram", "instagram.messages.write", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/messages/instagram/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId, creatorId }),
    });
    const result = await response.json() as { ok?: boolean; sent?: boolean; uncertain?: boolean };
    saved = response.ok && result.ok && result.sent ? "instagram_sent" : result.uncertain ? "instagram_uncertain" : "instagram_send_failed";
  } catch (error) {
    const message = `Outcome uncertain; check Instagram before sending again. ${error instanceof Error ? error.message : "The Instagram delivery service did not respond."}`.slice(0, 2000);
    await env.DB.batch([
      creatorPrepare(env.DB, creatorId, "UPDATE instagram_reply_drafts SET status='uncertain',error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND status='draft'").bind(message, draftId),
      creatorPrepare(env.DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,?, 'instagram_reply_uncertain',?,?,?)")
        .bind(crypto.randomUUID(), thread.connection_id, thread.id, actor, identity.creator.role, JSON.stringify({ draftId, error: message })),
    ]);
    saved = "instagram_uncertain";
  }
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=${saved}`);
}

export async function validateInstagramReplyTargetAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!threadId) throw new Error("Choose an Instagram conversation to validate.");
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "instagram", "instagram.messages.write", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/messages/instagram/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, creatorId }),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) {
    const error = (result.error || "Instagram reply target validation failed.").slice(0, 500);
    await env.DB.batch([
      creatorPrepare(env.DB, creatorId, "UPDATE messaging_connections SET outbound_validated=0,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator AND platform='instagram'").bind(error),
      creatorPrepare(env.DB, creatorId, `INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail)
        SELECT ?,@creator,id,?,'instagram_reply_validation_failed',?,?,? FROM messaging_connections WHERE creator_id=@creator AND platform='instagram' LIMIT 1`)
        .bind(crypto.randomUUID(), threadId, identity.email, identity.creator.role, JSON.stringify({ error })),
    ]);
    redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_validation_failed`);
  }
  revalidatePath("/messages");
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(threadId)}&saved=instagram_validated`);
}

export async function createFanslyVaultJobsAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const assetIds = [...new Set(values(formData, "assetId"))].slice(0, 50);
  if (!assetIds.length) throw new Error("Choose at least one paid-ready asset.");
  const { DB } = cloudflareEnv();
  const placeholders = assetIds.map(() => "?").join(",");
  const [assets, missingConsent, account] = await Promise.all([
    creatorPrepare(DB, creatorId, `
      SELECT a.id,a.extension,c.is_multi FROM assets a
      JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      WHERE a.creator_id=@creator AND a.source_available=1 AND a.id IN (${placeholders})
        AND EXISTS (SELECT 1 FROM asset_destinations d WHERE d.asset_id=a.id AND d.creator_id=a.creator_id AND d.destination IN ('subscription','ppv'))
    `).bind(...assetIds).all<{ id: string; extension: string; is_multi: number }>(),
    creatorPrepare(DB, creatorId, `
      SELECT DISTINCT ap.asset_id FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.creator_id=@creator AND ap.asset_id IN (${placeholders}) AND pc.asset_id IS NULL
    `).bind(...assetIds).all<{ asset_id: string }>(),
    creatorPrepare(DB, creatorId, "SELECT id FROM operational_accounts WHERE creator_id=@creator AND platform='fansly' ORDER BY label LIMIT 1").first<{ id: string }>(),
  ]);
  if (!account) throw new Error("This creator’s Fansly vault is not configured.");
  if (assets.results.length !== assetIds.length) throw new Error("Every selected asset must be available and tagged Subscription or PPV.");
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "heic", "mp4", "mov"]);
  if (assets.results.some((asset) => !allowed.has(asset.extension.toLowerCase().replace(/^\./, "")))) throw new Error("Fansly vault uploads support images and videos only.");
  if (missingConsent.results.length) throw new Error("Multi-creator assets require recorded paid-use consent before entering Fansly.");
  const actor = identity.email;
  let created = 0;
  for (const assetId of assetIds) {
    const jobId = crypto.randomUUID();
    const inserted = await creatorPrepare(DB, creatorId, `
      INSERT OR IGNORE INTO vault_upload_jobs (id,creator_id,account_id,asset_id,platform,status,approved_by)
      VALUES (?,@creator,?,?,'fansly','approved',?)
    `).bind(jobId, account.id, assetId, actor).run();
    if (!inserted.meta?.changes) continue;
    created++;
    await creatorPrepare(DB, creatorId, "INSERT INTO vault_upload_events (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'upload_approved','{}')").bind(crypto.randomUUID(), jobId, actor, identity.creator.role).run();
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
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const jobId = String(formData.get("jobId") ?? "");
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  const updated = await creatorPrepare(DB, creatorId, "UPDATE vault_upload_jobs SET status='verified',completed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='fansly' AND status='staged'").bind(jobId).run();
  if (!updated.meta?.changes) throw new Error("Only a staged Fansly upload can be confirmed.");
  await DB.batch([
    creatorPrepare(DB, creatorId, "INSERT INTO vault_upload_events (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'upload_verified','{}')").bind(crypto.randomUUID(), jobId, actor, identity.creator.role),
    creatorPrepare(DB, creatorId, "UPDATE operational_accounts SET last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator AND platform='fansly'").bind(),
  ]);
  revalidatePath("/operations");
  redirect("/operations?platform=fansly&section=queue&saved=vault_verified");
}

export async function retryFanslyVaultJobAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const jobId = String(formData.get("jobId") ?? "");
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  const updated = await creatorPrepare(DB, creatorId, "UPDATE vault_upload_jobs SET status='approved',claimed_at=NULL,completed_at=NULL,error=NULL,receipt='{}',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='fansly' AND status='failed'").bind(jobId).run();
  if (!updated.meta?.changes) throw new Error("Only a failed Fansly upload can be retried.");
  await creatorPrepare(DB, creatorId, "INSERT INTO vault_upload_events (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,'retry_approved','{}')").bind(crypto.randomUUID(), jobId, actor, identity.creator.role).run();
  revalidatePath("/operations");
  redirect("/operations?platform=fansly&section=queue&saved=retry_queued");
}

export async function setMessagingPauseAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const paused = String(formData.get("paused") ?? "") === "yes";
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  await DB.batch([
    creatorPrepare(DB, creatorId, "UPDATE messaging_connections SET emergency_paused=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator").bind(paused ? 1 : 0),
    creatorPrepare(DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,event_type,actor,actor_role,detail) VALUES (?,@creator,'emergency_pause_changed',?,?,?)").bind(crypto.randomUUID(), actor, identity.creator.role, JSON.stringify({ paused })),
  ]);
  redirect(`/messages?saved=${paused ? "paused" : "resumed"}`);
}

export async function updateMessagingAuthorityAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const connectionId = String(formData.get("connectionId") ?? "");
  const modeValue = String(formData.get("mode") ?? "observe");
  const mode = modeValue === "assist" || modeValue === "operate" ? modeValue : "observe";
  const readEnabled = formData.get("readEnabled") === "on";
  const writeEnabled = formData.get("writeEnabled") === "on";
  const { DB } = cloudflareEnv();
  const connection = await creatorPrepare(DB, creatorId, "SELECT id,platform,status,outbound_validated FROM messaging_connections WHERE id=? AND creator_id=@creator").bind(connectionId).first<{ id: string; platform: string; status: string; outbound_validated: number }>();
  if (!connection) throw new Error("That messaging connection is outside this creator’s workspace.");
  if (writeEnabled && connection.status !== "connected") throw new Error("Connect this message stream before enabling sending.");
  if (mode !== "observe" && !writeEnabled) throw new Error("Assist and operate modes require draft authority.");
  if (mode === "operate" && !connection.outbound_validated) throw new Error("Controlled outbound validation is required before operate mode can be enabled.");
  const actor = identity.email;
  await DB.batch([
    creatorPrepare(DB, creatorId, "UPDATE messaging_connections SET mode=?,read_enabled=?,write_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator").bind(mode, readEnabled ? 1 : 0, writeEnabled ? 1 : 0, connectionId),
    creatorPrepare(DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,'permissions_updated',?,?,?)").bind(crypto.randomUUID(), connectionId, actor, identity.creator.role, JSON.stringify({ mode, readEnabled, writeEnabled })),
  ]);
  redirect("/messages?saved=authority");
}

export async function validateTelegramConnectorAction() {
  const identity = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "telegram", "telegram.connection.manage", env.TELEGRAM_BRIDGE, "https://telegram-bridge/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) redirect("/messages?platform=telegram&saved=telegram_failed");
  redirect("/messages?platform=telegram&saved=telegram_validated");
}

export async function refreshTelegramMessagesAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const threadId = String(formData.get("threadId") ?? "").trim();
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "telegram", "telegram.messages.sync", env.TELEGRAM_BRIDGE, "https://telegram-bridge/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Telegram replies could not be refreshed.");
  revalidatePath("/messages");
  redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=telegram_refreshed`);
}

export async function markCollectedThreadReadAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const threadId = String(formData.get("threadId") ?? "").trim();
  const { DB } = cloudflareEnv();
  const thread = await creatorPrepare(DB, creatorId, `SELECT t.id,t.connection_id,c.platform FROM message_threads t
    JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=@creator AND c.platform IN ('telegram','fansly')`).bind(threadId).first<{ id: string; connection_id: string; platform: string }>();
  if (!thread) throw new Error("That conversation is outside this creator’s collected message streams.");
  await DB.batch([
    creatorPrepare(DB, creatorId, "UPDATE message_threads SET unread_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator").bind(thread.id),
    creatorPrepare(DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,?, 'collected_thread_marked_read',?,?,'{}')")
      .bind(crypto.randomUUID(), thread.connection_id, thread.id, identity.email, identity.creator.role),
  ]);
  revalidatePath("/messages");
  redirect(`/messages?platform=${thread.platform}&thread=${encodeURIComponent(thread.id)}&saved=thread_read`);
}

export async function sendTelegramCreatorMessageAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const message = String(formData.get("message") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!message || message.length > 4096) throw new Error("Telegram messages must contain between 1 and 4,096 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Telegram message.");
  const actor = identity.email;
  const env = cloudflareEnv();
  const { DB, TELEGRAM_BRIDGE } = env;
  const connection = await creatorPrepare(DB, creatorId, `SELECT id,status,write_enabled,outbound_validated,emergency_paused FROM messaging_connections
    WHERE creator_id=@creator AND platform='telegram' ORDER BY id LIMIT 1`).first<{ id: string; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!connection || connection.status !== "connected" || !connection.outbound_validated) throw new Error("Validate this creator’s Telegram connection before sending.");
  if (!connection.write_enabled) throw new Error("Enable Telegram sending before sending a message.");
  if (connection.emergency_paused) throw new Error("Messaging is paused for this creator.");
  const logId = `telegram-send-${requestId}`;
  const inserted = await creatorPrepare(DB, creatorId, "INSERT OR IGNORE INTO telegram_send_log (id,creator_id,connection_id,message_text,status,requested_by) VALUES (?,@creator,?,?,'queued',?)").bind(logId, connection.id, message, actor).run();
  if (!inserted.meta?.changes) {
    const existing = await creatorPrepare(DB, creatorId, "SELECT status FROM telegram_send_log WHERE id=? AND creator_id=@creator").bind(logId).first<{ status: string }>();
    const saved = existing?.status === "sent" ? "telegram_sent" : existing?.status === "failed" ? "telegram_failed" : "telegram_queued";
    redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${saved}`);
  }
  await creatorPrepare(DB, creatorId, "INSERT OR IGNORE INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,'telegram_message_approved',?,?,?)")
    .bind(`telegram-send-audit-${requestId}`, connection.id, actor, identity.creator.role, JSON.stringify({ logId, characters: message.length, enterToSend: true })).run();
  const response = await fetchInternalService(env, "telegram", "telegram.messages.write", TELEGRAM_BRIDGE, "https://telegram-bridge/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logId, creatorId }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  revalidatePath("/messages");
  redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${response.ok && result.ok ? "telegram_sent" : "telegram_failed"}`);
}

export async function sendFanslyReplyAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const threadId = String(formData.get("threadId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!body || body.length > 2000) throw new Error("Fansly replies must contain between 1 and 2,000 characters.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Fansly reply.");
  const { DB } = cloudflareEnv();
  const thread = await creatorPrepare(DB, creatorId, `SELECT t.id,t.connection_id,c.status,c.write_enabled,c.outbound_validated,c.emergency_paused FROM message_threads t
    JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=@creator AND c.platform='fansly'`).bind(threadId)
    .first<{ id: string; connection_id: string; status: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!thread) throw new Error("Choose a collected Fansly conversation first.");
  if (thread.status !== "connected" || !thread.write_enabled || !thread.outbound_validated || thread.emergency_paused) throw new Error("Fansly device sending is not currently authorised.");
  const actor = identity.email;
  const draftId = `fansly-send-${requestId}`;
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO premium_message_drafts
      (id,creator_id,connection_id,thread_id,platform,body,status,requested_by,approved_by)
      VALUES (?,@creator,?,?,'fansly',?,'approved',?,?)`).bind(draftId, thread.connection_id, thread.id, body, actor, actor),
    creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO messaging_audit_events
      (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail)
      VALUES (?,@creator,?,?, 'fansly_device_send_approved',?,?,?)`).bind(`fansly-send-audit-${requestId}`, thread.connection_id, thread.id, actor, identity.creator.role, JSON.stringify({ draftId, characters: body.length, directComposer: true })),
  ]);
  revalidatePath("/messages");
  redirect(`/messages?platform=fansly&thread=${encodeURIComponent(thread.id)}&saved=fansly_reply_queued`);
}

export async function savePublicProfileDraftAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const slug = publicProfileSlugValue(formData.get("slug"));
  const displayName = publicText(formData.get("displayName"), 120, "display name", { required: true, collapseWhitespace: true });
  const headline = publicText(formData.get("headline"), 280, "headline");
  const bio = publicText(formData.get("bio"), 2000, "bio");
  const links = publicProfileLinks(formData);
  const checksum = await publicProfileChecksum({ displayName, headline, bio, links });
  const { DB } = cloudflareEnv();
  const [profile, draft, nextVersion] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,slug,published_version_id FROM creator_public_profiles WHERE creator_id=@creator LIMIT 1")
      .first<{ id: string; slug: string; published_version_id: string | null }>(),
    creatorPrepare(DB, creatorId, `SELECT v.id,v.profile_id,v.creator_id,p.slug,p.published_version_id,v.version_number,v.display_name,v.headline,v.bio,v.content_checksum,v.status
      FROM creator_public_profile_versions v JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
      WHERE v.creator_id=@creator AND v.status='draft' ORDER BY v.version_number DESC LIMIT 1`).first<PublicProfileVersionRow>(),
    creatorPrepare(DB, creatorId, `SELECT COALESCE(MAX(v.version_number),0)+1 AS version_number
      FROM creator_public_profile_versions v JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
      WHERE v.creator_id=@creator`).first<{ version_number: number }>(),
  ]);
  if (profile?.published_version_id && profile.slug !== slug) throw new Error("A published public URL slug is stable. Withdraw the current profile before changing it.");
  const profileId = profile?.id ?? crypto.randomUUID();
  const versionId = draft?.id ?? crypto.randomUUID();
  const versionNumber = draft?.version_number ?? nextVersion?.version_number ?? 1;
  const actor = humanAuditActor(identity);
  const statements = [
    ...(profile ? profile.slug === slug ? [] : [creatorPrepare(DB, creatorId, "UPDATE creator_public_profiles SET slug=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND published_version_id IS NULL").bind(slug, profileId)] : [creatorPrepare(DB, creatorId, "INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES (?,@creator,?,?)").bind(profileId, slug, identity.email)]),
    ...(draft ? [
      creatorPrepare(DB, creatorId, "DELETE FROM creator_public_links WHERE creator_id=@creator AND profile_version_id=?").bind(versionId),
      creatorPrepare(DB, creatorId, `UPDATE creator_public_profile_versions
        SET display_name=?,headline=?,bio=?,avatar_media_id=NULL,content_checksum=?
        WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'`)
        .bind(displayName, headline, bio, checksum, versionId, profileId),
    ] : [creatorPrepare(DB, creatorId, `INSERT INTO creator_public_profile_versions
      (id,profile_id,creator_id,version_number,display_name,headline,bio,avatar_media_id,content_checksum,created_by)
      VALUES (?,?,@creator,?,?,?, ?,NULL,?,?)`).bind(versionId, profileId, versionNumber, displayName, headline, bio, checksum, identity.email)]),
    ...links.map((link) => creatorPrepare(DB, creatorId, `INSERT INTO creator_public_links
      (id,creator_id,profile_version_id,label,destination_url,destination_host,sort_order)
      VALUES (?,@creator,?,?,?,?,?)`).bind(link.id, versionId, link.label, link.destinationUrl, link.destinationHost, link.sortOrder)),
    identityAuditStatement(DB, actor, draft ? "public_profile_draft_updated" : "public_profile_draft_created", versionId, { profileId, versionNumber, linkCount: links.length, contentChecksum: checksum, publicSurface: true }),
  ];
  await DB.batch(statements);
  revalidatePath("/public-profile");
  redirect("/public-profile?notice=draft_saved");
}

export async function approvePublicProfileVersionAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  if (formData.get("approvalConfirmed") !== "yes") throw new Error("Confirm that the public text and every destination are approved before continuing.");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedPublicProfileVersionId(formData);
  const approvalNote = publicText(formData.get("approvalNote"), 500, "approval note");
  const { DB } = cloudflareEnv();
  const version = await creatorPrepare(DB, creatorId, `SELECT v.id,v.profile_id,v.creator_id,p.slug,p.published_version_id,v.version_number,v.display_name,v.headline,v.bio,v.content_checksum,v.status
    FROM creator_public_profile_versions v JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
    WHERE v.id=? AND v.creator_id=@creator AND v.status='draft'`).bind(versionId).first<PublicProfileVersionRow>();
  if (!version) throw new Error("Only this creator’s current draft profile can be approved.");
  const linkRows = await creatorPrepare(DB, creatorId, `SELECT label,destination_url,destination_host,sort_order
    FROM creator_public_links WHERE creator_id=@creator AND profile_version_id=? ORDER BY sort_order ASC`).bind(version.id)
    .all<{ label: string; destination_url: string; destination_host: string; sort_order: number }>();
  if (!linkRows.results.length) throw new Error("A public profile needs at least one approved HTTPS destination.");
  const links = linkRows.results.map((link) => {
    const destination = approvedPublicDestination(link.destination_url);
    if (destination.destinationUrl !== link.destination_url || destination.destinationHost !== link.destination_host) throw new Error("A saved public destination no longer passes approval validation. Update the draft first.");
    return { label: link.label, ...destination, sortOrder: link.sort_order };
  });
  const checksum = await publicProfileChecksum({ displayName: version.display_name, headline: version.headline, bio: version.bio, links });
  if (checksum !== version.content_checksum) throw new Error("The profile content changed outside the approved draft workflow. Save the draft again before approving it.");
  const approved = await creatorPrepare(DB, creatorId, `UPDATE creator_public_profile_versions
    SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,approval_note=?
    WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'`).bind(identity.email, approvalNote, version.id, version.profile_id).run();
  if (!approved.meta?.changes) throw new Error("This public profile draft is no longer available for approval.");
  await identityAuditStatement(DB, humanAuditActor(identity), "public_profile_version_approved", version.id, { profileId: version.profile_id, versionNumber: version.version_number, contentChecksum: checksum, destinationCount: links.length, publicSurface: true }).run();
  revalidatePath("/public-profile");
  redirect("/public-profile?notice=version_approved");
}

export async function publishPublicProfileAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  if (formData.get("publishConfirmed") !== "yes") throw new Error("Confirm that this explicitly approved profile should be made public.");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedPublicProfileVersionId(formData);
  const env = cloudflareEnv();
  const version = await creatorPrepare(env.DB, creatorId, `SELECT v.id,v.profile_id,v.version_number
    FROM creator_public_profile_versions v JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
    WHERE v.id=? AND v.creator_id=@creator AND v.status='approved'`).bind(versionId).first<{ id: string; profile_id: string; version_number: number }>();
  if (!version) throw new Error("Only an explicitly approved profile version can be published.");
  const response = await fetchInternalService(env, "public_links_control", "public.profile.publish", env.PUBLIC_LINKS_CONTROL, "https://public-links-control/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creatorId, profileId: version.profile_id, versionId: version.id }),
  });
  if (response.status !== 202) throw new Error(`Public publishing control did not accept this request (${response.status}).`);
  await identityAuditStatement(env.DB, humanAuditActor(identity), "public_profile_publish_requested", version.id, { profileId: version.profile_id, versionNumber: version.version_number, publicSurface: true }).run();
  revalidatePath("/public-profile");
  redirect("/public-profile?notice=publication_started");
}

export async function withdrawPublicProfileAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  if (formData.get("withdrawConfirmed") !== "yes") throw new Error("Confirm that this public profile should be withdrawn.");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedPublicProfileVersionId(formData);
  const env = cloudflareEnv();
  const profile = await creatorPrepare(env.DB, creatorId, `SELECT id,published_version_id FROM creator_public_profiles
    WHERE creator_id=@creator AND status='active' AND published_version_id=?`).bind(versionId).first<{ id: string; published_version_id: string }>();
  if (!profile) throw new Error("This creator has no matching published profile to withdraw.");
  const response = await fetchInternalService(env, "public_links_control", "public.profile.withdraw", env.PUBLIC_LINKS_CONTROL, "https://public-links-control/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creatorId, profileId: profile.id, versionId: profile.published_version_id }),
  });
  if (response.status !== 202) throw new Error(`Public withdrawal control did not accept this request (${response.status}).`);
  await identityAuditStatement(env.DB, humanAuditActor(identity), "public_profile_withdraw_requested", profile.published_version_id, { profileId: profile.id, publicSurface: true }).run();
  revalidatePath("/public-profile");
  redirect("/public-profile?notice=withdrawal_started");
}
