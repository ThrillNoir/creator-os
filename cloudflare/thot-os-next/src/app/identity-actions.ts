"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { requireCreatorContext, getCreatorIdentity } from "@/lib/identity";
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

export async function switchCreatorAction(formData: FormData) {
  const identity = await getCreatorIdentity();
  const creatorId = String(formData.get("creatorId") ?? "");
  const membership = identity.memberships.find((item) => item.creator_id === creatorId && item.role === "agency_admin");
  if (!membership) throw new Error("Only an agency administrator can switch to that creator workspace.");
  const { DB } = cloudflareEnv();
  await identityAuditStatement(DB, humanAuditActor({ email: identity.email, creator: membership }), "creator_workspace_selected", creatorId, { administrativeAction: true }).run();
  const localBypass = (cloudflareEnv() as CloudflareEnv & { LOCAL_ACCESS_BYPASS?: string }).LOCAL_ACCESS_BYPASS;
  (await cookies()).set("thot_os_creator", creatorId, { httpOnly: true, sameSite: "lax", secure: localBypass !== "1", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
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
