import Link from "next/link";

export function AdultWorkspaceTabs({ current }: { current: "profile" | "portfolio" }) {
  return <nav aria-label="18+ workspace" className="adult-workspace-tabs">
    <Link aria-current={current === "profile" ? "page" : undefined} href="/adult-profile">18+ profile</Link>
    <Link aria-current={current === "portfolio" ? "page" : undefined} href="/portfolio">Portfolio</Link>
  </nav>;
}
