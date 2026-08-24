"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  CheckSquare,
  ChevronRight,
  CircleUserRound,
  FolderOpen,
  HeartHandshake,
  House,
  Layers3,
  Menu,
  MessageSquareText,
  RadioTower,
  Rocket,
  Search,
  Send,
  Settings2,
  Sparkles,
  Upload,
  UsersRound,
  WandSparkles,
  type LucideProps,
} from "lucide-react";
import { CreatorSwitcher } from "@/components/creator-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

type CreatorOption = {
  id: string;
  name: string;
  initials: string;
  accent: string;
  status: string;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
};

const groups: { label: string; items: NavigationItem[] }[] = [
  {
    label: "Command",
    items: [
      { icon: House, label: "Overview", href: "/" },
      { icon: MessageSquareText, label: "Messages", href: "/messages" },
      { icon: FolderOpen, label: "Content library", href: "/library" },
      { icon: Upload, label: "Vault uploads", href: "/vault" },
      { icon: CheckSquare, label: "Approvals", href: "/approvals" },
      { icon: CalendarClock, label: "Schedule", href: "/schedule" },
    ],
  },
  {
    label: "Creator",
    items: [
      { icon: UsersRound, label: "Creators", href: "/creators" },
      { icon: CircleUserRound, label: "Accounts & connections", href: "/accounts" },
      { icon: HeartHandshake, label: "People & tags", href: "/people" },
      { icon: WandSparkles, label: "Creator voice", href: "/voice" },
    ],
  },
  {
    label: "Operations",
    items: [
      { icon: Layers3, label: "Operations", href: "/operations" },
      { icon: Settings2, label: "Automation", href: "/automation" },
      { icon: Send, label: "API publishing", href: "/publishing" },
      { icon: Rocket, label: "Reddit operations", href: "/reddit" },
      { icon: Search, label: "Research", href: "/research" },
      { icon: BarChart3, label: "Reporting", href: "/reporting" },
      { icon: RadioTower, label: "Analytics", href: "/analytics" },
      { icon: Activity, label: "Activity", href: "/activity" },
      { icon: Bot, label: "Agent control", href: "/agents" },
    ],
  },
];

function Brand() {
  return (
    <Link className="os-brand" href="/">
      <span className="os-brand-mark" aria-hidden="true"><Sparkles /></span>
      <span><strong>THOT OS</strong><small>Private agency workspace</small></span>
    </Link>
  );
}

function NavigationLinks({ active, mobile = false }: { active: string; mobile?: boolean }) {
  return (
    <nav className={mobile ? "os-mobile-nav-links" : "os-nav-links"} aria-label="Primary navigation">
      {groups.map((group) => (
        <div className="os-nav-group" key={group.label}>
          <p>{group.label}</p>
          {group.items.map(({ href, icon: Icon, label }) => (
            <Link className={active === label ? "active" : ""} href={href} key={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {mobile ? <ChevronRight className="os-mobile-nav-chevron" aria-hidden="true" /> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppNavigation({ active, activeCreator, creators }: { active: string; activeCreator: CreatorOption; creators: CreatorOption[] }) {
  return (
    <>
      <aside className="os-sidebar">
        <Brand />
        <NavigationLinks active={active} />
        <div className="os-sidebar-footer">
          <CreatorSwitcher activeCreatorId={activeCreator.id} creators={creators} />
          <ThemeToggle />
        </div>
      </aside>

      <header className="os-mobile-bar">
        <Link className="os-mobile-brand" href="/"><Sparkles aria-hidden="true" /><span>THOT OS</span></Link>
        <div>
          <ThemeToggle />
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="secondary" size="icon" aria-label="Open navigation">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="os-mobile-sheet">
              <SheetHeader>
                <SheetTitle>Navigate THOT OS</SheetTitle>
                <SheetDescription>Move between creator-scoped workspaces.</SheetDescription>
              </SheetHeader>
              <Separator className="my-5" />
              <NavigationLinks active={active} mobile />
              <div className="os-mobile-creator">
                <CreatorSwitcher activeCreatorId={activeCreator.id} creators={creators} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
    </>
  );
}
