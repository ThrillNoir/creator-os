"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import {
  BadgeCheck,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  FolderOpen,
  House,
  Layers3,
  Menu,
  MessageSquareText,
  PlugZap,
  Rocket,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type IconComponent = ComponentType<{ "aria-hidden"?: boolean; className?: string }>;

const iconMap: Record<string, IconComponent> = {
  accounts: PlugZap,
  access: BadgeCheck,
  adult: ShieldAlert,
  clients: UsersRound,
  creators: UsersRound,
  growth: TrendingUp,
  home: House,
  launch: Rocket,
  library: FolderOpen,
  messages: MessageSquareText,
  money: CircleDollarSign,
  operations: Layers3,
  profile: ExternalLink,
};

export type NavigationItem = readonly [icon: string, label: string, href: string];
export type CreatorOption = { id: string; name: string };

type AppNavigationProps = {
  activeCreatorId: string;
  active: string;
  creatorInitials: string;
  creatorName: string;
  creatorOptions?: CreatorOption[];
  email: string;
  items: readonly NavigationItem[];
  navigationNotices?: Record<string, number>;
  mode: "agency" | "creator" | "viewer";
  navigationLabel?: string;
  portalLabel?: string;
  roleLabel: string;
  signedInLabel?: string;
  creatorWorkspaceLabel?: string;
  fixedScopeNote?: string;
  switchCreatorAction?: (formData: FormData) => Promise<void>;
};

function NavigationLinks({ active, items, mobile = false, notices = {} }: { active: string; items: readonly NavigationItem[]; mobile?: boolean; notices?: Record<string, number> }) {
  return (
    <nav aria-label="Workspace navigation" className="os-cloud-nav">
      {items.map(([icon, label, href]) => {
        const Icon = iconMap[icon] ?? BadgeCheck;
        const link = (
          <Link aria-current={active === label ? "page" : undefined} className={`os-cloud-nav-item ${active === label ? "active" : ""}`} href={href}>
            <Icon aria-hidden={true} className="os-cloud-nav-icon" />
            <span className="os-cloud-nav-text">{label}{notices[label] ? <b aria-label={`${notices[label]} waiting`}>{notices[label]}</b> : null}</span>
            <ChevronRight aria-hidden="true" className="os-cloud-nav-arrow" />
          </Link>
        );
        return mobile ? <SheetClose asChild key={label}>{link}</SheetClose> : <span className="os-cloud-nav-row" key={label}>{link}</span>;
      })}
    </nav>
  );
}

function SubmitLabel() {
  const { pending } = useFormStatus();
  return <>{pending ? "Switching…" : "Switch workspace"}</>;
}

function CreatorContext({ idPrefix, props }: { idPrefix: string; props: AppNavigationProps }) {
  const canSwitch = Boolean(props.switchCreatorAction && props.creatorOptions?.length);

  return (
    <div className="os-cloud-context">
      <section aria-label="Signed-in identity" className="os-cloud-identity">
        <small>{props.signedInLabel ?? "Signed in"}</small>
        <strong>{props.email}</strong>
        <span>{props.roleLabel}</span>
      </section>
      {canSwitch ? (
        <form action={props.switchCreatorAction} className="os-cloud-creator-card">
          <span aria-hidden="true" className="os-cloud-avatar">{props.creatorInitials}</span>
          <label htmlFor={`${idPrefix}-creator`}>
            <small>Selected creator workspace</small>
            <select defaultValue={props.activeCreatorId} id={`${idPrefix}-creator`} name="creatorId">
              {props.creatorOptions?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <Button className="os-cloud-switch" size="xs" type="submit" variant="secondary"><SubmitLabel /></Button>
          <small className="os-cloud-scope-note">You remain signed in as {props.roleLabel}; switching never impersonates the creator.</small>
        </form>
      ) : (
        <section aria-label="Authorized creator workspace" className="os-cloud-creator-card">
          <span aria-hidden="true" className="os-cloud-avatar">{props.creatorInitials}</span>
          <div><small>{props.creatorWorkspaceLabel ?? "Creator workspace"}</small><strong>{props.creatorName}</strong></div>
          <small className="os-cloud-scope-note">{props.fixedScopeNote ?? "Your workspace is fixed by your active THOT OS membership."}</small>
        </section>
      )}
    </div>
  );
}

function Brand({ mode, portalLabel }: { mode: AppNavigationProps["mode"]; portalLabel?: string }) {
  return (
    <Link aria-label="THOT OS overview" className="os-cloud-brand" href="/">
      <span aria-hidden="true" className="os-cloud-brand-mark"><Sparkles /></span>
      <span><strong>THOT OS</strong><small>{mode === "agency" ? "Private agency workspace" : (portalLabel ?? "Creator portal")}</small></span>
    </Link>
  );
}

function NavigationBody({ mobile = false, props }: { mobile?: boolean; props: AppNavigationProps }) {
  return (
    <>
      <Brand mode={props.mode} portalLabel={props.portalLabel} />
      <p className="os-cloud-nav-label">{props.navigationLabel ?? (props.mode === "agency" ? "WORKSPACE" : "MY WORKSPACE")}</p>
      <NavigationLinks active={props.active} items={props.items} mobile={mobile} notices={props.navigationNotices} />
      <Separator className="os-cloud-divider" />
      <CreatorContext idPrefix={mobile ? "mobile" : "desktop"} props={props} />
    </>
  );
}

export function AppNavigation(props: AppNavigationProps) {
  return (
    <>
      <aside className="os-cloud-sidebar">
        <NavigationBody props={props} />
        <div className="os-cloud-theme"><span>Interface theme</span><ThemeToggle /></div>
      </aside>
      <header className="os-cloud-mobile-bar">
        <Brand mode={props.mode} portalLabel={props.portalLabel} />
        <div className="os-cloud-mobile-actions">
          <ThemeToggle />
          <Sheet>
            <SheetTrigger asChild>
              <Button aria-label="Open workspace menu" size="icon-sm" variant="secondary"><Menu aria-hidden="true" /></Button>
            </SheetTrigger>
            <SheetContent className="os-cloud-mobile-sheet" side="left">
              <SheetHeader className="sr-only">
                <SheetTitle>THOT OS workspace</SheetTitle>
                <SheetDescription>Navigation and active creator workspace</SheetDescription>
              </SheetHeader>
              <NavigationBody mobile props={props} />
            </SheetContent>
          </Sheet>
        </div>
      </header>
    </>
  );
}
