import Link from "next/link";
import { Activity, Archive, FileCheck2, Tags } from "lucide-react";

import { ControlEmptyState, ControlMetric, ControlPanelHeading, ControlStatusBadge } from "@/components/control-plane";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getCreatorActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const creator = await getActiveCreator();
  const activity = getCreatorActivity(creator.id);
  const categories = Array.from(new Set(activity.map((item) => item.category)));
  const linkedPackageCount = activity.filter((item) => Boolean(item.postPackageId)).length;

  return (
    <AppShell active="Activity"><main className="control-workspace control-activity-workspace">
      <PageHeader eyebrow="Operating memory" title="Activity timeline" description="One creator-scoped history of approvals, handoffs, publication, reminders, and measured outcomes." />
      <section className="control-metric-grid" aria-label="Activity summary">
        <ControlMetric label="Recorded events" value={activity.length} detail="Current creator history" icon={Archive} />
        <ControlMetric label="Categories" value={categories.length} detail="Derived from recorded activity" icon={Tags} tone="accent" />
        <ControlMetric label="Linked packages" value={linkedPackageCount} detail="Events connected to a content package" icon={FileCheck2} tone="info" />
        <ControlMetric label="Latest status" value={activity[0]?.status?.replaceAll("_", " ") ?? "None"} detail="Most recent recorded event" icon={Activity} tone="success" />
      </section>
      <Card><CardContent>
        <ControlPanelHeading title="Recorded activity" description={categories.length ? `Categories in this view: ${categories.join(", ")}.` : "Events appear here once a creator-scoped action is recorded."} />
        {activity.length ? <div className="control-activity-list">{activity.map((item) => <article className="control-activity-row" key={item.id}><span className={`control-activity-dot control-activity-${item.category}`} aria-hidden="true" /><time>{new Date(item.occurredAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</time><div><p>{item.category}</p><strong>{item.title}</strong><small>{item.detail}</small></div><ControlStatusBadge status={item.status} />{item.postPackageId ? <Link href={`/approvals/${item.postPackageId}`}>Package #{item.postPackageId} <span aria-hidden="true">→</span></Link> : null}</article>)}</div> : <ControlEmptyState title="No activity recorded" description="There is no creator-scoped activity to show yet." />}
      </CardContent></Card>
    </main></AppShell>
  );
}
