import { Activity, CircleX, Clock3, ListChecks } from "lucide-react";

import { retryAutomationEventAction } from "./actions";
import { ControlEmptyState, ControlMetric, ControlNotice, ControlPanelHeading, ControlStatusBadge } from "@/components/control-plane";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getRecentAutomationEvents, getRecentWorkflowReceipts } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatReceiptDetail(value: string) {
  const unsafeKey = /secret|token|password|authorization|credential|cookie/i;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const visible = Object.entries(parsed)
      .filter(([key]) => !unsafeKey.test(key))
      .map(([key, item]) => `${key}: ${String(item)}`);
    return visible.join(" · ") || "No additional safe detail";
  } catch {
    return value || "No additional detail";
  }
}

export default async function AutomationPage() {
  const creator = await getActiveCreator();
  const events = getRecentAutomationEvents(creator.id);
  const receipts = getRecentWorkflowReceipts(creator.id);
  const counts = {
    queued: events.filter((event) => ["created", "dispatching", "queued"].includes(event.status)).length,
    running: events.filter((event) => event.status === "running").length,
    failed: events.filter((event) => ["failed", "dispatch_failed"].includes(event.status)).length,
    completed: events.filter((event) => event.status === "completed").length,
  };

  return (
    <AppShell active="Automation"><main className="control-workspace control-automation-workspace">
      <PageHeader eyebrow="Control plane" title="Automation" description="Creator-scoped queue state, failures, and verified workflow receipts." />
      <section className="control-metric-grid" aria-label="Automation summary">
        <ControlMetric label="Queued" value={counts.queued} detail="Created, dispatching, or queued" icon={Clock3} tone="info" />
        <ControlMetric label="Running" value={counts.running} detail="Worker activity in progress" icon={Activity} tone="accent" />
        <ControlMetric label="Failed" value={counts.failed} detail="Requires a safe retry decision" icon={CircleX} tone="danger" />
        <ControlMetric label="Completed" value={counts.completed} detail="Events with a final state" icon={ListChecks} tone="success" />
      </section>
      <ControlNotice tone="warning"><strong>Retries preserve the original idempotency key.</strong> Retry is available only for failed external dispatches; it does not recreate the underlying action or bypass approval.</ControlNotice>

      <div className="control-automation-layout">
        <Card><CardContent>
          <ControlPanelHeading title="Event queue" description="Every handoff keeps its original idempotency key." action={<span className="control-count">{events.length}</span>} />
          {events.length ? <div className="control-event-list">{events.map((event) => <article className="control-event-row" key={event.id}>
            <div><p>{event.queue} · {event.source}</p><strong>{event.event_type}</strong><span className="control-mono">{event.idempotency_key}</span>{event.error ? <em>{event.error}</em> : null}</div>
            <div><time>{new Date(event.created_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</time><ControlStatusBadge status={event.status} /><small>{event.attempts} attempt{event.attempts === 1 ? "" : "s"}</small></div>
            {["failed", "dispatch_failed"].includes(event.status) ? <form action={retryAutomationEventAction}><input type="hidden" name="idempotencyKey" value={event.idempotency_key} /><Button type="submit" variant="outline">Retry dispatch</Button></form> : null}
          </article>)}</div> : <ControlEmptyState title="No automation events" description="No automation events have been created for this creator." />}
        </CardContent></Card>
        <Card><CardContent>
          <ControlPanelHeading title="Workflow receipts" description="Completion evidence from Cloudflare and local workers." action={<span className="control-count">{receipts.length}</span>} />
          {receipts.length ? <div className="control-receipt-list">{receipts.map((receipt) => <article className="control-receipt-row" key={receipt.id}><p>{receipt.workflow_type}</p><ControlStatusBadge status={receipt.status} /><small>{formatReceiptDetail(receipt.detail)}</small>{receipt.public_url ? <a href={receipt.public_url} target="_blank" rel="noreferrer">Open live result ↗</a> : null}<time>{new Date(receipt.created_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</time></article>)}</div> : <ControlEmptyState title="No workflow receipts" description="Receipts appear after a worker acknowledges an event." />}
        </CardContent></Card>
      </div>
    </main></AppShell>
  );
}
