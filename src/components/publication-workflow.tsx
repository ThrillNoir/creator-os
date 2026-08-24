import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, FileImage, Film, ImageOff, Layers3, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AssetRow, CreatorActivityItem, PostPackageRow } from "@/lib/db";
import { isPhotoAsset, mediaUrl } from "@/components/media-workflow";
import { WorkflowImage } from "@/components/workflow-image";

const statusVariants: Record<string, "warning" | "success" | "accent" | "destructive" | "outline"> = {
  draft: "outline",
  needs_approval: "warning",
  approved: "success",
  published: "accent",
  rejected: "destructive",
  sent: "success",
  failed: "destructive",
  awaiting_approval: "warning",
  recorded: "outline",
};

export function formatWorkflowStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function WorkflowStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge className={cn("shadow-none", className)} variant={statusVariants[status] ?? "outline"}>{formatWorkflowStatus(status)}</Badge>;
}

export function formatScheduledTime(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Schedule needs review";
  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WorkflowNotice({ children, variant = "info" }: { children: ReactNode; variant?: "info" | "success" | "warning" | "error" }) {
  return <div className={`workflow-notice workflow-notice-${variant}`} role={variant === "error" ? "alert" : "status"}>{children}</div>;
}

export function WorkflowEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="workflow-empty-state" role="status">
      <FileImage aria-hidden="true" />
      <div><h2>{title}</h2><p>{description}</p></div>
      {action}
    </div>
  );
}

function UnavailableMedia() {
  return <span className="workflow-media-fallback" role="img" aria-label="Source preview unavailable"><ImageOff aria-hidden="true" />Source preview unavailable</span>;
}

export function PostPackageCard({ post, priority = false }: { post: PostPackageRow; priority?: boolean }) {
  const mediaUrlForPost = mediaUrl(post.relative_path);
  const mediaLabel = post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename;

  return (
    <Link className={cn("workflow-package-card", `workflow-package-${post.status}`)} href={`/approvals/${post.id}`}>
      <div className="workflow-package-preview">
        {post.source_available ? <WorkflowImage alt="" priority={priority} sizes="(max-width: 640px) 96px, 132px" src={mediaUrlForPost} /> : <UnavailableMedia />}
        {post.asset_count > 1 ? <span><Layers3 aria-hidden="true" />{post.asset_count}</span> : null}
      </div>
      <div className="workflow-package-copy">
        <div className="workflow-package-heading"><WorkflowStatusBadge status={post.status} /><span className="font-mono">#{post.id}</span></div>
        <h2>{mediaLabel}</h2>
        <p>{post.account_label} · {post.handle}</p>
        <small>{post.creator_notes}</small>
      </div>
      <div className="workflow-package-meta">
        <span><CalendarClock aria-hidden="true" />{formatScheduledTime(post.scheduled_at)}</span>
        <ArrowRight aria-hidden="true" />
      </div>
    </Link>
  );
}

export function DestinationSummary({ post, compact = false }: { post: Pick<PostPackageRow, "account_label" | "handle" | "platform" | "asset_count" | "scheduled_at">; compact?: boolean }) {
  return (
    <div className={cn("workflow-destination-summary", compact && "workflow-destination-compact")}>
      <span className="workflow-platform-mark" aria-hidden="true">{post.platform.slice(0, 2).toUpperCase()}</span>
      <div>
        <p>Destination</p>
        <strong>{post.account_label}</strong>
        <span>{post.handle}</span>
      </div>
      {!compact ? <div className="workflow-destination-facts"><span>{post.asset_count} {post.asset_count === 1 ? "asset" : "assets"}</span><span>{formatScheduledTime(post.scheduled_at)}</span></div> : null}
    </div>
  );
}

export function WorkflowMediaGallery({ assets }: { assets: AssetRow[] }) {
  return (
    <div className={cn("workflow-media-gallery", assets.length === 1 && "workflow-media-gallery-single")} aria-label="Package media">
      {assets.map((asset, index) => (
        <figure className="workflow-gallery-item" key={asset.id}>
          {asset.source_available ? isPhotoAsset(asset) ? <WorkflowImage alt={asset.basename} priority={index === 0} sizes="(max-width: 840px) 100vw, (max-width: 1260px) 56vw, 700px" src={mediaUrl(asset.relative_path)} /> : <video controls playsInline preload="metadata" src={mediaUrl(asset.relative_path)} /> : <UnavailableMedia />}
          <figcaption>{isPhotoAsset(asset) ? <FileImage aria-hidden="true" /> : <Film aria-hidden="true" />}<span>{index + 1} of {assets.length}</span></figcaption>
        </figure>
      ))}
    </div>
  );
}

export function CaptionQualityPanel({ issues }: { issues: Array<{ code: string; severity: string; message: string }> }) {
  return (
    <section className={cn("workflow-quality-panel", issues.length ? "workflow-quality-review" : "workflow-quality-clear")} aria-labelledby="caption-quality-title">
      <div><ShieldCheck aria-hidden="true" /><div><h2 id="caption-quality-title">Caption checks</h2><p>{issues.length ? "Review these checks before making an approval decision." : "Automated checks passed. Human voice review is still required."}</p></div></div>
      <ul>
        {issues.length ? issues.map((issue) => <li className={issue.severity} key={issue.code}><CircleAlert aria-hidden="true" /><span><strong>{issue.severity}</strong>{issue.message}</span></li>) : <li><CheckCircle2 aria-hidden="true" /><span>Caption is ready for human voice review.</span></li>}
      </ul>
    </section>
  );
}

export function PackageActivity({ activity }: { activity: CreatorActivityItem[] }) {
  return (
    <Card className="workflow-activity" variant="quiet">
      <CardContent>
        <div className="workflow-section-heading"><div><p>Audit trail</p><h2>Package history</h2><span>Approval, handoff, publication, reminders, and measurement remain separate events.</span></div><Button asChild size="sm" variant="ghost"><Link href="/activity">All activity</Link></Button></div>
        <div className="workflow-activity-list">
          {activity.slice(0, 8).map((item) => <article key={item.id}>
            <time>{new Date(item.occurredAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</time>
            <div><strong>{item.title}</strong><span>{item.detail}</span></div>
            <WorkflowStatusBadge status={item.status} />
          </article>)}
          {!activity.length ? <p className="workflow-inline-empty">No package events have been recorded yet.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
