export type CreatorRole = "agency_admin" | "operator" | "creator" | "viewer";
export type CreatorPermission = "view" | "mutate" | "approve" | "manage_identity";
export type CreatorMembership = {
  creator_id: string;
  creator_name: string;
  creator_initials: string;
  role: CreatorRole;
};

const permissions: Record<CreatorRole, ReadonlySet<CreatorPermission>> = {
  agency_admin: new Set(["view", "mutate", "approve", "manage_identity"]),
  operator: new Set(["view", "mutate", "approve"]),
  creator: new Set(["view", "mutate", "approve"]),
  viewer: new Set(["view"]),
};

export function selectCreatorMembership(
  memberships: readonly CreatorMembership[],
  requestedCreatorId?: string | null,
  cookieCreatorId?: string | null,
) {
  const creatorMemberships = memberships.filter((item) => item.role === "creator");
  const lockedCreatorId = creatorMemberships.length ? creatorMemberships[0].creator_id : null;
  const desiredCreatorId = requestedCreatorId || lockedCreatorId || cookieCreatorId || memberships[0]?.creator_id;
  const membership = memberships.find((item) => item.creator_id === desiredCreatorId);
  if (!membership || (lockedCreatorId && membership.creator_id !== lockedCreatorId)) return null;
  return membership;
}

export function roleCan(role: CreatorRole, permission: CreatorPermission) {
  return permissions[role].has(permission);
}

export function authorizeCreatorScope(
  memberships: readonly CreatorMembership[],
  permission: CreatorPermission,
  requestedCreatorId?: string | null,
  cookieCreatorId?: string | null,
) {
  const membership = selectCreatorMembership(memberships, requestedCreatorId, cookieCreatorId);
  if (!membership || !roleCan(membership.role, permission)) return { ok: false as const, status: 404 as const };
  return { ok: true as const, status: 200 as const, membership };
}
