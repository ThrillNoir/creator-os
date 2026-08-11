import Link from "next/link";
import type { ReactNode } from "react";
import { requireCreatorContext } from "@/lib/identity";
import { switchCreatorAction } from "@/app/identity-actions";

const available = [
  ["⌂", "Overview", "/"],
  ["▦", "Content library", "/library"],
  ["▣", "Operations", "/operations"],
  ["✦", "Messages", "/messages"],
  ["◇", "Creators", "/creators"],
] as const;

export async function AppShell({ active, children }: { active: string; children: ReactNode }) {
  const identity = await requireCreatorContext();
  return <main className="shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">T</span><span><strong>THOT OS</strong><small>Private agency workspace</small></span></Link>
      <p className="nav-label">WORKSPACE</p>
      <nav>{available.map(([icon, label, href]) => <Link className={`nav-item ${active === label ? "active" : ""}`} href={href} key={label}><b>{icon}</b>{label}</Link>)}</nav>
      <Link className={`migration-card ${active === "Migration" ? "active" : ""}`} href="/migration"><span><b>Migration progress</b><small>View the rollout plan</small></span><strong>6 live</strong></Link>
      <form className="creator-card creator-picker" action={switchCreatorAction}>
        <span>{identity.creator.creator_initials}</span><label><small>Active creator · {identity.creator.role}</small>
          {identity.creator.role === "agency_admin" ? <select name="creatorId" defaultValue={identity.creator.creator_id} aria-label="Active creator">
            {identity.memberships.filter((membership) => membership.role === "agency_admin").map((membership) => <option key={membership.creator_id} value={membership.creator_id}>{membership.creator_name}</option>)}
          </select> : <strong>{identity.creator.creator_name}</strong>}</label>{identity.creator.role === "agency_admin" && <button type="submit">Switch</button>}
      </form>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}

export function PageHeader({ title, subtitle, eyebrow = "CREATOR WORKSPACE" }: { title: string; subtitle: string; eyebrow?: string }) {
  return <header className="top"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><span className="stage">PRIVATE</span></header>;
}
