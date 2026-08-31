"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { requireCreatorContext, getCreatorIdentity } from "@/lib/identity";
import { verifyAccessIdentity } from "@/lib/access";
import { getOnboardingResult, validateOnboardingRequest } from "@/lib/creator-onboarding";
import { isAgencyStaffRole } from "@/lib/authorization";
import { revokeStepUpSessions, STEP_UP_COOKIE } from "@/lib/access-vault";
import type { CreatorRole } from "@/lib/identity";

const membershipRoles = new Set<CreatorRole>(["agency_admin", "operator", "creator", "viewer"]);

function membershipEmail(value: FormDataEntryValue | null) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid member email address.");
  return email;
}

function requireConfirmation(formData: FormData, expected: string) {
  if (formData.get("confirmation") !== expected) throw new Error("Explicit confirmation is required for this administrative action.");
}

function invitationEmail(value: FormDataEntryValue | null) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the creator's exact invitation email.");
  return email;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function invitationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendInvitationEmail(email: string, creatorName: string, token: string) {
  const env = cloudflareEnv() as CloudflareEnv & { EMAIL?: SendEmail; APP_BASE_URL?: string };
  if (!env.EMAIL) throw new Error("Email Sending is not configured.");
  const link = `${env.APP_BASE_URL ?? ""}/invite/${token}`;
  await env.EMAIL.send({
    from: "THOT OS <welcome@thathuboverthere.com>", to: email,
    subject: "Your THOT OS workspace is ready",
    text: `Your ${creatorName} THOT OS workspace is ready. Sign in with Cloudflare Access and claim it here: ${link}\n\nThis invitation expires in 7 days.`,
  });
}

export async function switchCreatorAction(formData: FormData) {
  const identity = await getCreatorIdentity();
  const creatorId = String(formData.get("creatorId") ?? "");
  const membership = identity.memberships.find((item) => item.creator_id === creatorId && isAgencyStaffRole(item.role));
  if (!membership) throw new Error("Only an agency administrator can switch to that creator workspace.");
  const { DB } = cloudflareEnv();
  await identityAuditStatement(DB, humanAuditActor({ email: identity.email, creator: membership }), "creator_workspace_selected", creatorId, { administrativeAction: true }).run();
  const localBypass = (cloudflareEnv() as CloudflareEnv & { LOCAL_ACCESS_BYPASS?: string }).LOCAL_ACCESS_BYPASS;
  const cookieStore = await cookies();
  const priorCreatorId = cookieStore.get("thot_os_creator")?.value;
  if (priorCreatorId && priorCreatorId !== creatorId) {
    await revokeStepUpSessions(identity.email);
    cookieStore.delete(STEP_UP_COOKIE);
  }
  cookieStore.set("thot_os_creator", creatorId, { httpOnly: true, sameSite: "lax", secure: localBypass !== "1", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function onboardCreatorWorkspaceAction(formData: FormData) {
  const identity = await getCreatorIdentity();
  const operatorMembership = identity.memberships.find((membership) => membership.role === "agency_admin");
  if (!operatorMembership) throw new Error("Only an agency administrator can create a creator workspace.");
  const request = await validateOnboardingRequest(Object.fromEntries(formData), identity.email);
  const invitedEmail = invitationEmail(formData.get("invitationEmail"));
  const token = invitationToken();
  const tokenHash = await sha256(token);
  const invitationId = crypto.randomUUID();
  const { DB } = cloudflareEnv();
  const completed = await getOnboardingResult(DB, request);
  if (completed) {
    revalidatePath("/");
    revalidatePath("/creators");
    return;
  }
  const collision = await DB.prepare("SELECT id FROM creators WHERE id=? OR slug=? LIMIT 1").bind(request.creatorId, request.slug).first<{ id: string }>();
  if (collision) throw new Error("A creator workspace already exists with that ID or slug. Use its existing onboarding receipt.");
  const user = await DB.prepare("SELECT status FROM users WHERE lower(email)=?").bind(request.requestedBy).first<{ status: string }>();
  if (user?.status === "suspended") throw new Error("The signed-in operator is globally suspended.");
  const auditActor = { identity: identity.email, role: "agency_admin" as const, creatorId: request.creatorId };
  let created = true;
  try {
    await DB.batch([
      DB.prepare("INSERT INTO creators (id,name,slug,initials,accent,status) VALUES (?,?,?,?,?,'active')").bind(request.creatorId, request.name, request.slug, request.initials, request.accent),
      DB.prepare("INSERT OR IGNORE INTO users (email,display_name,status) VALUES (?,?,'active')").bind(request.requestedBy, identity.email),
      DB.prepare("INSERT INTO creator_memberships (creator_id,user_email,role,status) VALUES (?,?,'agency_admin','active')").bind(request.creatorId, request.requestedBy),
      DB.prepare("INSERT INTO creator_onboarding_profiles (creator_id,stage_name) VALUES (?,?)").bind(request.creatorId, request.name),
      DB.prepare("INSERT INTO creator_invitations (id,creator_id,invited_email,token_hash,expires_at,created_by) VALUES (?,?,?,?,datetime('now','+7 days'),?)").bind(invitationId, request.creatorId, invitedEmail, tokenHash, request.requestedBy),
      DB.prepare(`INSERT INTO creator_onboarding_receipts
        (id,idempotency_key,creator_id,requested_by,request_fingerprint,status)
        VALUES (?,?,?,?,?,'completed')`).bind(crypto.randomUUID(), request.idempotencyKey, request.creatorId, request.requestedBy, request.fingerprint),
      identityAuditStatement(DB, auditActor, "creator_workspace_onboarded", request.creatorId, { onboardingReceipt: request.idempotencyKey, metadataOnly: true }),
    ]);
  } catch (error) {
    // A duplicate retry may race the first accepted request. Resolve only an
    // identical immutable receipt; never treat a different request as success.
    const raced = await getOnboardingResult(DB, request);
    if (!raced) throw error;
    created = false;
  }
  if (!created) return;
  await sendInvitationEmail(invitedEmail, request.name, token);
  await DB.prepare("UPDATE creator_invitations SET sent_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(invitationId).run();
  revalidatePath("/");
  revalidatePath("/creators");
}

export async function revokeCreatorInvitationAction(formData: FormData) {
  requireConfirmation(formData, "revoke-invitation");
  const context = await requireCreatorContext("manage_identity");
  if (context.creator.role !== "agency_admin") throw new Error("Only an agency administrator can revoke invitations.");
  const id = String(formData.get("invitationId") ?? "");
  const { DB } = cloudflareEnv();
  const result = await DB.prepare("UPDATE creator_invitations SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='pending'").bind(id, context.creator.creator_id).run();
  if (!result.meta.changes) throw new Error("That invitation is no longer pending.");
  await DB.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.creator.creator_id, context.email, context.creator.role, "creator_invitation_revoked", id, JSON.stringify({ administrativeAction: true })).run();
  revalidatePath("/creators");
}

export async function resendCreatorInvitationAction(formData: FormData) {
  const context = await requireCreatorContext("manage_identity");
  if (context.creator.role !== "agency_admin") throw new Error("Only an agency administrator can resend invitations.");
  const id = String(formData.get("invitationId") ?? "");
  const { DB } = cloudflareEnv();
  const prior = await DB.prepare("SELECT invited_email FROM creator_invitations WHERE id=? AND creator_id=? AND status='pending'").bind(id, context.creator.creator_id).first<{ invited_email: string }>();
  if (!prior) throw new Error("That invitation is no longer pending.");
  const creator = await DB.prepare("SELECT name FROM creators WHERE id=?").bind(context.creator.creator_id).first<{ name: string }>();
  const token = invitationToken();
  const invitationId = crypto.randomUUID();
  await DB.batch([
    DB.prepare("UPDATE creator_invitations SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(id),
    DB.prepare("INSERT INTO creator_invitations (id,creator_id,invited_email,token_hash,expires_at,created_by) VALUES (?,?,?,?,datetime('now','+7 days'),?)").bind(invitationId, context.creator.creator_id, prior.invited_email, await sha256(token), context.email),
  ]);
  await sendInvitationEmail(prior.invited_email, creator?.name ?? "your", token);
  await DB.prepare("UPDATE creator_invitations SET sent_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(invitationId).run();
  revalidatePath("/creators");
}

export async function claimCreatorInvitationAction(formData: FormData) {
  const identity = await verifyAccessIdentity();
  const token = String(formData.get("token") ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("This invitation is invalid or expired.");
  const tokenHash = await sha256(token);
  const { DB } = cloudflareEnv();
  const invitation = await DB.prepare("SELECT id,creator_id,invited_email FROM creator_invitations WHERE token_hash=? AND status='pending' AND unixepoch(expires_at)>unixepoch(CURRENT_TIMESTAMP)").bind(tokenHash).first<{ id: string; creator_id: string; invited_email: string }>();
  if (!invitation || invitation.invited_email.toLowerCase() !== identity.email) throw new Error("This invitation is not for the signed-in Access identity.");
  await DB.batch([
    DB.prepare("INSERT OR IGNORE INTO users (email,display_name,status) VALUES (?,?, 'active')").bind(identity.email, identity.email),
    DB.prepare("UPDATE creator_invitations SET status='accepted',accepted_at=CURRENT_TIMESTAMP,accepted_by=? WHERE id=? AND status='pending' AND unixepoch(expires_at)>unixepoch(CURRENT_TIMESTAMP)").bind(identity.email, invitation.id),
    DB.prepare("INSERT INTO creator_memberships (creator_id,user_email,role,status) SELECT ?,?,'creator','active' WHERE EXISTS (SELECT 1 FROM creator_invitations WHERE id=? AND status='accepted')").bind(invitation.creator_id, identity.email, invitation.id),
    DB.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), invitation.creator_id, identity.email, "creator", "creator_invitation_accepted", invitation.id, JSON.stringify({ metadataOnly: true })),
  ]);
  redirect("/onboarding");
}

export async function registerBrowserProfileAction(creatorId: string, formData: FormData) {
  const context = await requireCreatorContext("manage_identity", creatorId);
  const label = String(formData.get("label") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const installationId = String(formData.get("installationId") ?? "").trim().toLowerCase();
  if (label.length < 2) throw new Error("Enter a recognisable Chrome profile label.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)) throw new Error("Paste the installation ID shown by this Chrome profile’s THOT OS extension.");
  const id = crypto.randomUUID();
  const { DB } = cloudflareEnv();
  const actor = humanAuditActor(context);
  await DB.batch([
    DB.prepare("INSERT INTO browser_profiles (id,creator_id,label,created_by,installation_id) VALUES (?,?,?,?,?)").bind(id, context.creator.creator_id, label, context.email, installationId),
    identityAuditStatement(DB, actor, "browser_profile_registered", id, { label, installationIdSuffix: installationId.slice(-6), administrativeAction: true }),
  ]);
  revalidatePath("/creators");
}

export async function assignBrowserProfileAction(creatorId: string, formData: FormData) {
  const context = await requireCreatorContext("manage_identity", creatorId);
  const accountId = String(formData.get("accountId") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const { DB } = cloudflareEnv();
  const [account, profile] = await Promise.all([
    DB.prepare("SELECT id,platform FROM operational_accounts WHERE id=? AND creator_id=?").bind(accountId, context.creator.creator_id).first<{ id: string; platform: string }>(),
    DB.prepare("SELECT id FROM browser_profiles WHERE id=? AND creator_id=? AND status<>'revoked'").bind(profileId, context.creator.creator_id).first<{ id: string }>(),
  ]);
  if (!account || !profile) throw new Error("Choose an available account and Chrome profile.");
  const actor = humanAuditActor(context);
  await DB.batch([
    DB.prepare(`INSERT INTO account_browser_profiles (creator_id,account_id,platform,profile_id,assigned_by)
      VALUES (?,?,?,?,?) ON CONFLICT(creator_id,account_id) DO UPDATE SET profile_id=excluded.profile_id,assigned_by=excluded.assigned_by,assigned_at=CURRENT_TIMESTAMP,verified_at=NULL`)
      .bind(context.creator.creator_id, account.id, account.platform, profile.id, context.email),
    identityAuditStatement(DB, actor, "browser_profile_assigned", account.id, { profileId: profile.id, platform: account.platform, administrativeAction: true }),
  ]);
  revalidatePath("/creators");
}

export async function revokeBridgeCredentialsAction(creatorId: string, formData: FormData) {
  requireConfirmation(formData, "revoke-bridge");
  const context = await requireCreatorContext("manage_identity", creatorId);
  const accountId = String(formData.get("accountId") ?? "");
  const { DB } = cloudflareEnv();
  const account = await DB.prepare("SELECT id,platform FROM operational_accounts WHERE id=? AND creator_id=?").bind(accountId, context.creator.creator_id).first<{ id: string; platform: string }>();
  if (!account) throw new Error("That account is outside this creator workspace.");
  const actor = humanAuditActor(context);
  await DB.batch([
    DB.prepare("UPDATE bridge_credentials SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE creator_id=? AND account_id=? AND status='active'").bind(context.creator.creator_id, account.id),
    identityAuditStatement(DB, actor, "bridge_credentials_revoked", account.id, { platform: account.platform, confirmed: true, administrativeAction: true }),
  ]);
  revalidatePath("/creators");
}

export async function saveCreatorMembershipAction(creatorId: string, formData: FormData) {
  const context = await requireCreatorContext("manage_identity", creatorId);
  const email = membershipEmail(formData.get("email"));
  const displayName = String(formData.get("displayName") ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || email;
  const role = String(formData.get("role") ?? "") as CreatorRole;
  if (!membershipRoles.has(role)) throw new Error("Choose a valid creator role.");
  const { DB } = cloudflareEnv();
  const conflicting = await DB.prepare(`SELECT creator_id,role FROM creator_memberships
    WHERE lower(user_email)=? AND status='active' AND creator_id<>? AND (role='creator' OR ?='creator') LIMIT 1`)
    .bind(email, context.creator.creator_id, role).first<{ creator_id: string; role: CreatorRole }>();
  if (conflicting) throw new Error("Creator-only identities cannot be combined with another active workspace or agency role.");
  const existingUser = await DB.prepare("SELECT status FROM users WHERE lower(email)=?").bind(email).first<{ status: string }>();
  if (existingUser?.status === "suspended") throw new Error("This user is globally suspended. A creator workspace cannot reactivate them.");
  const actor = humanAuditActor(context);
  await DB.batch([
    DB.prepare("INSERT OR IGNORE INTO users (email,display_name,status) VALUES (?,?,'active')").bind(email, displayName),
    DB.prepare(`INSERT INTO creator_memberships (creator_id,user_email,role,status) VALUES (?,?,?,'active')
      ON CONFLICT(creator_id,user_email) DO UPDATE SET role=excluded.role,status='active',updated_at=CURRENT_TIMESTAMP`).bind(context.creator.creator_id, email, role),
    identityAuditStatement(DB, actor, "creator_membership_saved", email, { role, administrativeAction: true }),
  ]);
  revalidatePath("/creators");
}

export async function suspendCreatorMembershipAction(creatorId: string, formData: FormData) {
  requireConfirmation(formData, "suspend-membership");
  const context = await requireCreatorContext("manage_identity", creatorId);
  const email = membershipEmail(formData.get("email"));
  if (email === context.email) throw new Error("Switch to another agency administrator before suspending your own membership.");
  const { DB } = cloudflareEnv();
  const membership = await DB.prepare("SELECT role FROM creator_memberships WHERE creator_id=? AND lower(user_email)=? AND status='active'")
    .bind(context.creator.creator_id, email).first<{ role: CreatorRole }>();
  if (!membership) throw new Error("That active membership does not exist in this workspace.");
  const actor = humanAuditActor(context);
  await DB.batch([
    DB.prepare("UPDATE creator_memberships SET status='suspended',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND lower(user_email)=?").bind(context.creator.creator_id, email),
    identityAuditStatement(DB, actor, "creator_membership_suspended", email, { role: membership.role, confirmed: true, administrativeAction: true }),
  ]);
  revalidatePath("/creators");
}
