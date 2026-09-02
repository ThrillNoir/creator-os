"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";
import { INTERVIEW_FIELDS } from "@/lib/onboarding-interview";
import { missingRequiredOnboardingSections, ONBOARDING_SECTION_KEYS, REQUIRED_ONBOARDING_SECTION_KEYS } from "@/lib/onboarding-sections";
import { INVALIDATE_COMPLIANCE_IDENTITY_SQL, RESET_IDENTITY_VERIFICATION_SQL, SAVE_COMPLIANCE_IDENTITY_SQL } from "@/lib/onboarding-identity";
import { requireStepUpSession, STEP_UP_COOKIE } from "@/lib/access-vault";
import { redirect } from "next/navigation";

const sections = new Set<string>(ONBOARDING_SECTION_KEYS);
const socialPlatforms = new Set(["instagram", "reddit", "tiktok", "threads", "x", "facebook", "telegram", "youtube", "other"]);
const paidPlatforms = new Set(["onlyfans", "fansly", "manyvids", "patreon", "myroomz", "other"]);
const creatorLoginMethods = new Set(["password", "google", "apple"]);

function value(form: FormData, key: string, maximum = 2000) { return String(form.get(key) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, maximum); }
function email(form: FormData, key: string) { const result = value(form, key, 254).toLowerCase(); if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error("Enter a valid contact email."); return result; }
const platformHosts: Record<string, string[]> = { instagram: ["instagram.com"], reddit: ["reddit.com"], x: ["x.com", "twitter.com"], tiktok: ["tiktok.com"], threads: ["threads.net"], facebook: ["facebook.com"], telegram: ["t.me"], youtube: ["youtube.com", "youtu.be"], fansly: ["fansly.com"], onlyfans: ["onlyfans.com"], manyvids: ["manyvids.com"], patreon: ["patreon.com"], myroomz: ["myroomz.com"] };
function profileUrl(form: FormData, platform: string) { const result = value(form, "profileUrl", 500); if (!result) return ""; let parsed: URL; try { parsed = new URL(result); } catch { throw new Error("Enter a valid profile URL."); } if (parsed.protocol !== "https:") throw new Error("Profile URLs must use https."); const hosts = platformHosts[platform]; if (hosts && !hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) throw new Error(`Enter a ${platform} profile URL.`); return parsed.toString(); }
function dateOfBirth(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a valid date of birth."); const date = new Date(`${value}T00:00:00Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid date of birth."); const now = new Date(); const adult = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate())); if (date > adult || date < new Date("1900-01-01T00:00:00Z")) throw new Error("The supplied date does not meet adult verification requirements."); return value; }
function revalidate() { revalidatePath("/onboarding"); revalidatePath("/creators"); }

async function context() { return requireCreatorContext("mutate"); }
async function requireCreatorPin(identity: Awaited<ReturnType<typeof context>>) {
  const cookieStore = await cookies();
  await requireStepUpSession({ sessionId: cookieStore.get(STEP_UP_COOKIE)?.value, email: identity.email, creatorId: identity.creator.creator_id, role: identity.creator.role });
}
async function audit(creatorId: string, actor: { identity: string; role: string }, event: string, subject: string, detail: Record<string, unknown> = {}) {
  await cloudflareEnv().DB.prepare("INSERT INTO creator_access_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), creatorId, actor.identity, actor.role, event, subject, JSON.stringify(detail)).run();
}
async function changedSection(creatorId: string, section: string, email: string, isCreator: boolean) {
  const DB = cloudflareEnv().DB;
  await DB.prepare(`INSERT INTO creator_onboarding_sections (creator_id,section_key,status,updated_by) VALUES (?,?,?,?)
    ON CONFLICT(creator_id,section_key) DO UPDATE SET status=CASE WHEN ? THEN 'draft' ELSE 'admin_review' END,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,reviewed_at=NULL`)
    .bind(creatorId, section, isCreator ? "draft" : "admin_review", email, isCreator ? 1 : 0).run();
  await DB.prepare("UPDATE creator_onboarding_profiles SET workflow_state=CASE WHEN ? THEN 'draft' ELSE 'admin_review' END,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(isCreator ? 1 : 0, creatorId).run();
}

async function saveComplianceIdentity(DB: D1Database, creatorId: string, legalName: string, dob: string) {
  const results = await DB.batch([
    DB.prepare(INVALIDATE_COMPLIANCE_IDENTITY_SQL).bind(creatorId, legalName, dob),
    DB.prepare(RESET_IDENTITY_VERIFICATION_SQL).bind(creatorId, creatorId, legalName, dob),
    DB.prepare(SAVE_COMPLIANCE_IDENTITY_SQL).bind(creatorId, legalName, dob),
  ]);
  const changed = Number(results[0]?.meta?.changes ?? 0) > 0;
  return changed;
}

export async function saveOnboardingIdentityAction(form: FormData) {
  const identity = await context(); const creatorId = identity.creator.creator_id; const admin = identity.creator.role === "agency_admin";
  if (!admin && identity.creator.role !== "creator") throw new Error("Only creators and agency administrators can edit onboarding identity.");
  const stageName = value(form, "stageName", 100); if (admin && !stageName) throw new Error("Stage name is required.");
  const DB = cloudflareEnv().DB;
  const actor = humanAuditActor(identity);
  const legalName = admin ? value(form, "legalName", 160) : "";
  const dob = admin ? value(form, "dateOfBirth", 10) : "";
  if (admin && (legalName || dob) && (!legalName || !dob)) throw new Error("Legal name and date of birth must be recorded together.");
  if (admin && dob) dateOfBirth(dob);
  await DB.prepare(`INSERT INTO creator_onboarding_profiles (creator_id,stage_name,preferred_name,contact_email,contact_phone,country,time_zone,restricted_admin_notes)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET stage_name=CASE WHEN excluded.stage_name<>'' THEN excluded.stage_name ELSE creator_onboarding_profiles.stage_name END,preferred_name=CASE WHEN excluded.preferred_name<>'' THEN excluded.preferred_name ELSE creator_onboarding_profiles.preferred_name END,contact_email=CASE WHEN excluded.contact_email<>'' THEN excluded.contact_email ELSE creator_onboarding_profiles.contact_email END,contact_phone=CASE WHEN excluded.contact_phone<>'' THEN excluded.contact_phone ELSE creator_onboarding_profiles.contact_phone END,country=CASE WHEN excluded.country<>'' THEN excluded.country ELSE creator_onboarding_profiles.country END,time_zone=CASE WHEN excluded.time_zone<>'' THEN excluded.time_zone ELSE creator_onboarding_profiles.time_zone END,restricted_admin_notes=CASE WHEN ? THEN excluded.restricted_admin_notes ELSE creator_onboarding_profiles.restricted_admin_notes END,updated_at=CURRENT_TIMESTAMP`)
    .bind(creatorId, stageName, value(form, "preferredName", 100), email(form, "contactEmail"), value(form, "contactPhone", 40), value(form, "country", 80), value(form, "timeZone", 80), admin ? value(form, "restrictedAdminNotes", 4000) : "", admin ? 1 : 0).run();
  if (admin && legalName && dob) await saveComplianceIdentity(DB, creatorId, legalName, dob);
  await changedSection(creatorId, "identity", identity.email, identity.creator.role === "creator");
  await audit(creatorId, actor, "onboarding_identity_saved", "identity", { complianceValuesUpdated: Boolean(admin && legalName) }); revalidate();
}

export async function savePrivateIdentityAction(form: FormData) {
  const identity = await context();
  if (identity.creator.role !== "creator") throw new Error("Only the creator can enter private identity details here.");
  const legalName = value(form, "legalName", 160); const dob = value(form, "dateOfBirth", 10);
  if (!legalName || !dob) throw new Error("Legal name and date of birth must be recorded together.");
  dateOfBirth(dob);
  const changed = await saveComplianceIdentity(cloudflareEnv().DB, identity.creator.creator_id, legalName, dob);
  if (changed) await changedSection(identity.creator.creator_id, "identity", identity.email, true);
  await audit(identity.creator.creator_id, humanAuditActor(identity), "creator_private_identity_saved", "identity", { identityChanged: changed, verificationInvalidated: changed }); revalidate();
}

export async function saveComplianceAction(form: FormData) {
  const identity = await requireCreatorContext("manage_identity"); const creatorId = identity.creator.creator_id; const DB = cloudflareEnv().DB; const actor = humanAuditActor(identity);
  const adult = value(form, "adultVerificationStatus", 20); const contract = value(form, "contractStatus", 20); const consent = value(form, "consentStatus", 20);
  if (!["not_started", "submitted", "verified", "rejected"].includes(adult) || !["not_started", "pending", "active", "expired", "terminated"].includes(contract) || !["not_recorded", "pending", "recorded", "withdrawn"].includes(consent)) throw new Error("Choose valid compliance statuses.");
  await DB.prepare(`INSERT INTO creator_onboarding_profiles (creator_id,adult_verification_status,contract_status,consent_status) VALUES (?,?,?,?)
    ON CONFLICT(creator_id) DO UPDATE SET adult_verification_status=excluded.adult_verification_status,contract_status=excluded.contract_status,consent_status=excluded.consent_status,updated_at=CURRENT_TIMESTAMP`).bind(creatorId, adult, contract, consent).run();
  if (adult === "verified") await DB.prepare("UPDATE creator_compliance_records SET adult_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND date_of_birth<>''").bind(creatorId).run();
  await changedSection(creatorId, "identity", identity.email, false); await audit(creatorId, actor, "onboarding_compliance_updated", "identity", { adultStatus: adult, contractStatus: contract, consentStatus: consent }); revalidate();
}

async function createOperationalProfile(form: FormData, creatorOnly = false) {
  const identity = creatorOnly ? await context() : await requireCreatorContext("manage_identity"); const creatorId = identity.creator.creator_id; const creator = identity.creator.role === "creator"; const type = value(form, "accountKind", 10); const platform = value(form, "platform", 40).toLowerCase();
  if (creatorOnly && !creator) throw new Error("Only the creator can add an account through onboarding.");
  if (creatorOnly) await requireCreatorPin(identity);
  if ((type !== "social" || !socialPlatforms.has(platform)) && (type !== "paid" || !paidPlatforms.has(platform))) throw new Error("Choose a supported social or paid platform.");
  const username = value(form, "username", 120); if (creator && !username) throw new Error("Username is required.");
  const label = creator ? username : value(form, "label", 100); if (!label) throw new Error("Account label is required.");
  const loginMethod = creator ? value(form, "loginMethod", 20) : value(form, "connectionMethod", 80);
  if (creator && !creatorLoginMethods.has(loginMethod)) throw new Error("Choose password, Google or Apple sign-in.");
  const loginEmail = email(form, "loginEmail");
  if (creator && loginMethod !== "password" && !loginEmail) throw new Error("Enter the email used for Google or Apple sign-in.");
  const isActive = creator ? 0 : (form.has("isActive") && form.get("isActive") === "yes" ? 1 : 0);
  const creatorVisible = creator ? 1 : (form.has("creatorVisible") && form.get("creatorVisible") === "yes" ? 1 : 0);
  const id = crypto.randomUUID(); const DB = cloudflareEnv().DB; const actor = humanAuditActor(identity);
  await DB.prepare(`INSERT INTO operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,account_kind,login_email,profile_url,account_purpose,is_active,connection_method,creator_visible,administrator_notes,capabilities_json,private_upload_destination)
  VALUES (?,?,?,?,?,'not_connected','not_configured','not_configured',?,?,?,?,?,?,?,?,?,?)`).bind(id, creatorId, platform, label, username, type, loginEmail, profileUrl(form, platform), value(form, "purpose", 400), isActive, loginMethod, creatorVisible, creator ? "" : value(form, "administratorNotes", 3000), "[]", creator ? "" : value(form, "privateUploadDestination", 500)).run();
  await changedSection(creatorId, type === "social" ? "social_profiles" : "paid_platforms", identity.email, creator); await audit(creatorId, actor, "onboarding_operational_account_created", id, { accountKind: type, platform, creatorVisible: Boolean(creatorVisible), isActive: Boolean(isActive), loginMethod }); revalidate();
  return id;
}

export async function addOperationalProfileAction(form: FormData) { await createOperationalProfile(form); }
export async function createCreatorOperationalProfileAction(form: FormData) { return { ok: true, id: await createOperationalProfile(form, true) }; }

export async function saveCreatorAccountLoginMethodAction(form: FormData) {
  const identity = await context();
  if (identity.creator.role !== "creator") throw new Error("Only the creator can save an account sign-in method here.");
  await requireCreatorPin(identity);
  const accountId = value(form, "accountId", 160); const loginMethod = value(form, "loginMethod", 20); const loginEmail = email(form, "loginEmail");
  if (!accountId || !creatorLoginMethods.has(loginMethod)) throw new Error("Choose an account and sign-in method.");
  if (loginMethod !== "password" && !loginEmail) throw new Error("Enter the email used for Google or Apple sign-in.");
  const username = value(form, "username", 120); if (!username) throw new Error("Username is required.");
  const DB = cloudflareEnv().DB;
  const account = await DB.prepare("SELECT account_kind,platform FROM operational_accounts WHERE id=? AND creator_id=? AND creator_visible=1").bind(accountId, identity.creator.creator_id).first<{ account_kind: string; platform: string }>();
  if (!account) throw new Error("Choose an account in your workspace.");
  await DB.prepare("UPDATE operational_accounts SET label=?,handle=?,login_email=?,profile_url=?,account_purpose=?,connection_method=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(username, username, loginEmail, profileUrl(form, account.platform), value(form, "purpose", 400), loginMethod, accountId, identity.creator.creator_id).run();
  await changedSection(identity.creator.creator_id, account.account_kind === "paid" ? "paid_platforms" : "social_profiles", identity.email, true);
  await audit(identity.creator.creator_id, humanAuditActor(identity), "onboarding_account_login_method_saved", accountId, { loginMethod }); revalidate();
  return { ok: true };
}

export async function saveGuidedInterviewAction(_previous: { ok: boolean; message: string }, form: FormData) {
  try {
    const identity = await context();
    if (identity.creator.role !== "creator") return { ok: false, message: "Guided answers can only be confirmed by the creator." };
    const field = value(form, "field", 80); const answer = value(form, "answer", 4000);
    if (!INTERVIEW_FIELDS.has(field)) return { ok: false, message: "That interview field is not available." };
    const creatorId = identity.creator.creator_id; const DB = cloudflareEnv().DB;
    const target = field === "stage_name" ? "creator_onboarding_profiles" : field === "voice_summary" || field === "forbidden_topics_claims" ? "creator_brand_voice_profiles" : field === "short_bio" || field === "interests" ? "creator_about_profiles" : "creator_brand_positioning";
    await DB.prepare(`INSERT INTO ${target} (creator_id,${field}) VALUES (?,?) ON CONFLICT(creator_id) DO UPDATE SET ${field}=excluded.${field},updated_at=CURRENT_TIMESTAMP`).bind(creatorId, answer).run();
    const section = target === "creator_onboarding_profiles" ? "identity" : target === "creator_brand_voice_profiles" ? "brand_voice" : target === "creator_about_profiles" ? "about_me" : "positioning";
    await changedSection(creatorId, section, identity.email, true); await audit(creatorId, humanAuditActor(identity), "onboarding_guided_answer_confirmed", field, { length: answer.length }); revalidate();
    return { ok: true, message: "Saved. Nice work." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Could not save that answer." }; }
}

export async function retireOperationalAccountAction(form: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  if (identity.creator.role !== "agency_admin") throw new Error("Only agency administrators can retire accounts.");
  const creatorId = identity.creator.creator_id;
  const accountId = value(form, "accountId", 160);
  if (!accountId) throw new Error("Choose an account to retire.");
  const DB = cloudflareEnv().DB;
  const account = await DB.prepare("SELECT id,label FROM operational_accounts WHERE id=? AND creator_id=? AND is_active=1").bind(accountId, creatorId).first<{ id: string; label: string }>();
  if (!account) throw new Error("That account is already inactive or outside this creator workspace.");
  const pending = await DB.prepare("SELECT COUNT(*) AS count FROM social_posts WHERE creator_id=? AND account_id=? AND status IN ('draft','scheduled','publishing')").bind(creatorId, accountId).first<{ count: number }>();
  if (Number(pending?.count ?? 0) > 0) throw new Error("Retire or cancel this account’s draft, scheduled, and publishing posts first.");
  await DB.batch([
    DB.prepare("UPDATE operational_accounts SET is_active=0,publishing_authority='blocked',connection_status='not_connected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND is_active=1").bind(accountId, creatorId),
    DB.prepare("UPDATE provider_connections SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND account_id=?").bind(creatorId, accountId),
  ]);
  await audit(creatorId, humanAuditActor(identity), "operational_account_retired", accountId, { label: account.label, reversible: true });
  revalidate();
  redirect("/onboarding?saved=account_retired");
}

export async function saveChromeAccessAction(form: FormData) {
  const identity = await requireCreatorContext("manage_identity"); const creatorId = identity.creator.creator_id; const DB = cloudflareEnv().DB;
  const usesChrome = form.get("usesChrome") === "yes" ? 1 : 0;
  await DB.prepare(`INSERT INTO creator_onboarding_profiles (creator_id,uses_chrome) VALUES (?,?)
    ON CONFLICT(creator_id) DO UPDATE SET uses_chrome=excluded.uses_chrome,updated_at=CURRENT_TIMESTAMP`).bind(creatorId, usesChrome).run();
  await changedSection(creatorId, "chrome_access", identity.email, false);
  await audit(creatorId, humanAuditActor(identity), "onboarding_chrome_access_updated", "chrome_access", { usesChrome: Boolean(usesChrome) }); revalidate();
}

export async function saveBrandContextAction(form: FormData) {
  const identity = await context(); const creatorId = identity.creator.creator_id; const DB = cloudflareEnv().DB; const actor = humanAuditActor(identity);
  if (identity.creator.role !== "creator" && identity.creator.role !== "agency_admin") throw new Error("Only creators and agency administrators can edit creator context.");
  await DB.batch([
    DB.prepare(`INSERT INTO creator_brand_voice_profiles (creator_id,voice_summary,tone_personality,common_vocabulary,phrases_to_avoid,emoji_style,caption_length_preference,humour_style,flirting_intensity,forbidden_topics_claims,creator_examples,platform_variations)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET voice_summary=excluded.voice_summary,tone_personality=excluded.tone_personality,common_vocabulary=excluded.common_vocabulary,phrases_to_avoid=excluded.phrases_to_avoid,emoji_style=excluded.emoji_style,caption_length_preference=excluded.caption_length_preference,humour_style=excluded.humour_style,flirting_intensity=excluded.flirting_intensity,forbidden_topics_claims=excluded.forbidden_topics_claims,creator_examples=excluded.creator_examples,platform_variations=excluded.platform_variations,updated_at=CURRENT_TIMESTAMP`).bind(creatorId, value(form,"voiceSummary"),value(form,"tonePersonality"),value(form,"commonVocabulary"),value(form,"phrasesToAvoid"),value(form,"emojiStyle",100),value(form,"captionLengthPreference",100),value(form,"humourStyle"),value(form,"flirtingIntensity"),value(form,"forbiddenTopicsClaims"),value(form,"creatorExamples",8000),value(form,"platformVariations",4000)),
    DB.prepare(`INSERT INTO creator_brand_positioning (creator_id,current_positioning,desired_positioning,primary_audience,niches_themes,differentiators,visual_style,content_pillars,paid_content_proposition,growth_priorities,hard_boundaries,inspiration_references)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET current_positioning=excluded.current_positioning,desired_positioning=excluded.desired_positioning,primary_audience=excluded.primary_audience,niches_themes=excluded.niches_themes,differentiators=excluded.differentiators,visual_style=excluded.visual_style,content_pillars=excluded.content_pillars,paid_content_proposition=excluded.paid_content_proposition,growth_priorities=excluded.growth_priorities,hard_boundaries=excluded.hard_boundaries,inspiration_references=excluded.inspiration_references,updated_at=CURRENT_TIMESTAMP`).bind(creatorId,value(form,"currentPositioning"),value(form,"desiredPositioning"),value(form,"primaryAudience"),value(form,"nichesThemes"),value(form,"differentiators"),value(form,"visualStyle"),value(form,"contentPillars"),value(form,"paidContentProposition"),value(form,"growthPriorities"),value(form,"hardBoundaries"),value(form,"inspirationReferences")),
    DB.prepare(`INSERT INTO creator_about_profiles (creator_id,short_bio,long_bio,interests,approved_background_facts,location_disclosure_preference,relationship_disclosure_preference,approved_identifying_features,public_talking_points,private_facts)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET short_bio=excluded.short_bio,long_bio=excluded.long_bio,interests=excluded.interests,approved_background_facts=excluded.approved_background_facts,location_disclosure_preference=excluded.location_disclosure_preference,relationship_disclosure_preference=excluded.relationship_disclosure_preference,approved_identifying_features=excluded.approved_identifying_features,public_talking_points=excluded.public_talking_points,private_facts=excluded.private_facts,updated_at=CURRENT_TIMESTAMP`).bind(creatorId,value(form,"shortBio"),value(form,"longBio",4000),value(form,"interests"),value(form,"approvedBackgroundFacts",4000),value(form,"locationDisclosurePreference",40),value(form,"relationshipDisclosurePreference",40),value(form,"approvedIdentifyingFeatures"),value(form,"publicTalkingPoints",4000),value(form,"privateFacts",4000)),
  ]);
  await Promise.all([changedSection(creatorId,"brand_voice",identity.email,identity.creator.role === "creator"),changedSection(creatorId,"positioning",identity.email,identity.creator.role === "creator"),changedSection(creatorId,"about_me",identity.email,identity.creator.role === "creator")]); await audit(creatorId,actor,"onboarding_brand_context_saved","brand_context",{}); revalidate();
}

export async function reviewOnboardingSectionAction(form: FormData) {
  const identity = await context(); const creatorId = identity.creator.creator_id; const section = value(form,"section",40); if (!sections.has(section)) throw new Error("Unknown onboarding section.");
  const admin = identity.creator.role === "agency_admin"; if (!admin && identity.creator.role !== "creator") throw new Error("This role cannot review onboarding.");
  const status = admin ? "complete" : "creator_review"; await cloudflareEnv().DB.prepare(`INSERT INTO creator_onboarding_sections (creator_id,section_key,status,updated_by,reviewed_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(creator_id,section_key) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,reviewed_at=CURRENT_TIMESTAMP`).bind(creatorId,section,status,identity.email).run();
  if (admin) await cloudflareEnv().DB.prepare("UPDATE creator_onboarding_profiles SET workflow_state='admin_review',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(creatorId).run();
  await audit(creatorId,humanAuditActor(identity),admin ? "onboarding_section_approved" : "onboarding_creator_reviewed",section,{}); revalidate();
}

export async function submitCreatorOnboardingAction() {
  const identity = await context();
  if (identity.creator.role !== "creator") throw new Error("Only the creator can submit this onboarding interview.");
  const creatorId = identity.creator.creator_id;
  const DB = cloudflareEnv().DB;
  const [profile, compliance, brand, account] = await Promise.all([
    DB.prepare("SELECT stage_name,contact_email,contact_phone FROM creator_onboarding_profiles WHERE creator_id=?").bind(creatorId).first<{ stage_name: string; contact_email: string; contact_phone: string }>(),
    DB.prepare("SELECT legal_name,date_of_birth FROM creator_compliance_records WHERE creator_id=?").bind(creatorId).first<{ legal_name: string; date_of_birth: string }>(),
    DB.prepare(`SELECT bv.voice_summary,ba.short_bio,ba.interests,bp.niches_themes,bp.hard_boundaries,bp.growth_priorities FROM creator_brand_voice_profiles bv
      LEFT JOIN creator_about_profiles ba ON ba.creator_id=bv.creator_id LEFT JOIN creator_brand_positioning bp ON bp.creator_id=bv.creator_id WHERE bv.creator_id=?`).bind(creatorId).first<Record<string, string>>(),
    DB.prepare("SELECT id FROM operational_accounts WHERE creator_id=? AND creator_visible=1 AND account_kind IN ('social','paid') LIMIT 1").bind(creatorId).first<{ id: string }>(),
  ]);
  const missing = [
    !compliance?.legal_name || !compliance.date_of_birth || !profile?.contact_email || !profile.contact_phone ? "Who is the real you" : "",
    !profile?.stage_name || !brand || [brand.short_bio, brand.voice_summary, brand.interests, brand.niches_themes, brand.hard_boundaries, brand.growth_priorities].some((item) => !item?.trim()) ? "Who is the online you" : "",
    !account ? "Accounts and logins" : "",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Complete these chapters before sending: ${missing.join(", ")}.`);
  const keys = REQUIRED_ONBOARDING_SECTION_KEYS;
  await DB.batch(keys.map((key) => DB.prepare(`INSERT INTO creator_onboarding_sections (creator_id,section_key,status,updated_by,reviewed_at) VALUES (?,?,'creator_review',?,CURRENT_TIMESTAMP)
    ON CONFLICT(creator_id,section_key) DO UPDATE SET status='creator_review',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,reviewed_at=CURRENT_TIMESTAMP`).bind(creatorId, key, identity.email)));
  await DB.prepare("UPDATE creator_onboarding_profiles SET workflow_state='creator_review',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(creatorId).run();
  await audit(creatorId, humanAuditActor(identity), "onboarding_creator_submitted", "creator_review", { sections: keys.length });
  revalidate(); redirect("/onboarding?submitted=1#onboarding-review");
}

export async function activateOnboardingAction() {
  const identity = await requireCreatorContext("manage_identity"); const creatorId = identity.creator.creator_id; const DB = cloudflareEnv().DB;
  const [profile, open] = await Promise.all([
    DB.prepare("SELECT p.adult_verification_status,p.contract_status,p.consent_status,c.adult_verified_at FROM creator_onboarding_profiles p LEFT JOIN creator_compliance_records c ON c.creator_id=p.creator_id WHERE p.creator_id=?").bind(creatorId).first<{ adult_verification_status:string;contract_status:string;consent_status:string;adult_verified_at:string|null }>(),
    DB.prepare("SELECT section_key,status FROM creator_onboarding_sections WHERE creator_id=?").bind(creatorId).all<{section_key:string;status:string}>(),
  ]);
  if (!profile || profile.adult_verification_status !== "verified" || !profile.adult_verified_at || profile.contract_status !== "active" || profile.consent_status !== "recorded" || missingRequiredOnboardingSections(open.results).length) throw new Error("Complete every required onboarding section and activate compliance before activating this creator.");
  await DB.batch([
    DB.prepare("UPDATE creator_onboarding_profiles SET workflow_state='active',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(creatorId),
    DB.prepare("UPDATE operational_accounts SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND account_kind IN ('social','paid') AND creator_visible=1 AND is_active=0 AND publishing_authority='not_configured' AND EXISTS (SELECT 1 FROM creator_access_audit_events e WHERE e.creator_id=operational_accounts.creator_id AND e.subject=operational_accounts.id AND e.actor_role='creator' AND e.event_type='onboarding_operational_account_created') AND EXISTS (SELECT 1 FROM creator_onboarding_profiles p LEFT JOIN creator_compliance_records c ON c.creator_id=p.creator_id WHERE p.creator_id=operational_accounts.creator_id AND p.workflow_state='active' AND p.adult_verification_status='verified' AND p.contract_status='active' AND p.consent_status='recorded' AND c.adult_verified_at IS NOT NULL)").bind(creatorId),
    DB.prepare("UPDATE creator_compliance_records SET activated_by=?,activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(identity.email,creatorId),
  ]); await audit(creatorId,humanAuditActor(identity),"creator_onboarding_activated","onboarding",{}); revalidate();
}
