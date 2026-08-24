import Link from "next/link";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, FileWarning, Layers3, RadioTower, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = "warning" | "success" | "accent" | "destructive" | "info" | "outline";

const statusVariants: Record<string, BadgeVariant> = {
  healthy: "success",
  needs_love: "warning",
  needs_attention: "warning",
  blocked: "destructive",
  awaiting_publish_approval: "warning",
  approved_for_execution: "accent",
  completed: "success",
  failed: "destructive",
  dispatch_failed: "destructive",
  dispatching: "info",
  running: "info",
  queued: "info",
  created: "outline",
  awaiting_approval: "warning",
  needs_review: "warning",
  recorded: "outline",
  sent: "success",
  approved: "success",
};

const healthLabels: Record<string, string> = {
  healthy: "Ready",
  needs_love: "Needs content",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

export function formatControlStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function ControlStatusBadge({ status, className, label }: { status: string; className?: string; label?: string }) {
  return <Badge className={cn("shadow-none", className)} variant={statusVariants[status] ?? "outline"}>{label ?? formatControlStatus(status)}</Badge>;
}

export function OperationalHealthBadge({ health }: { health: string }) {
  return <ControlStatusBadge label={healthLabels[health] ?? formatControlStatus(health)} status={health} />;
}

export function ExecutionModeBadge({ mode }: { mode: string }) {
  const live = mode === "live";
  return <Badge className="shadow-none" variant={live ? "destructive" : "outline"}>{live ? "Live intent" : "Validation only"}</Badge>;
}

export function ControlNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" | "danger" }) {
  const Icon = tone === "danger" ? CircleX : tone === "warning" ? CircleAlert : tone === "success" ? CircleCheck : RadioTower;
  return <div className={`control-notice control-notice-${tone}`} role={tone === "danger" ? "alert" : "status"}><Icon aria-hidden="true" /><div>{children}</div></div>;
}

export function ControlEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="control-empty-state" role="status"><FileWarning aria-hidden="true" /><div><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

export function ControlPanelHeading({ eyebrow, title, description, action, id }: { eyebrow?: string; title: string; description?: string; action?: ReactNode; id?: string }) {
  return <div className="control-panel-heading"><div>{eyebrow ? <p>{eyebrow}</p> : null}<h2 id={id}>{title}</h2>{description ? <span>{description}</span> : null}</div>{action}</div>;
}

export function ControlTabs({ items, label }: { items: Array<{ href: string; label: string; active?: boolean }>; label: string }) {
  return <nav aria-label={label} className="control-tabs">{items.map((item) => <Link aria-current={item.active ? "page" : undefined} className={item.active ? "active" : undefined} href={item.href} key={item.href}>{item.label}</Link>)}</nav>;
}

export function ControlMetric({ icon: Icon = Layers3, label, value, detail, tone = "neutral" }: { icon?: LucideIcon; label: string; value: number | string; detail?: string; tone?: "neutral" | "warning" | "success" | "accent" | "danger" | "info" }) {
  return <article className={`control-metric control-metric-${tone}`}><Icon aria-hidden="true" /><div><strong>{value}</strong><span>{label}</span>{detail ? <small>{detail}</small> : null}</div></article>;
}
