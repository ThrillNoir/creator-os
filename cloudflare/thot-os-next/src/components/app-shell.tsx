import type { ReactNode } from "react";
import { requireCreatorContext } from "@/lib/identity";
import { switchCreatorAction } from "@/app/identity-actions";
import { creatorRoleLabel, isAgencyStaffRole, isCreatorPortalRole, selectableWorkspaceMemberships } from "@/lib/authorization";
import { AppNavigation } from "@/components/app-navigation";
import { Badge } from "@/components/ui/badge";

const agencyNavigation = [
  ["home", "Overview", "/"],
  ["library", "Content library", "/library"],
  ["accounts", "Accounts & connections", "/accounts"],
  ["creators", "Onboarding", "/onboarding"],
  ["access", "Access", "/access"],
  ["operations", "Operations", "/operations"],
  ["growth", "Growth insights", "/growth"],
  ["launch", "Launch readiness", "/launch-readiness"],
  ["profile", "Public profile", "/public-profile"],
  ["adult", "18+ profile", "/adult-profile"],
  ["messages", "Messages", "/messages"],
  ["money", "Money & health", "/money"],
  ["creators", "Creators", "/creators"],
] as const;

const creatorNavigation = [
  ["home", "Overview", "/"],
  ["library", "Content library", "/library"],
  ["accounts", "Accounts & connections", "/accounts"],
  ["creators", "Onboarding", "/onboarding"],
  ["access", "Access", "/access"],
  ["operations", "Operations", "/operations"],
  ["growth", "Growth insights", "/growth"],
  ["profile", "Public profile", "/public-profile"],
  ["adult", "18+ profile", "/adult-profile"],
  ["messages", "Messages", "/messages"],
  ["money", "Money & health", "/money"],
] as const;

const viewerNavigation = creatorNavigation.slice(0, 2);

function AgencyShell({ active, children, identity, roleLabel }: { active: string; children: ReactNode; identity: Awaited<ReturnType<typeof requireCreatorContext>>; roleLabel: string }) {
  const creatorOptions = isAgencyStaffRole(identity.creator.role)
    ? selectableWorkspaceMemberships(identity.memberships).map((membership) => ({ id: membership.creator_id, name: membership.creator_name }))
    : undefined;
  return <div className="os-cloud-shell">
    <AppNavigation active={active} activeCreatorId={identity.creator.creator_id} creatorInitials={identity.creator.creator_initials} creatorName={identity.creator.creator_name} creatorOptions={creatorOptions} email={identity.email} items={agencyNavigation} mode="agency" navigationLabel="WORKSPACE" roleLabel={roleLabel} switchCreatorAction={switchCreatorAction} />
    <main className="workspace">{children}</main>
  </div>;
}

function CreatorPortalShell({ active, children, identity, roleLabel }: { active: string; children: ReactNode; identity: Awaited<ReturnType<typeof requireCreatorContext>>; roleLabel: string }) {
  const navigation = identity.creator.role === "viewer" ? viewerNavigation : creatorNavigation;
  return <div className="os-cloud-shell creator-portal-shell">
    <AppNavigation active={active} activeCreatorId={identity.creator.creator_id} creatorInitials={identity.creator.creator_initials} creatorName={identity.creator.creator_name} creatorWorkspaceLabel="Creator workspace" email={identity.email} fixedScopeNote="Your workspace is fixed by your active THOT OS membership." items={navigation} mode={identity.creator.role === "viewer" ? "viewer" : "creator"} portalLabel="Creator portal" roleLabel={roleLabel} signedInLabel="Signed in" />
    <main className="workspace">{children}</main>
  </div>;
}

export async function AppShell({ active, children, creatorId }: { active: string; children: ReactNode; creatorId?: string }) {
  const identity = await requireCreatorContext("view", creatorId);
  const roleLabel = creatorRoleLabel(identity.creator.role);
  if (isCreatorPortalRole(identity.creator.role)) return <CreatorPortalShell active={active} identity={identity} roleLabel={roleLabel}>{children}</CreatorPortalShell>;
  return <AgencyShell active={active} identity={identity} roleLabel={roleLabel}>{children}</AgencyShell>;
}

export function PageHeader({ title, subtitle, eyebrow = "CREATOR WORKSPACE" }: { title: string; subtitle: string; eyebrow?: string }) {
  return <header className="top"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><Badge className="stage" variant="accent">PRIVATE</Badge></header>;
}
