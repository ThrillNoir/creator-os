import Link from "next/link";
import type { ReactNode } from "react";

const available = [
  ["⌂", "Overview", "/"],
  ["▦", "Content library", "/library"],
  ["▣", "Operations", "/operations"],
  ["✦", "Messages", "/messages"],
  ["◇", "Creators", "/creators"],
] as const;

export function AppShell({ active, children }: { active: string; children: ReactNode }) {
  return <main className="shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">T</span><span><strong>THOT OS</strong><small>Private agency workspace</small></span></Link>
      <p className="nav-label">WORKSPACE</p>
      <nav>{available.map(([icon, label, href]) => <Link className={`nav-item ${active === label ? "active" : ""}`} href={href} key={label}><b>{icon}</b>{label}</Link>)}</nav>
      <Link className={`migration-card ${active === "Migration" ? "active" : ""}`} href="/migration"><span><b>Migration progress</b><small>View the rollout plan</small></span><strong>6 live</strong></Link>
      <div className="creator-card"><span>A</span><div><small>Active creator</small><strong>Adelaide</strong></div></div>
    </aside>
    <section className="workspace">{children}</section>
  </main>;
}

export function PageHeader({ title, subtitle, eyebrow = "ADELAIDE WORKSPACE" }: { title: string; subtitle: string; eyebrow?: string }) {
  return <header className="top"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><span className="stage">PRIVATE</span></header>;
}
