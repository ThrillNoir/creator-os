# Shared layouts

The root layout authenticates every route. AppShell selects an agency or creator portal shell; AppNavigation renders the fixed desktop sidebar and mobile sheet navigation.

### `cloudflare/thot-os-next/src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { verifyAccessIdentity } from "@/lib/access";
import "./globals.css";
import "./boldkit-cloud.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "THOT OS", description: "Private creator operations workspace" };
export const viewport: Viewport = { colorScheme: "dark light", themeColor: "#1d161a", width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await verifyAccessIdentity();
  return <html className={`${geistSans.variable} ${geistMono.variable} dark`} lang="en" suppressHydrationWarning><body>{children}</body></html>;
}

```


### `cloudflare/thot-os-next/src/components/app-shell.tsx`

```tsx
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

```


### `cloudflare/thot-os-next/src/components/app-navigation.tsx`

```tsx
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
  mode: "agency" | "creator" | "viewer";
  navigationLabel?: string;
  portalLabel?: string;
  roleLabel: string;
  signedInLabel?: string;
  creatorWorkspaceLabel?: string;
  fixedScopeNote?: string;
  switchCreatorAction?: (formData: FormData) => Promise<void>;
};

function NavigationLinks({ active, items, mobile = false }: { active: string; items: readonly NavigationItem[]; mobile?: boolean }) {
  return (
    <nav aria-label="Workspace navigation" className="os-cloud-nav">
      {items.map(([icon, label, href]) => {
        const Icon = iconMap[icon] ?? BadgeCheck;
        const link = (
          <Link aria-current={active === label ? "page" : undefined} className={`os-cloud-nav-item ${active === label ? "active" : ""}`} href={href}>
            <Icon aria-hidden={true} className="os-cloud-nav-icon" />
            <span>{label}</span>
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
      <NavigationLinks active={props.active} items={props.items} mobile={mobile} />
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

```
