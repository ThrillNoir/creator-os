import Link from "next/link";
import type { ReactNode } from "react";
import { requireCreatorContext } from "@/lib/identity";
import { switchCreatorAction } from "@/app/identity-actions";
import { creatorRoleLabel, isAgencyStaffRole, isCreatorPortalRole, selectableWorkspaceMemberships } from "@/lib/authorization";

const agencyNavigation = [
  ["⌂", "Overview", "/"],
  ["▦", "Content library", "/library"],
  ["◎", "Accounts & connections", "/accounts"],
  ["▣", "Operations", "/operations"],
  ["⌁", "Growth insights", "/growth"],
  ["↗", "Public profile", "/public-profile"],
  ["✦", "Messages", "/messages"],
  ["$", "Money & health", "/money"],
  ["◇", "Creators", "/creators"],
] as const;

const creatorNavigation = [
  ["⌂", "Overview", "/"],
  ["▦", "Content library", "/library"],
  ["◎", "Accounts & connections", "/accounts"],
  ["▣", "Operations", "/operations"],
  ["⌁", "Growth insights", "/growth"],
  ["↗", "Public profile", "/public-profile"],
  ["✦", "Messages", "/messages"],
  ["$", "Money & health", "/money"],
] as const;

const viewerNavigation = creatorNavigation.slice(0, 2);

function Navigation({ active, items }: { active: string; items: readonly (readonly [string, string, string])[] }) {
  return <nav>{items.map(([icon, label, href]) => <Link className={`nav-item ${active === label ? "active" : ""}`} href={href} key={label}><b>{icon}</b>{label}</Link>)}</nav>;
}

function AgencyShell({ active, children, identity, roleLabel }: { active: string; children: ReactNode; identity: Awaited<ReturnType<typeof requireCreatorContext>>; roleLabel: string }) {
  return <main className="shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">T</span><span><strong>THOT OS</strong><small>Private agency workspace</small></span></Link>
      <p className="nav-label">WORKSPACE</p>
      <Navigation active={active} items={agencyNavigation} />
      <Link className={`migration-card ${active === "Migration" ? "active" : ""}`} href="/migration"><span><b>Migration progress</b><small>View the rollout plan</small></span><strong>6 live</strong></Link>
      <section className="signed-in-card" aria-label="Signed-in identity">
        <small>Signed in</small><strong>{identity.email}</strong><span>{roleLabel}</span>
      </section>
      <form className="creator-card creator-picker" action={switchCreatorAction}>
        <span>{identity.creator.creator_initials}</span><label><small>Selected creator workspace</small>
          {isAgencyStaffRole(identity.creator.role) ? <select name="creatorId" defaultValue={identity.creator.creator_id} aria-label="Active creator">
            {selectableWorkspaceMemberships(identity.memberships).map((membership) => <option key={membership.creator_id} value={membership.creator_id}>{membership.creator_name}</option>)}
          </select> : <strong>{identity.creator.creator_name}</strong>}</label>{isAgencyStaffRole(identity.creator.role) && <button type="submit">Switch workspace</button>}
        <small className="creator-scope-note">You remain signed in as {roleLabel}; switching never impersonates the creator.</small>
      </form>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}

function CreatorPortalShell({ active, children, identity, roleLabel }: { active: string; children: ReactNode; identity: Awaited<ReturnType<typeof requireCreatorContext>>; roleLabel: string }) {
  const navigation = identity.creator.role === "viewer" ? viewerNavigation : creatorNavigation;
  return <main className="shell creator-portal-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">T</span><span><strong>THOT OS</strong><small>Creator portal</small></span></Link>
      <p className="nav-label">MY WORKSPACE</p>
      <Navigation active={active} items={navigation} />
      <section className="signed-in-card" aria-label="Signed-in identity">
        <small>Signed in</small><strong>{identity.email}</strong><span>{roleLabel}</span>
      </section>
      <section className="creator-card creator-portal-card" aria-label="Authorized creator workspace">
        <span>{identity.creator.creator_initials}</span><div><small>Creator workspace</small><strong>{identity.creator.creator_name}</strong></div>
        <small className="creator-scope-note">Your workspace is fixed by your active THOT OS membership.</small>
      </section>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}

export async function AppShell({ active, children, creatorId }: { active: string; children: ReactNode; creatorId?: string }) {
  const identity = await requireCreatorContext("view", creatorId);
  const roleLabel = creatorRoleLabel(identity.creator.role);
  if (isCreatorPortalRole(identity.creator.role)) return <CreatorPortalShell active={active} identity={identity} roleLabel={roleLabel}>{children}</CreatorPortalShell>;
  return <AgencyShell active={active} identity={identity} roleLabel={roleLabel}>{children}</AgencyShell>;
}

export function PageHeader({ title, subtitle, eyebrow = "CREATOR WORKSPACE" }: { title: string; subtitle: string; eyebrow?: string }) {
  return <header className="top"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><span className="stage">PRIVATE</span></header>;
}
