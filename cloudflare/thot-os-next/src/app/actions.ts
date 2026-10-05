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
import { ensureConnectorServiceGrants } from "@/lib/connector-service-grants";
import { approvedHttpsDestination } from "@/lib/profile-link-input";
import { parseProfileAppearance } from "@/lib/profile-appearance-contract";
import { canRetryVaultJob } from "@/lib/vault-job-status";
import { isPublicCreatorSlug } from "../../../shared/public-profile-slug.ts";
import { validateBookingConfig, type BookingConfig } from "../../../shared/booking-contract.ts";

function values(formData: FormData, key: string) {
  return formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean);
}

function messagesRedirect(formData: FormData, saved: string) {
  const params = new URLSearchParams();
  const platform = String(formData.get("platform") ?? "").trim();
  if (["telegram", "instagram", "fansly", "onlyfans"].includes(platform)) params.set("platform", platform);
  for (const key of ["accountId", "thread"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) params.set(key, value);
  }
  params.set("saved", saved);
  return `/messages?${params.toString()}`;
}

const inlineMessageRequest = (formData: FormData) => formData.get("inline") === "1";
type InlineMessageResult = { ok: boolean; saved: string; error?: string };

type PublicProfileLinkInput = {
  id: string;
  stableId: string;
  label: string;
  destinationUrl: string;
  destinationHost: string;
  sortOrder: number;
};

type PublicContactInput = { channel: "sms" | "email"; value: string };

export type PublicProfileDraftValues = {
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  bookingPhone: string;
  bookingEmail: string;
  bookingConfig: string;
  linkLabels: string[];
  linkDestinations: string[];
  linkStableIds: string[];
};

export type PublicProfileDraftState = {
  status: "idle" | "error";
  message: string | null;
  reasonCode: string | null;
  fieldErrors: Record<string, string>;
  values: PublicProfileDraftValues | null;
};

export type AdultProfileDraftValues = {
  bio: string;
  linkLabels: string[];
  linkDestinations: string[];
  linkStableIds: string[];
};

export type AdultProfileDraftState = {
  status: "idle" | "error";
  message: string | null;
  reasonCode: string | null;
  fieldErrors: Record<string, string>;
  values: AdultProfileDraftValues | null;
};

type AdultProfileLinkInput = {
  stableId: string;
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

const publicProfileId = /^[a-zA-Z0-9_-]{1,160}$/;
const publicProfileSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function publicText(value: FormDataEntryValue | null, maximum: number, label: string, { required = false, collapseWhitespace = false }: { required?: boolean; collapseWhitespace?: boolean } = {}) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  const normalized = (collapseWhitespace ? text.replace(/\s+/g, " ") : text).trim();
  if (required && !normalized) throw new Error(`Enter a ${label}.`);
  if (normalized.length > maximum) throw new Error(`Enter a ${label} of up to ${maximum} characters.`);
  return normalized;
}

function publicProfileSlugValue(value: FormDataEntryValue | null) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!publicProfileSlug.test(slug) || !isPublicCreatorSlug(slug)) throw new Error("Use a public URL slug with lowercase letters, numbers and single hyphens; reserved private URLs are unavailable.");
  return slug;
}

function submittedPublicProfileDraftValues(formData: FormData): PublicProfileDraftValues {
  return {
    slug: String(formData.get("slug") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    bookingPhone: String(formData.get("bookingPhone") ?? ""),
    bookingEmail: String(formData.get("bookingEmail") ?? ""),
    bookingConfig: String(formData.get("bookingConfig") ?? ""),
    linkLabels: formData.getAll("linkLabel").map(String),
    linkDestinations: formData.getAll("linkDestination").map(String),
    linkStableIds: formData.getAll("linkStableId").map(String),
  };
}

function validationError(values: PublicProfileDraftValues, fieldErrors: Record<string, string>): PublicProfileDraftState {
  return { status: "error", message: "Fix the highlighted fields and save again.", reasonCode: "profile_validation_failed", fieldErrors, values };
}

type ValidPublicProfileDraft = {
  slug: string;
  requestedDisplayName: string;
  headline: string;
  bio: string;
  links: PublicProfileLinkInput[];
  contacts: PublicContactInput[];
  bookingConfig: BookingConfig;
  appearance: ReturnType<typeof publicProfileAppearance>;
};

type PublicProfileDraftValidation =
  | { error: PublicProfileDraftState }
  | ValidPublicProfileDraft;

function validatePublicProfileDraft(formData: FormData, values: PublicProfileDraftValues): PublicProfileDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const validate = <T>(field: string, run: () => T): T | null => {
    try { return run(); } catch (error) {
      fieldErrors[field] = error instanceof Error ? error.message : "Enter a valid value.";
      return null;
    }
  };
  const slug = validate("slug", () => publicProfileSlugValue(values.slug));
  const requestedDisplayName = validate("displayName", () => publicText(values.displayName, 120, "display name", { collapseWhitespace: true }));
  const headline = validate("headline", () => publicText(values.headline, 280, "headline"));
  const bio = validate("bio", () => publicText(values.bio, 2000, "bio"));
  const phone = validate("bookingPhone", () => publicText(values.bookingPhone, 20, "phone number", { collapseWhitespace: true }));
  const email = validate("bookingEmail", () => publicText(values.bookingEmail, 254, "email address", { collapseWhitespace: true }).toLowerCase());
  const bookingConfig = validate("bookingConfig", () => validateBookingConfig(JSON.parse(values.bookingConfig)));
  if (phone && !/^\+[1-9]\d{5,14}$/.test(phone)) fieldErrors.bookingPhone = "Use an international phone number, for example +61400000000.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.bookingEmail = "Enter one valid email address.";
  const labels = values.linkLabels.map((value) => value.replace(/\s+/g, " ").trim());
  const destinations = values.linkDestinations.map((value) => value.trim());
  const stableIds = values.linkStableIds.map((value) => value.trim());
  const links: PublicProfileLinkInput[] = [];
  if (labels.length !== destinations.length || labels.length !== stableIds.length || labels.length > 8) {
    fieldErrors.links = "A public profile can contain up to 8 links.";
  } else {
    labels.forEach((label, index) => {
      const destination = destinations[index];
      if (!label && !destination) return;
      if (!label) { fieldErrors[`linkLabel.${index}`] = "Enter a label for this link."; return; }
      if (!destination) { fieldErrors[`linkDestination.${index}`] = "Enter a complete HTTPS destination for this link."; return; }
      if (label.length > 80) { fieldErrors[`linkLabel.${index}`] = "Use a link label of 80 characters or fewer."; return; }
      let approved: ReturnType<typeof approvedHttpsDestination>;
      try { approved = approvedHttpsDestination(destination); } catch (error) {
        fieldErrors[`linkDestination.${index}`] = error instanceof Error ? error.message : "Enter a complete HTTPS destination.";
        return;
      }
      const stableId = stableIds[index] || crypto.randomUUID();
      if (!publicProfileId.test(stableId)) { fieldErrors.links = "A public link identity is invalid. Refresh the page and try again."; return; }
      links.push({ id: crypto.randomUUID(), stableId, label, destinationUrl: approved.destinationUrl, destinationHost: approved.destinationHost, sortOrder: index });
    });
  }
  const appearance = validate("appearance", () => publicProfileAppearance(formData));
  if (bookingConfig?.enabled && (!phone || !email)) fieldErrors.bookingConfig = "Add both a phone number and email address before enabling booking enquiries.";
  if (Object.keys(fieldErrors).length || !slug || requestedDisplayName === null || headline === null || bio === null || phone === null || email === null || !bookingConfig || !appearance) return { error: validationError(values, fieldErrors) };
  const contacts = [phone ? { channel: "sms" as const, value: phone } : null, email ? { channel: "email" as const, value: email } : null].filter(Boolean) as PublicContactInput[];
  return { slug, requestedDisplayName, headline, bio, links, contacts, bookingConfig, appearance };
}

function publicProfileAppearance(formData: FormData) {
  return parseProfileAppearance({
    themeKey: formData.get("appearanceThemeKey"),
    buttonStyle: formData.get("appearanceButtonStyle"),
    backgroundMode: formData.get("appearanceBackgroundMode"),
    backgroundColor: formData.get("appearanceBackgroundColor"),
    primaryColor: formData.get("appearancePrimaryColor"),
    textColor: formData.get("appearanceTextColor"),
    cardColor: formData.get("appearanceCardColor"),
    radiusScale: formData.get("appearanceRadiusScale"),
  });
}

function adultProfileAppearance(formData: FormData) {
  return parseProfileAppearance({
    themeKey: formData.get("appearanceThemeKey"),
    buttonStyle: formData.get("appearanceButtonStyle"),
    backgroundMode: formData.get("appearanceBackgroundMode"),
    backgroundColor: formData.get("appearanceBackgroundColor"),
    primaryColor: formData.get("appearancePrimaryColor"),
    textColor: formData.get("appearanceTextColor"),
    cardColor: formData.get("appearanceCardColor"),
    radiusScale: formData.get("appearanceRadiusScale"),
    inheritSfwTheme: formData.get("appearanceInheritSfwTheme") === "yes",
  }, { adult: true });
}

function submittedAdultProfileDraftValues(formData: FormData): AdultProfileDraftValues {
  return {
    bio: String(formData.get("adultBio") ?? ""),
    linkLabels: formData.getAll("adultLinkLabel").map(String),
    linkDestinations: formData.getAll("adultLinkDestination").map(String),
    linkStableIds: formData.getAll("adultLinkStableId").map(String),
  };
}

function adultValidationError(values: AdultProfileDraftValues, fieldErrors: Record<string, string>): AdultProfileDraftState {
  return { status: "error", message: "Fix the highlighted fields and save again.", reasonCode: "adult_profile_validation_failed", fieldErrors, values };
}

type ValidAdultProfileDraft = {
  bio: string;
  links: AdultProfileLinkInput[];
  appearance: ReturnType<typeof adultProfileAppearance>;
};

type AdultProfileDraftValidation =
  | { error: AdultProfileDraftState }
  | ValidAdultProfileDraft;

function validateAdultProfileDraft(formData: FormData, values: AdultProfileDraftValues): AdultProfileDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const validate = <T>(field: string, run: () => T): T | null => {
    try { return run(); } catch (error) {
      fieldErrors[field] = error instanceof Error ? error.message : "Enter a valid value.";
      return null;
    }
  };
  const bio = validate("adultBio", () => publicText(values.bio, 2000, "adult bio"));
  const labels = values.linkLabels.map((value) => value.replace(/\s+/g, " ").trim());
  const destinations = values.linkDestinations.map((value) => value.trim());
  const stableIds = values.linkStableIds.map((value) => value.trim());
  const links: AdultProfileLinkInput[] = [];
  if (labels.length !== destinations.length || labels.length !== stableIds.length || labels.length > 12) {
    fieldErrors.links = "An 18+ profile can contain up to 12 links.";
  } else {
    labels.forEach((label, index) => {
      const destination = destinations[index];
      if (!label && !destination) return;
      if (!label) { fieldErrors[`adultLinkLabel.${index}`] = "Enter a label for this link."; return; }
      if (!destination) { fieldErrors[`adultLinkDestination.${index}`] = "Enter a complete HTTPS destination for this link."; return; }
      if (label.length > 80) { fieldErrors[`adultLinkLabel.${index}`] = "Use a link label of 80 characters or fewer."; return; }
      let approved: ReturnType<typeof approvedHttpsDestination>;
      try { approved = approvedHttpsDestination(destination); } catch (error) {
        fieldErrors[`adultLinkDestination.${index}`] = error instanceof Error ? error.message : "Enter a complete HTTPS destination.";
        return;
      }
      const stableId = stableIds[index] || crypto.randomUUID();
      if (!publicProfileId.test(stableId)) { fieldErrors.links = "An adult link identity is invalid. Refresh the page and try again."; return; }
      links.push({ stableId, label, destinationUrl: approved.destinationUrl, destinationHost: approved.destinationHost, sortOrder: index });
    });
  }
  const appearance = validate("appearance", () => adultProfileAppearance(formData));
  if (Object.keys(fieldErrors).length || bio === null || !appearance) return { error: adultValidationError(values, fieldErrors) };
  return { bio, links, appearance };
}

async function adultProfileChecksum(content: { bio: string; links: AdultProfileLinkInput[] }) {
  const canonical = JSON.stringify({ bio: content.bio, links: content.links.map((link) => ({ label: link.label, destinationUrl: link.destinationUrl, destinationHost: link.destinationHost, sortOrder: link.sortOrder })) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function publicProfileChecksum(content: { displayName: string; headline: string; bio: string; links: Array<Pick<PublicProfileLinkInput, "label" | "destinationUrl" | "destinationHost" | "sortOrder">> }) {
  const canonical = JSON.stringify({ ...content, links: content.links.map((link) => ({ label: link.label, destinationUrl: link.destinationUrl, destinationHost: link.destinationHost, sortOrder: link.sortOrder })) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bookingAwarePublicProfileChecksum(content: Parameters<typeof publicProfileChecksum>[0], privateBooking?: { contacts: PublicContactInput[]; config: BookingConfig }) {
  if (!privateBooking) return publicProfileChecksum(content);
  const canonical = JSON.stringify({ ...content, links: content.links.map((link) => ({ label: link.label, destinationUrl: link.destinationUrl, destinationHost: link.destinationHost, sortOrder: link.sortOrder })), contacts: privateBooking.contacts.slice().sort((left, right) => left.channel.localeCompare(right.channel)).map((contact) => ({ channel: contact.channel, value: contact.value })), bookingConfig: privateBooking.config });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bookingChecksumForVersion(DB: D1Database, creatorId: string, versionId: string, content: Parameters<typeof publicProfileChecksum>[0]) {
  const config = await creatorPrepare(DB, creatorId, "SELECT config_json FROM creator_booking_configs WHERE creator_id=@creator AND profile_version_id=?").bind(versionId).first<{ config_json: string }>();
  if (!config) return bookingAwarePublicProfileChecksum(content);
  const contacts = await creatorPrepare(DB, creatorId, "SELECT channel,contact_value FROM creator_public_contact_methods WHERE creator_id=@creator AND profile_version_id=? AND enabled=1 ORDER BY channel ASC").bind(versionId).all<{ channel: "sms" | "email"; contact_value: string }>();
  return bookingAwarePublicProfileChecksum(content, { contacts: contacts.results.map((contact) => ({ channel: contact.channel, value: contact.contact_value })), config: validateBookingConfig(JSON.parse(config.config_json)) });
}

function submittedPublicProfileVersionId(formData: FormData) {
  const id = String(formData.get("versionId") ?? "");
  if (!publicProfileId.test(id)) throw new Error("The requested public profile version is invalid.");
  return id;
}

function submittedAdultProfileVersionId(formData: FormData) {
  const id = String(formData.get("adultVersionId") ?? "");
  if (!publicProfileId.test(id)) throw new Error("The requested adult profile version is invalid.");
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

export async function saveAssetAttributesAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const assetIds = [...new Set(values(formData, "assetId"))];
  if (assetIds.length > 50) throw new Error("Select no more than 50 assets. No attributes were changed.");
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
  const requestedAccountId = String(formData.get("accountId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "");
  const targetTypeValue = String(formData.get("targetType") ?? "");
  const targetType = targetTypeValue === "profile" || targetTypeValue === "subreddit" ? targetTypeValue : null;
  const communityValue = String(formData.get("communityId") ?? "").trim();
  const communityId = communityValue === "" ? null : Number(communityValue);
  const flairId = String(formData.get("flairId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 10000);
  const contentRating = String(formData.get("contentRating") ?? "");
  const intentValue = String(formData.get("intent") ?? "draft");
  const intent = intentValue === "publish_now" ? "publish_now" : intentValue === "schedule" ? "schedule" : "draft";
  const plannedValue = String(formData.get("scheduledAt") ?? "").trim();
  if (!targetType) throw new Error("Choose a Reddit creator profile or saved subreddit.");
  if (!assetId || (targetType === "subreddit" && (communityId === null || !Number.isInteger(communityId) || communityId < 1))) throw new Error("Choose a Reddit-eligible asset and target.");
  if (targetType === "profile" && (communityId !== null || flairId)) throw new Error("Creator profile posts cannot include a subreddit or flair.");
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
    targetType === "subreddit" ? creatorPrepare(DB, creatorId, "SELECT id,name,allows_nsfw,status,last_verified_at,flair_required,flairs_checked_at FROM reddit_communities WHERE id=? AND creator_id=@creator").bind(communityId).first<{ id: number; name: string; allows_nsfw: number; status: string; last_verified_at: string; flair_required: number; flairs_checked_at: string | null }>() : Promise.resolve(null),
    targetType === "subreddit" && flairId ? creatorPrepare(DB, creatorId, "SELECT flair_id,flair_text,fetched_at FROM reddit_community_flairs WHERE creator_id=@creator AND community_id=? AND flair_id=? AND active=1").bind(communityId, flairId).first<{ flair_id: string; flair_text: string; fetched_at: string }>() : Promise.resolve(null),
    creatorPrepare(DB, creatorId, "SELECT id,handle,external_identity_confirmed_at,connection_status,publishing_authority,is_active FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='reddit'").bind(requestedAccountId).first<{ id: string; handle: string; external_identity_confirmed_at: string | null; connection_status: string; publishing_authority: string; is_active: number }>(),
    existingPostId ? creatorPrepare(DB, creatorId, "SELECT id,status FROM social_posts WHERE id=? AND creator_id=@creator AND platform='reddit'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Reddit.");
  if (!asset.safety) throw new Error("Classify the asset as SFW or NSFW before creating a Reddit post.");
  if (!["jpg", "jpeg", "png", "webp", "gif"].includes(asset.extension.toLowerCase().replace(/^\./, ""))) throw new Error("Reddit API publishing currently supports image posts. Native video will be enabled after its separate media flow is verified.");
  if (asset.safety !== contentRating) throw new Error(`This asset is classified ${asset.safety.toUpperCase()}; use the matching Reddit content rating.`);
  if (targetType === "subreddit") {
    if (!community || community.status !== "active") throw new Error("That subreddit is not active.");
    if (flairId && !selectedFlair) throw new Error("That Reddit flair is no longer available for the selected subreddit. Refresh its flairs and choose again.");
    if (intent !== "draft" && community.flair_required && !selectedFlair) throw new Error(`r/${community.name} requires post flair. Refresh its flairs and choose one before publishing.`);
    if (intent !== "draft" && community.flair_required && !community.flairs_checked_at) throw new Error(`Refresh r/${community.name} to load its current Reddit flair requirements before publishing.`);
    if (contentRating === "nsfw" && !community.allows_nsfw) throw new Error("That subreddit is not recorded as allowing NSFW posts.");
    const rulesCheckedAt = new Date(`${community.last_verified_at}T00:00:00Z`).getTime();
    if (!Number.isFinite(rulesCheckedAt) || Date.now() - rulesCheckedAt > 30 * 24 * 60 * 60 * 1000) throw new Error("Recheck this subreddit’s rules before scheduling a post.");
  }
  if (!account || !account.is_active) throw new Error("Select an active Reddit account before creating a post.");
  if (targetType === "profile" && (!account.handle || !account.external_identity_confirmed_at)) throw new Error("Verify the selected Reddit account before creating a creator-profile post.");
  if (intent !== "draft" && (account.connection_status !== "connected" || account.publishing_authority !== "confirmed")) throw new Error("Reconnect and verify Reddit before approving API delivery.");
  if (existingPostId && (!existingPost || !["draft", "scheduled"].includes(existingPost.status))) throw new Error("Only draft or scheduled Reddit posts can be edited.");

  const actor = identity.email;
  const status = intent === "draft" ? "draft" : "scheduled";
  let postId = existingPostId || crypto.randomUUID();
  if (!existingPostId && status === "scheduled") {
    const intentWindow = intent === "publish_now" ? scheduledAt!.slice(0, 16) : scheduledAt;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([creatorId, account.id, asset.id, targetType, community?.id ?? "profile", title, caption, contentRating, selectedFlair?.flair_id ?? "", intent, intentWindow].join("|")));
    postId = `reddit-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  }
  const eventType = intent === "publish_now" ? "post_now_approved" : intent === "schedule" ? "post_scheduled" : existingPostId ? "draft_updated" : "draft_created";
  if (existingPostId) {
    const update = await creatorPrepare(DB, creatorId, `UPDATE social_posts SET account_id=?,asset_id=?,community_id=?,reddit_flair_id=?,reddit_flair_text=?,title=?,caption=?,content_rating=?,status=?,scheduled_at=?,approved_by=?,approved_at=CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END,error=NULL,claimed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='reddit' AND status IN ('draft','scheduled')`)
      .bind(account.id, asset.id, community?.id ?? null, selectedFlair?.flair_id ?? null, selectedFlair?.flair_text ?? null, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status, postId).run();
    if (!update.meta?.changes) throw new Error("This Reddit post changed before it could be saved. Refresh and try again.");
    await creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, targetType, communityId: community?.id ?? null, contentRating, flairId: selectedFlair?.flair_id ?? null, flairText: selectedFlair?.flair_text ?? null, deliveryMode: "reddit_api" })).run();
  } else {
    await DB.batch([
      creatorPrepare(DB, creatorId, `INSERT INTO social_posts (id,creator_id,platform,account_id,community_id,asset_id,reddit_flair_id,reddit_flair_text,title,caption,content_rating,status,scheduled_at,approved_by,approved_at) VALUES (?,@creator,'reddit',?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='scheduled' THEN CURRENT_TIMESTAMP ELSE NULL END)`).bind(postId, account.id, community?.id ?? null, asset.id, selectedFlair?.flair_id ?? null, selectedFlair?.flair_text ?? null, title, caption, contentRating, status, scheduledAt, status === "scheduled" ? actor : null, status),
      creatorPrepare(DB, creatorId, "INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,@creator,?,?,?,?)").bind(crypto.randomUUID(), postId, actor, identity.creator.role, eventType, JSON.stringify({ scheduledAt, targetType, communityId: community?.id ?? null, contentRating, flairId: selectedFlair?.flair_id ?? null, flairText: selectedFlair?.flair_text ?? null, deliveryMode: "reddit_api" })),
    ]);
  }
  revalidatePath("/operations");
  if (intent === "publish_now") {
    try {
      const response = await fetchInternalService(env, "reddit", "reddit.publish.execute", env.REDDIT_SCHEDULER, "https://reddit-scheduler/posts/reddit/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, creatorId, accountId: account.id }),
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

export async function startRedditReconnectAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const env = cloudflareEnv();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const account = await creatorPrepare(env.DB, identity.creator.creator_id, "SELECT id FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='reddit' AND is_active=1").bind(accountId).first<{ id: string }>();
  if (!account) throw new Error("Select an active Reddit account to reconnect.");
  await ensureConnectorServiceGrants(env.DB, identity, "reddit");
  const callbackUrl = new URL("/api/operations/reddit/callback", env.APP_BASE_URL).toString();
  const response = await fetchInternalService(env, "reddit", "reddit.connection.manage", env.REDDIT_SCHEDULER, "https://reddit-scheduler/connections/reddit/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callbackUrl, creatorId: identity.creator.creator_id, accountId: account.id }),
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
  const requestedAccountId = String(formData.get("accountId") ?? "").trim();
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
    creatorPrepare(DB, creatorId, "SELECT id,connection_status,publishing_authority,is_active FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='instagram'").bind(requestedAccountId).first<{ id: string; connection_status: string; publishing_authority: string; is_active: number }>(),
    existingPostId ? creatorPrepare(DB, creatorId, "SELECT id,status FROM social_posts WHERE id=? AND creator_id=@creator AND platform='instagram'").bind(existingPostId).first<{ id: string; status: string }>() : Promise.resolve(null),
  ]);
  if (!asset) throw new Error("That asset is no longer available for Instagram.");
  if (asset.safety !== "sfw") throw new Error("Instagram publishing requires an asset classified SFW.");
  const extension = asset.extension.toLowerCase().replace(/^\./, "");
  if (!["jpg", "jpeg", "mp4", "mov"].includes(extension)) throw new Error("Instagram supports JPEG, MP4 or MOV in this workflow.");
  if (!account || !account.is_active) throw new Error("Select an active Instagram account before creating a post.");
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
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postId, creatorId, accountId: account.id }),
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

export async function startInstagramReconnectAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const env = cloudflareEnv();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const account = await creatorPrepare(env.DB, identity.creator.creator_id, "SELECT id FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='instagram' AND is_active=1").bind(accountId).first<{ id: string }>();
  if (!account) throw new Error("Select an active Instagram account to reconnect.");
  await ensureConnectorServiceGrants(env.DB, identity, "instagram");
  const callbackUrl = new URL("/api/operations/instagram/callback", env.APP_BASE_URL).toString();
  const response = await fetchInternalService(env, "instagram", "instagram.connection.manage", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/connections/instagram/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callbackUrl, creatorId: identity.creator.creator_id, accountId: account.id }),
  });
  const result = await response.json() as { redirectUrl?: string; error?: string };
  if (!response.ok || !result.redirectUrl) throw new Error(result.error || "Instagram reconnection could not be started.");
  await identityAuditStatement(env.DB, humanAuditActor(identity), "instagram_connection_requested", "instagram", { providerCallback: true }).run();
  redirect(result.redirectUrl);
}

export async function refreshInstagramDataAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const env = cloudflareEnv();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const account = await creatorPrepare(env.DB, identity.creator.creator_id, "SELECT id FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='instagram' AND is_active=1").bind(accountId).first<{ id: string }>();
  if (!account) throw new Error("Select an active Instagram account before refreshing analytics.");
  const response = await fetchInternalService(env, "instagram", "instagram.sync.execute", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/sync/analytics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id, accountId: account.id }) });
  const result = await response.json() as { ok?: boolean; errors?: string[]; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.errors?.join(" ") || result.error || "Instagram data could not be refreshed.");
  revalidatePath("/operations");
  redirect(`/operations?platform=instagram&section=analytics&accountId=${encodeURIComponent(account.id)}&saved=refreshed`);
}

export async function refreshInstagramMessagesAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const threadId = String(formData.get("threadId") ?? "").trim();
  const requestedAccountId = String(formData.get("accountId") ?? "").trim();
  const env = cloudflareEnv();
  let accountId = requestedAccountId;
  let saved = "instagram_messages_failed";
  try {
    const requestedAccount = requestedAccountId ? await creatorPrepare(env.DB, identity.creator.creator_id, "SELECT id FROM operational_accounts WHERE id=? AND creator_id=@creator AND platform='instagram' AND is_active=1").bind(requestedAccountId).first<{ id: string }>() : null;
    if (requestedAccountId && !requestedAccount) throw new Error("That Instagram account is not active in this creator workspace.");
    const thread = threadId ? await creatorPrepare(env.DB, identity.creator.creator_id, `SELECT c.account_id
      FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
      WHERE t.id=? AND t.creator_id=@creator AND c.platform='instagram'`).bind(threadId).first<{ account_id: string | null }>() : null;
    if (threadId && !thread?.account_id) throw new Error("That Instagram conversation is outside this creator workspace.");
    if (thread?.account_id && requestedAccountId && thread.account_id !== requestedAccountId) throw new Error("Choose the Instagram account assigned to this conversation before refreshing.");
    accountId = requestedAccountId || thread?.account_id || "";
    if (!accountId) {
      const accounts = await creatorPrepare(env.DB, identity.creator.creator_id, "SELECT id FROM operational_accounts WHERE creator_id=@creator AND platform='instagram' AND is_active=1 ORDER BY id LIMIT 2").all<{ id: string }>();
      if (accounts.results.length !== 1) throw new Error("Select an Instagram conversation before refreshing messages.");
      accountId = accounts.results[0].id;
    }
    const response = await fetchInternalService(env, "instagram", "instagram.messages.sync", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/sync/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id, accountId }) });
    const result = await response.json() as { ok?: boolean; status?: string; error?: string };
    saved = response.ok && result.ok
      ? result.status === "partial" ? "instagram_messages_partial" : "instagram_messages_refreshed"
      : result.status === "busy" ? "instagram_messages_busy"
        : result.status === "read_disabled" ? "instagram_messages_read_disabled"
          : "instagram_messages_failed";
    revalidatePath("/messages");
  } catch {
    saved = "instagram_messages_failed";
  }
  const redirectData = new FormData();
  redirectData.set("platform", "instagram");
  if (accountId) redirectData.set("accountId", accountId);
  if (threadId) redirectData.set("thread", threadId);
  redirect(messagesRedirect(redirectData, saved));
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
  const requestedAssetId = String(formData.get("assetId") ?? "").trim();
  const assetId = requestedAssetId || null;
  const requestId = String(formData.get("clientRequestId") ?? "").trim().toLowerCase();
  if (!threadId) throw new Error("Choose an Instagram conversation.");
  if ((!body && !assetId) || body.length > 1000) throw new Error("Write a reply or choose one approved photo/video asset.");
  if (body && assetId) throw new Error("Instagram media replies cannot silently split text and media into separate sends.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new Error("Refresh Messages before sending this Instagram reply.");

  const env = cloudflareEnv();
  const thread = await creatorPrepare(env.DB, creatorId, `SELECT t.id,t.connection_id,
      (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=t.creator_id AND m.thread_id=t.id AND m.direction='inbound') AS last_inbound_at,
      c.status,c.mode,c.write_enabled,c.outbound_validated,c.emergency_paused
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=@creator AND c.platform='instagram'`).bind(threadId)
    .first<{ id: string; connection_id: string; last_inbound_at: string | null; status: string; mode: string; write_enabled: number; outbound_validated: number; emergency_paused: number }>();
  if (!thread) throw new Error("That Instagram conversation is outside this creator workspace.");
  if (thread.status !== "connected" || !thread.write_enabled || thread.emergency_paused || !["assist", "operate"].includes(thread.mode)) throw new Error("Instagram sending is not currently authorised.");
  const normalizedInbound = thread.last_inbound_at?.replace(" ", "T") ?? "";
  const lastInboundAt = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedInbound) ? normalizedInbound : `${normalizedInbound}Z`).getTime();
  if (!Number.isFinite(lastInboundAt) || Date.now() - lastInboundAt > 24 * 60 * 60_000) throw new Error("Instagram’s active reply window is closed. Ask the person to send a new message, refresh, then reply.");

  const asset = assetId ? await creatorPrepare(env.DB, creatorId, `SELECT a.id,c.safety,o.sha256,o.byte_count,o.verified_mime_type,o.r2_version,o.r2_etag
    FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id AND d.destination='instagram'
    JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id AND o.asset_id=a.id AND o.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=@creator AND a.source_available=1 AND c.safety='sfw' AND ma.state IN ('canonical_verified','preview_ready')
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
      AND o.object_key=a.media_r2_key AND o.byte_count=a.bytes
      AND (c.is_multi=0 OR EXISTS (SELECT 1 FROM asset_people ap WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id))
      AND NOT EXISTS (SELECT 1 FROM asset_people ap LEFT JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id AND COALESCE(p.consent_status,'not_recorded')<>'recorded')
      AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL LIMIT 1`).bind(assetId)
    .first<{ id: string; safety: string; sha256: string; byte_count: number; verified_mime_type: string; r2_version: string; r2_etag: string }>() : null;
  if (assetId && !asset) throw new Error("Choose one creator-owned, SFW Instagram-approved asset whose private R2 source is verified.");
  if (asset && !["image/jpeg", "image/png", "video/mp4"].includes(asset.verified_mime_type)) throw new Error("Instagram replies support approved JPEG, PNG, or MP4 assets only.");
  if (asset && (asset.byte_count <= 0 || asset.byte_count > (asset.verified_mime_type === "video/mp4" ? 25 * 1024 * 1024 : 8 * 1024 * 1024))) throw new Error("Choose a smaller Instagram photo or video.");

  const actor = identity.email;
  let draftId = `instagram-send-${requestId}`;
  const inserted = await creatorPrepare(env.DB, creatorId, `INSERT OR IGNORE INTO instagram_reply_drafts
    (id,creator_id,connection_id,thread_id,body,status,requested_by,asset_id,asset_sha256,asset_bytes,asset_mime_type,asset_r2_version,asset_r2_etag)
    VALUES (?,@creator,?,?,?,'draft',?,?,?,?,?,?,?)`).bind(draftId, thread.connection_id, thread.id, body, actor,
      asset?.id ?? null, asset?.sha256 ?? null, asset?.byte_count ?? null, asset?.verified_mime_type ?? null, asset?.r2_version ?? null, asset?.r2_etag ?? null).run();
  if (inserted.meta?.changes) {
    await creatorPrepare(env.DB, creatorId, `INSERT OR IGNORE INTO messaging_audit_events
      (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail)
      VALUES (?,@creator,?,?,'instagram_quick_send_requested',?,?,?)`)
      .bind(`instagram-send-audit-${requestId}`, thread.connection_id, thread.id, actor, identity.creator.role, JSON.stringify({ draftId, characters: body.length, assetId, enterToSend: true })).run();
  } else {
    const existing = await creatorPrepare(env.DB, creatorId, `SELECT id,thread_id,status,body,asset_id,asset_sha256,asset_bytes,asset_mime_type,asset_r2_version,asset_r2_etag FROM instagram_reply_drafts
      WHERE creator_id=@creator AND (id=? OR (thread_id=? AND body=? AND COALESCE(asset_id,'')=COALESCE(?, '') AND status IN ('draft','approved','sending')))
      ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).bind(draftId, thread.id, body, assetId, draftId).first<{ id: string; thread_id: string; status: string; body: string; asset_id: string | null; asset_sha256: string | null; asset_bytes: number | null; asset_mime_type: string | null; asset_r2_version: string | null; asset_r2_etag: string | null }>();
    if (!existing) throw new Error("That Instagram reply could not be queued safely. Refresh Messages and try again.");
    if (existing.thread_id !== thread.id) throw new Error("This request ID belongs to a different conversation. Refresh Messages and try again.");
    if (existing.body !== body || (existing.asset_id ?? null) !== assetId || existing.asset_sha256 !== (asset?.sha256 ?? null) || existing.asset_bytes !== (asset?.byte_count ?? null) || existing.asset_mime_type !== (asset?.verified_mime_type ?? null) || existing.asset_r2_version !== (asset?.r2_version ?? null) || existing.asset_r2_etag !== (asset?.r2_etag ?? null)) throw new Error("This request ID is already used for a different Instagram reply. Refresh Messages and try again.");
    draftId = existing.id;
    if (existing.status === "sent") {
      if (inlineMessageRequest(formData)) return { ok: true, saved: "instagram_sent" } satisfies InlineMessageResult;
      redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_sent`);
    }
    if (existing.status === "sending") {
      if (inlineMessageRequest(formData)) return { ok: false, saved: "instagram_sending", error: "This reply is already being sent. Check the receipt before trying again." } satisfies InlineMessageResult;
      redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_sending`);
    }
    if (existing.status === "uncertain") {
      if (inlineMessageRequest(formData)) return { ok: false, saved: "instagram_uncertain", error: "Instagram did not confirm the outcome. Check the live conversation before sending again." } satisfies InlineMessageResult;
      redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_uncertain`);
    }
    if (existing.status === "failed") {
      if (inlineMessageRequest(formData)) return { ok: false, saved: "instagram_send_failed", error: "Instagram did not accept this reply. Review the receipt before trying again." } satisfies InlineMessageResult;
      redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=instagram_send_failed`);
    }
  }

  let saved = "instagram_send_failed";
  let actionError: string | undefined;
  try {
    const response = await fetchInternalService(env, "instagram", "instagram.messages.write", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/messages/instagram/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId, creatorId }),
    });
    const result = await response.json() as { ok?: boolean; sent?: boolean; uncertain?: boolean; error?: string };
    saved = response.ok && result.ok && result.sent ? "instagram_sent" : result.uncertain ? "instagram_uncertain" : "instagram_send_failed";
    actionError = result.error;
  } catch (error) {
    const message = `Outcome uncertain; check Instagram before sending again. ${error instanceof Error ? error.message : "The Instagram delivery service did not respond."}`.slice(0, 2000);
    await env.DB.batch([
      creatorPrepare(env.DB, creatorId, "UPDATE instagram_reply_drafts SET status='uncertain',error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND status='draft'").bind(message, draftId),
      creatorPrepare(env.DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,?, 'instagram_reply_uncertain',?,?,?)")
        .bind(crypto.randomUUID(), thread.connection_id, thread.id, actor, identity.creator.role, JSON.stringify({ draftId, error: message })),
    ]);
    saved = "instagram_uncertain";
    actionError = message;
  }
  revalidatePath("/messages");
  if (inlineMessageRequest(formData)) {
    return { ok: saved === "instagram_sent", saved, error: actionError || (saved === "instagram_uncertain" ? "Instagram did not confirm the outcome. Check the live conversation before sending again." : saved === "instagram_send_failed" ? "Instagram did not accept this reply. Review the receipt before trying again." : undefined) } satisfies InlineMessageResult;
  }
  redirect(`/messages?platform=instagram&thread=${encodeURIComponent(thread.id)}&saved=${saved}`);
}

export async function validateInstagramReplyTargetAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!threadId) throw new Error("Choose an Instagram conversation to validate.");
  const env = cloudflareEnv();
  const thread = await creatorPrepare(env.DB, creatorId, `SELECT t.connection_id
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=@creator AND c.platform='instagram'`).bind(threadId).first<{ connection_id: string }>();
  if (!thread) throw new Error("That Instagram conversation is outside this creator workspace.");
  const response = await fetchInternalService(env, "instagram", "instagram.messages.write", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/messages/instagram/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, creatorId }),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) {
    const error = (result.error || "Instagram reply target validation failed.").slice(0, 500);
    await env.DB.batch([
      creatorPrepare(env.DB, creatorId, "UPDATE messaging_connections SET outbound_validated=0,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='instagram'").bind(error, thread.connection_id),
      creatorPrepare(env.DB, creatorId, `INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail)
        VALUES (?,@creator,?,?, 'instagram_reply_validation_failed',?,?,?)`)
        .bind(crypto.randomUUID(), thread.connection_id, threadId, identity.email, identity.creator.role, JSON.stringify({ error })),
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

export async function retryFanslyVaultJobAction(formData: FormData) {
  const identity = await requireCreatorContext("approve");
  const creatorId = identity.creator.creator_id;
  const jobId = String(formData.get("jobId") ?? "");
  const actor = identity.email;
  const { DB } = cloudflareEnv();
  const job = await creatorPrepare(DB, creatorId, "SELECT status,receipt FROM vault_upload_jobs WHERE id=? AND creator_id=@creator AND platform='fansly'").bind(jobId).first<{ status: string; receipt: string }>();
  if (!job || !canRetryVaultJob(job.status, job.receipt)) throw new Error("Only a certain failed Fansly upload can be retried. Uncertain outcomes must be reconciled first.");
  const updated = await creatorPrepare(DB, creatorId, "UPDATE vault_upload_jobs SET status='approved',claimed_at=NULL,completed_at=NULL,error=NULL,receipt='{}',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=@creator AND platform='fansly' AND status='failed' AND receipt=?").bind(jobId, job.receipt).run();
  if (!updated.meta?.changes) throw new Error("The Fansly upload changed while retry was being approved. Refresh and review its current receipt.");
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
  redirect(messagesRedirect(formData, paused ? "paused" : "resumed"));
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
  redirect(messagesRedirect(formData, "authority"));
}

export async function validateTelegramConnectorAction() {
  const identity = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  const response = await fetchInternalService(env, "telegram", "telegram.connection.manage", env.TELEGRAM_BRIDGE, "https://telegram-bridge/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) redirect("/messages?platform=telegram&saved=telegram_failed");
  redirect("/messages?platform=telegram&saved=telegram_validated");
}

export async function startTelegramPairingAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const username = String(formData.get("telegramUsername") ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new Error("Enter the creator’s Telegram username without spaces.");
  const { DB } = cloudflareEnv();
  const [existing, bot] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id FROM messaging_connections WHERE creator_id=@creator AND platform='telegram' LIMIT 1").first<{ id: string }>(),
    DB.prepare("SELECT expected_bot_username FROM telegram_connector_state WHERE expected_bot_username<>'' ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END LIMIT 1").first<{ expected_bot_username: string }>(),
  ]);
  if (existing) throw new Error("This creator already has a Telegram messaging connection.");
  if (!bot?.expected_bot_username) throw new Error("The agency Telegram bot is not configured.");
  await ensureConnectorServiceGrants(DB, identity, "telegram");
  const connectionId = crypto.randomUUID();
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT INTO messaging_connections (id,creator_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
      VALUES (?,@creator,'telegram',?,?,'observe',0,0,0,'needs_check','Open the agency bot from this Telegram account, tap Start, then confirm pairing.')`).bind(connectionId, `${identity.creator.creator_name} Telegram`, `@${username}`),
    creatorPrepare(DB, creatorId, `INSERT INTO telegram_connector_state (creator_id,connection_id,chat_id,telegram_user_id,telegram_username,display_name,expected_bot_username,status)
      VALUES (@creator,?,'','',?,?,?,'pending_validation')`).bind(connectionId, username, identity.creator.creator_name, bot.expected_bot_username),
    creatorPrepare(DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,'telegram_pairing_started',?,?,?)").bind(crypto.randomUUID(), connectionId, identity.email, identity.creator.role, JSON.stringify({ telegramUsername: `@${username}` })),
  ]);
  revalidatePath("/messages");
  redirect("/messages?platform=telegram&saved=telegram_pairing_started");
}

export async function completeTelegramPairingAction() {
  const identity = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  await ensureConnectorServiceGrants(env.DB, identity, "telegram");
  const response = await fetchInternalService(env, "telegram", "telegram.connection.manage", env.TELEGRAM_BRIDGE, "https://telegram-bridge/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: identity.creator.creator_id }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || "Telegram pairing could not be confirmed.");
  revalidatePath("/messages");
  redirect("/messages?platform=telegram&saved=telegram_pairing_complete");
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
  if (String(formData.get("assetId") ?? "").trim()) throw new Error("Telegram photo/video replies are not available yet. Nothing was sent.");
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
    if (inlineMessageRequest(formData)) return { ok: saved === "telegram_sent", saved, error: saved === "telegram_sent" ? undefined : saved === "telegram_failed" ? "Telegram did not confirm this message. Review the receipt before trying again." : "This message is already queued. Check the receipt before trying again." } satisfies InlineMessageResult;
    redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${saved}`);
  }
  await creatorPrepare(DB, creatorId, "INSERT OR IGNORE INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,'telegram_message_approved',?,?,?)")
    .bind(`telegram-send-audit-${requestId}`, connection.id, actor, identity.creator.role, JSON.stringify({ logId, characters: message.length, enterToSend: true })).run();
  const response = await fetchInternalService(env, "telegram", "telegram.messages.write", TELEGRAM_BRIDGE, "https://telegram-bridge/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ logId, creatorId }) });
  const result = await response.json() as { ok?: boolean; error?: string };
  revalidatePath("/messages");
  const saved = response.ok && result.ok ? "telegram_sent" : "telegram_failed";
  if (inlineMessageRequest(formData)) return { ok: saved === "telegram_sent", saved, error: saved === "telegram_sent" ? undefined : result.error || "Telegram did not confirm this message. Review the receipt before trying again." } satisfies InlineMessageResult;
  redirect(`/messages?platform=telegram${threadId ? `&thread=${encodeURIComponent(threadId)}` : ""}&saved=${saved}`);
}

export async function sendFanslyReplyAction(formData: FormData) {
  if (String(formData.get("assetId") ?? "").trim()) throw new Error("Fansly photo/video replies are not available yet. Nothing was queued.");
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
  if (inlineMessageRequest(formData)) return { ok: true, saved: "fansly_reply_queued" } satisfies InlineMessageResult;
  redirect(`/messages?platform=fansly&thread=${encodeURIComponent(thread.id)}&saved=fansly_reply_queued`);
}

export async function savePublicProfileDraftAction(_previousState: PublicProfileDraftState, formData: FormData): Promise<PublicProfileDraftState> {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const values = submittedPublicProfileDraftValues(formData);
  const validated = validatePublicProfileDraft(formData, values);
  if ("error" in validated) return validated.error;
  const { slug, requestedDisplayName, headline, bio, links, contacts, bookingConfig, appearance } = validated;
  const displayName = requestedDisplayName || identity.creator.creator_name;
  const checksum = await bookingAwarePublicProfileChecksum({ displayName, headline, bio, links }, { contacts, config: bookingConfig });
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
      creatorPrepare(DB, creatorId, "DELETE FROM creator_public_link_revisions WHERE creator_id=@creator AND profile_version_id=?").bind(versionId),
      creatorPrepare(DB, creatorId, "DELETE FROM creator_public_contact_methods WHERE creator_id=@creator AND profile_version_id=?").bind(versionId),
      creatorPrepare(DB, creatorId, "DELETE FROM creator_booking_configs WHERE creator_id=@creator AND profile_version_id=?").bind(versionId),
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
    creatorPrepare(DB, creatorId, `INSERT INTO creator_public_profile_details
      (profile_version_id,creator_id,public_display_name,public_bio,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale,updated_at)
      VALUES (?,@creator,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_version_id) DO UPDATE SET
        public_display_name=excluded.public_display_name,public_bio=excluded.public_bio,
        theme_key=excluded.theme_key,button_style=excluded.button_style,background_mode=excluded.background_mode,
        background_color=excluded.background_color,primary_color=excluded.primary_color,text_color=excluded.text_color,
        card_color=excluded.card_color,radius_scale=excluded.radius_scale,updated_at=CURRENT_TIMESTAMP`)
      .bind(versionId, displayName, bio, appearance.themeKey, appearance.buttonStyle, appearance.backgroundMode, appearance.backgroundColor, appearance.primaryColor, appearance.textColor, appearance.cardColor, appearance.radiusScale),
    ...links.flatMap((link) => [
      creatorPrepare(DB, creatorId, "INSERT OR IGNORE INTO creator_public_link_entities (id,creator_id) VALUES (?,@creator)").bind(link.stableId),
      creatorPrepare(DB, creatorId, `INSERT INTO creator_public_link_revisions
        (id,creator_id,link_id,profile_version_id,label,destination_url,destination_host,icon_key,category,sort_order,enabled)
        VALUES (?,@creator,?,?,?,?,?,'link','social',?,1)`)
        .bind(crypto.randomUUID(), link.stableId, versionId, link.label, link.destinationUrl, link.destinationHost, link.sortOrder),
    ]),
    ...contacts.map((contact) => creatorPrepare(DB, creatorId, `INSERT INTO creator_public_contact_methods
      (id,creator_id,profile_version_id,channel,contact_value,enabled)
      VALUES (?,@creator,?,?,?,1)`).bind(crypto.randomUUID(), versionId, contact.channel, contact.value)),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_booking_configs (profile_version_id,creator_id,config_json,updated_at)
      VALUES (?,@creator,?,CURRENT_TIMESTAMP)`).bind(versionId, JSON.stringify(bookingConfig)),
    identityAuditStatement(DB, actor, draft ? "public_profile_draft_updated" : "public_profile_draft_created", versionId, { profileId, versionNumber, linkCount: links.length, contactChannels: contacts.map((contact) => contact.channel), contentChecksum: checksum, appearance: appearance.themeKey, publicSurface: true }),
  ];
  try {
    await DB.batch(statements);
  } catch {
    return { status: "error", message: "We could not save this profile. Try again.", reasonCode: "profile_save_failed", fieldErrors: {}, values };
  }
  revalidatePath("/public-profile");
  redirect("/public-profile?notice=draft_saved");
}

export async function approvePublicProfileVersionAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
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
  const links = linkRows.results.map((link) => {
    const destination = approvedHttpsDestination(link.destination_url);
    if (destination.destinationUrl !== link.destination_url || destination.destinationHost !== link.destination_host) throw new Error("A saved public destination no longer passes approval validation. Update the draft first.");
    return { label: link.label, ...destination, sortOrder: link.sort_order };
  });
  const checksum = await bookingChecksumForVersion(DB, creatorId, version.id, { displayName: version.display_name, headline: version.headline, bio: version.bio, links });
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
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedPublicProfileVersionId(formData);
  const env = cloudflareEnv();
  const version = await creatorPrepare(env.DB, creatorId, `SELECT v.id,v.profile_id,v.creator_id,p.slug,p.published_version_id,v.version_number,v.display_name,v.headline,v.bio,v.content_checksum,v.status
    FROM creator_public_profile_versions v JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
    WHERE v.id=? AND v.creator_id=@creator AND v.status IN ('draft','approved')`).bind(versionId).first<PublicProfileVersionRow>();
  if (!version) throw new Error("Only this creator’s saved draft can be published.");
  const linkRows = await creatorPrepare(env.DB, creatorId, `SELECT label,destination_url,destination_host,sort_order
    FROM creator_public_links WHERE creator_id=@creator AND profile_version_id=? ORDER BY sort_order ASC`).bind(version.id)
    .all<{ label: string; destination_url: string; destination_host: string; sort_order: number }>();
  const links = linkRows.results.map((link) => {
    const destination = approvedHttpsDestination(link.destination_url);
    if (destination.destinationUrl !== link.destination_url || destination.destinationHost !== link.destination_host) throw new Error("A saved public destination no longer passes publication validation. Save the profile again before publishing.");
    return { label: link.label, ...destination, sortOrder: link.sort_order };
  });
  const checksum = await bookingChecksumForVersion(env.DB, creatorId, version.id, { displayName: version.display_name, headline: version.headline, bio: version.bio, links });
  if (checksum !== version.content_checksum) throw new Error("The profile changed outside the saved workflow. Save it again before publishing.");
  if (version.status === "draft") {
    const [approved] = await env.DB.batch([
      creatorPrepare(env.DB, creatorId, `UPDATE creator_public_profile_versions
        SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,approval_note='Publish selected in profile editor'
        WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'`).bind(identity.email, version.id, version.profile_id),
      identityAuditStatement(env.DB, humanAuditActor(identity), "public_profile_version_approved", version.id, { profileId: version.profile_id, versionNumber: version.version_number, contentChecksum: checksum, destinationCount: links.length, publicSurface: true, approvalSource: "publish_button" }),
    ]);
    if (!approved.meta?.changes) throw new Error("This public profile draft is no longer available to publish.");
  }
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
  const identity = await requireCreatorContext("mutate");
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

export async function saveAdultProfileDraftAction(_previousState: AdultProfileDraftState, formData: FormData): Promise<AdultProfileDraftState> {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const values = submittedAdultProfileDraftValues(formData);
  const validated = validateAdultProfileDraft(formData, values);
  if ("error" in validated) return validated.error;
  const { bio, links, appearance } = validated;
  const checksum = await adultProfileChecksum({ bio, links });
  const { DB } = cloudflareEnv();
  const [profile, draft, nextVersion] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,published_version_id FROM creator_adult_profiles WHERE creator_id=@creator LIMIT 1").first<{ id: string; published_version_id: string | null }>(),
    creatorPrepare(DB, creatorId, "SELECT id,profile_id,version_number FROM creator_adult_profile_versions WHERE creator_id=@creator AND status='draft' ORDER BY version_number DESC LIMIT 1").first<{ id: string; profile_id: string; version_number: number }>(),
    creatorPrepare(DB, creatorId, "SELECT COALESCE(MAX(version_number),0)+1 AS version_number FROM creator_adult_profile_versions WHERE creator_id=@creator").first<{ version_number: number }>(),
  ]);
  const profileId = profile?.id ?? crypto.randomUUID();
  const versionId = draft?.id ?? crypto.randomUUID();
  const versionNumber = draft?.version_number ?? nextVersion?.version_number ?? 1;
  const actor = humanAuditActor(identity);
  const statements = [
    ...(profile ? [] : [creatorPrepare(DB, creatorId, "INSERT INTO creator_adult_profiles (id,creator_id,created_by) VALUES (?,@creator,?)").bind(profileId, identity.email)]),
    ...(draft ? [
      creatorPrepare(DB, creatorId, "DELETE FROM creator_adult_link_revisions WHERE creator_id=@creator AND profile_version_id=?").bind(versionId),
      creatorPrepare(DB, creatorId, "UPDATE creator_adult_profile_versions SET adult_bio=?,content_checksum=? WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'").bind(bio, checksum, versionId, profileId),
    ] : [creatorPrepare(DB, creatorId, `INSERT INTO creator_adult_profile_versions
      (id,profile_id,creator_id,version_number,adult_bio,content_checksum,created_by)
      VALUES (?,?,@creator,?,?,?,?)`).bind(versionId, profileId, versionNumber, bio, checksum, identity.email)]),
    ...links.flatMap((link) => [
      creatorPrepare(DB, creatorId, "INSERT OR IGNORE INTO creator_adult_link_entities (id,creator_id) VALUES (?,@creator)").bind(link.stableId),
      creatorPrepare(DB, creatorId, `INSERT INTO creator_adult_link_revisions
        (id,creator_id,link_id,profile_version_id,label,destination_url,destination_host,icon_key,category,sort_order,enabled)
        VALUES (?,@creator,?,?,?,?,?,'link','creator',?,1)`)
        .bind(crypto.randomUUID(), link.stableId, versionId, link.label, link.destinationUrl, link.destinationHost, link.sortOrder),
    ]),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_adult_profile_appearances
      (profile_version_id,creator_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale,inherit_sfw_theme,updated_at)
      VALUES (?,@creator,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_version_id) DO UPDATE SET
        theme_key=excluded.theme_key,button_style=excluded.button_style,background_mode=excluded.background_mode,
        background_color=excluded.background_color,primary_color=excluded.primary_color,text_color=excluded.text_color,
        card_color=excluded.card_color,radius_scale=excluded.radius_scale,inherit_sfw_theme=excluded.inherit_sfw_theme,updated_at=CURRENT_TIMESTAMP`)
      .bind(versionId, appearance.themeKey, appearance.buttonStyle, appearance.backgroundMode, appearance.backgroundColor, appearance.primaryColor, appearance.textColor, appearance.cardColor, appearance.radiusScale, appearance.inheritSfwTheme ? 1 : 0),
    identityAuditStatement(DB, actor, draft ? "adult_profile_draft_updated" : "adult_profile_draft_created", versionId, { profileId, versionNumber, linkCount: links.length, contentChecksum: checksum, appearance: appearance.themeKey, adultSurface: true }),
  ];
  await DB.batch(statements);
  revalidatePath("/adult-profile");
  redirect("/adult-profile?notice=draft_saved");
}

export async function approveAdultProfileVersionAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedAdultProfileVersionId(formData);
  const approvalNote = publicText(formData.get("approvalNote"), 500, "approval note");
  const { DB } = cloudflareEnv();
  const version = await creatorPrepare(DB, creatorId, "SELECT id,profile_id,version_number,adult_bio,content_checksum FROM creator_adult_profile_versions WHERE id=? AND creator_id=@creator AND status='draft'").bind(versionId).first<{ id: string; profile_id: string; version_number: number; adult_bio: string; content_checksum: string }>();
  if (!version) throw new Error("Only this creator’s current adult-profile draft can be approved.");
  const linkRows = await creatorPrepare(DB, creatorId, "SELECT label,destination_url,destination_host,sort_order FROM creator_adult_link_revisions WHERE creator_id=@creator AND profile_version_id=? AND enabled=1 ORDER BY sort_order ASC").bind(version.id).all<{ label: string; destination_url: string; destination_host: string; sort_order: number }>();
  const links = linkRows.results.map((link) => {
    const destination = approvedHttpsDestination(link.destination_url);
    if (destination.destinationUrl !== link.destination_url || destination.destinationHost !== link.destination_host) throw new Error("A saved adult destination no longer passes approval validation. Update the draft first.");
    return { stableId: "checksum", label: link.label, ...destination, sortOrder: link.sort_order };
  });
  const checksum = await adultProfileChecksum({ bio: version.adult_bio, links });
  if (checksum !== version.content_checksum) throw new Error("The adult profile changed outside the approved draft workflow. Save the draft again before approving it.");
  const approved = await creatorPrepare(DB, creatorId, "UPDATE creator_adult_profile_versions SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,approval_note=? WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'").bind(identity.email, approvalNote, version.id, version.profile_id).run();
  if (!approved.meta?.changes) throw new Error("This adult profile draft is no longer available for approval.");
  await identityAuditStatement(DB, humanAuditActor(identity), "adult_profile_version_approved", version.id, { profileId: version.profile_id, versionNumber: version.version_number, contentChecksum: checksum, destinationCount: links.length, adultSurface: true }).run();
  revalidatePath("/adult-profile");
  redirect("/adult-profile?notice=version_approved");
}

export async function publishAdultProfileAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedAdultProfileVersionId(formData);
  const env = cloudflareEnv();
  if (String(env.ADULT_PROFILE_PUBLISHING_ENABLED) !== "1") throw new Error("Adult-profile publishing is not enabled in this environment.");
  const profile = await creatorPrepare(env.DB, creatorId, `SELECT p.id,p.published_version_id,v.id AS version_id,v.version_number,v.adult_bio,v.content_checksum,v.status AS version_status
    FROM creator_adult_profiles p
    JOIN creator_adult_profile_versions v ON v.id=? AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.creator_id=@creator AND v.status IN ('draft','approved')`).bind(versionId).first<{ id: string; published_version_id: string | null; version_id: string; version_number: number; adult_bio: string; content_checksum: string; version_status: "draft" | "approved" }>();
  if (!profile) throw new Error("Only this creator’s saved adult-profile draft can be published.");
  const linkRows = await creatorPrepare(env.DB, creatorId, "SELECT label,destination_url,destination_host,sort_order FROM creator_adult_link_revisions WHERE creator_id=@creator AND profile_version_id=? AND enabled=1 ORDER BY sort_order ASC").bind(profile.version_id).all<{ label: string; destination_url: string; destination_host: string; sort_order: number }>();
  const links = linkRows.results.map((link) => {
    const destination = approvedHttpsDestination(link.destination_url);
    if (destination.destinationUrl !== link.destination_url || destination.destinationHost !== link.destination_host) throw new Error("A saved adult destination no longer passes publication validation. Save the profile again before publishing.");
    return { stableId: "checksum", label: link.label, ...destination, sortOrder: link.sort_order };
  });
  const checksum = await adultProfileChecksum({ bio: profile.adult_bio, links });
  if (checksum !== profile.content_checksum) throw new Error("The adult profile changed outside the saved workflow. Save it again before publishing.");
  if (profile.version_status === "draft") {
    const [approved] = await env.DB.batch([
      creatorPrepare(env.DB, creatorId, "UPDATE creator_adult_profile_versions SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,approval_note='Publish selected in profile editor' WHERE id=? AND profile_id=? AND creator_id=@creator AND status='draft'").bind(identity.email, profile.version_id, profile.id),
      identityAuditStatement(env.DB, humanAuditActor(identity), "adult_profile_version_approved", profile.version_id, { profileId: profile.id, versionNumber: profile.version_number, contentChecksum: checksum, destinationCount: links.length, adultSurface: true, approvalSource: "publish_button" }),
    ]);
    if (!approved.meta?.changes) throw new Error("This adult-profile draft is no longer available to publish.");
  }
  const response = await fetchInternalService(env, "public_links_control", "adult.profile.publish", env.PUBLIC_LINKS_CONTROL, "https://public-links-control/adult/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creatorId, profileId: profile.id, versionId: profile.version_id }),
  });
  if (response.status !== 202) throw new Error(`Adult publication control did not accept this request (${response.status}).`);
  await identityAuditStatement(env.DB, humanAuditActor(identity), "adult_profile_publish_requested", profile.version_id, { profileId: profile.id, versionNumber: profile.version_number, adultSurface: true }).run();
  revalidatePath("/adult-profile");
  revalidatePath("/public-profile");
  redirect("/adult-profile?notice=publication_started");
}

export async function withdrawAdultProfileAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const versionId = submittedAdultProfileVersionId(formData);
  const env = cloudflareEnv();
  const profile = await creatorPrepare(env.DB, creatorId, "SELECT id,published_version_id FROM creator_adult_profiles WHERE creator_id=@creator AND status='active' AND published_version_id=?")
    .bind(versionId).first<{ id: string; published_version_id: string }>();
  if (!profile) throw new Error("This creator has no matching published adult profile to withdraw.");
  const response = await fetchInternalService(env, "public_links_control", "adult.profile.withdraw", env.PUBLIC_LINKS_CONTROL, "https://public-links-control/adult/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creatorId, profileId: profile.id, versionId: profile.published_version_id }),
  });
  if (response.status !== 202) throw new Error(`Adult withdrawal control did not accept this request (${response.status}).`);
  await identityAuditStatement(env.DB, humanAuditActor(identity), "adult_profile_withdraw_requested", profile.published_version_id, { profileId: profile.id, adultSurface: true }).run();
  revalidatePath("/adult-profile");
  revalidatePath("/public-profile");
  redirect("/adult-profile?notice=withdrawal_started");
}
