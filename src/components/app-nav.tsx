import Link from "next/link";
import { CreatorSwitcher } from "@/components/creator-switcher";
import { getActiveCreator } from "@/lib/current-creator";
import { getCreators } from "@/lib/db";

const groups = [
  { label: "COMMAND", items: [["⌂", "Overview", "/"], ["✉", "Messages", "/messages"], ["▦", "Content library", "/library"], ["⬆", "Vault uploads", "/vault"], ["✓", "Approvals", "/approvals"], ["◷", "Schedule", "/schedule"]] },
  { label: "CREATOR", items: [["◇", "Creators", "/creators"], ["◎", "Accounts & connections", "/accounts"], ["♙", "People & tags", "/people"], ["♬", "Creator voice", "/voice"]] },
  { label: "OPERATIONS", items: [["◎", "Operations", "/operations"], ["⚙", "Automation", "/automation"], ["⇧", "API publishing", "/publishing"], ["R", "Reddit operations", "/reddit"], ["⌕", "Research", "/research"], ["↗", "Reporting", "/reporting"], ["▥", "Analytics", "/analytics"], ["◌", "Activity", "/activity"], ["✦", "Agent control", "/agents"]] },
];

export async function AppNav({ active }: { active: string }) {
  const activeCreator = await getActiveCreator();
  const creators = getCreators();
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <div className="brand-mark">C</div>
        <div><strong>THOT OS</strong><span>Private agency workspace</span></div>
      </Link>
      <nav>
        {groups.map((group) => <div className="nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {group.items.map(([icon, label, href]) => (
            <Link className={`nav-item ${active === label ? "active" : ""}`} href={href} key={label}>
              <span className="nav-icon">{icon}</span><span>{label}</span>
            </Link>
          ))}
        </div>)}
      </nav>
      <div className="creator-card">
        <div className="avatar" style={{ background: activeCreator.accent }}>{activeCreator.initials}</div>
        <CreatorSwitcher activeCreatorId={activeCreator.id} creators={creators} />
      </div>
    </aside>
  );
}
