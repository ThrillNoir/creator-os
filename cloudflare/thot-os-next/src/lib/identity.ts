import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireAccessIdentity } from "./access";
import { authorizeCreatorScope, selectCreatorMembership } from "./authorization";
import type { CreatorMembership, CreatorPermission } from "./authorization";
import { cloudflareEnv } from "./cloudflare";

export type { CreatorRole, CreatorPermission, CreatorMembership } from "./authorization";

export async function getCreatorIdentity() {
  const identity = await requireAccessIdentity();
  const email = identity.email.toLowerCase();
  const memberships = (await cloudflareEnv().DB.prepare(`
    SELECT m.creator_id,c.name AS creator_name,c.initials AS creator_initials,m.role
    FROM creator_memberships m JOIN creators c ON c.id=m.creator_id
    JOIN users u ON lower(u.email)=lower(m.user_email)
    WHERE lower(m.user_email)=? AND m.status='active' AND u.status='active' AND c.status='active'
    ORDER BY c.name
  `).bind(email).all<CreatorMembership>()).results;
  if (!memberships.length) notFound();
  return { email, memberships };
}

export async function getCreatorContext(requestedCreatorId?: string | null) {
  const identity = await getCreatorIdentity();
  const cookieCreatorId = (await cookies()).get("thot_os_creator")?.value;
  const membership = selectCreatorMembership(identity.memberships, requestedCreatorId, cookieCreatorId);
  if (!membership) return null;
  return { ...identity, creator: membership };
}

export async function requireCreatorContext(permission: CreatorPermission = "view", requestedCreatorId?: string | null) {
  const identity = await getCreatorIdentity();
  const cookieCreatorId = (await cookies()).get("thot_os_creator")?.value;
  const decision = authorizeCreatorScope(identity.memberships, permission, requestedCreatorId, cookieCreatorId);
  if (!decision.ok) notFound();
  return { ...identity, creator: decision.membership };
}

export { creatorRoleLabel, roleCan } from "./authorization";
