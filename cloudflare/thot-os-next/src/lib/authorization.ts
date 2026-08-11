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

export function isCreatorPortalRole(role: string): role is "creator" | "viewer" {
  return role === "creator" || role === "viewer";
}

export function isCreatorPortalIdentity(memberships: readonly CreatorMembership[]) {
  return memberships.some((membership) => isCreatorPortalRole(membership.role));
}

export function selectCreatorPortalMembership(
  memberships: readonly CreatorMembership[],
  requestedCreatorId?: string | null,
) {
  if (memberships.length !== 1) return null;
  const membership = memberships[0];
  if (!isCreatorPortalRole(membership.role)) return null;
  if (requestedCreatorId && requestedCreatorId !== membership.creator_id) return null;
  return membership;
}

export function selectCreatorMembership(
  memberships: readonly CreatorMembership[],
  requestedCreatorId?: string | null,
  cookieCreatorId?: string | null,
) {
  if (isCreatorPortalIdentity(memberships)) {
    // Creator-portal scope comes from the sole active membership. The workspace
    // selector cookie is deliberately not an input for creator or viewer users.
    return selectCreatorPortalMembership(memberships, requestedCreatorId);
  }
  const desiredCreatorId = requestedCreatorId || cookieCreatorId || memberships[0]?.creator_id;
  const membership = memberships.find((item) => item.creator_id === desiredCreatorId);
  if (!membership) return null;
  return membership;
}

export function roleCan(role: string, permission: CreatorPermission) {
  return permissions[role as CreatorRole]?.has(permission) ?? false;
}

export function creatorRoleLabel(role: CreatorRole) {
  return ({
    agency_admin: "Agency administrator",
    operator: "Operator",
    creator: "Creator",
    viewer: "Viewer",
  } satisfies Record<CreatorRole, string>)[role];
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
