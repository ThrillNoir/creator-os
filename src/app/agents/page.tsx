import Link from "next/link";
import { Bot, CheckCircle2, FileSearch, ShieldCheck } from "lucide-react";

import { runCaptionTaskAction } from "@/app/actions";
import { ControlEmptyState, ControlNotice, ControlPanelHeading, ControlStatusBadge } from "@/components/control-plane";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAgentRuntimeStatuses } from "@/lib/agents/runtime";
import { getActiveCreator } from "@/lib/current-creator";
import { getAgentTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const runtimes = await getAgentRuntimeStatuses();
  const creator = await getActiveCreator();
  const tasks = getAgentTasks(creator.id);

  return (
    <AppShell active="Agent control"><main className="control-workspace control-agents-workspace">
      <PageHeader eyebrow="Control plane" title="Agent control" description={`Plan, assign, and review bounded work for ${creator.name}.`} actions={<Button asChild variant="outline"><Link href="/approvals">Open approval queue</Link></Button>} />
      <section className="control-runtime-grid" aria-label="Available agent runtimes">{runtimes.map((runtime) => <article className="control-runtime-card" key={runtime.provider}><div className="control-runtime-mark">{runtime.provider === "codex" ? "C" : "A"}</div><div><p><span /> Installed locally</p><h2>{runtime.label}</h2><small>{runtime.version}</small></div></article>)}</section>

      <div className="control-agent-layout">
        <Card><CardContent>
          <ControlPanelHeading title="Task queue" description="Task execution requires a human approval decision." />
          {tasks.length ? <div className="control-task-list">{tasks.map((task) => <article className="control-task-row" key={task.id}>
            <div><strong>{task.role === "research_agent" ? "Research brief" : `Caption for package #${task.post_package_id}`}</strong><p>{task.provider} · {task.role.replaceAll("_", " ")} · {task.mode}</p><time>{new Date(task.created_at).toLocaleString("en-AU")}</time>{task.output ? <pre>{task.output}</pre> : null}{task.error ? <p className="control-task-error">{task.error}</p> : null}</div>
            <div><ControlStatusBadge status={task.status} />{task.status === "awaiting_approval" ? <form action={runCaptionTaskAction}><input type="hidden" name="taskId" value={task.id} /><Button type="submit" variant="outline">Approve and run task</Button></form> : task.post_package_id ? <Button asChild variant="outline"><Link href={`/approvals/${task.post_package_id}`}>Open package</Link></Button> : null}</div>
          </article>)}</div> : <ControlEmptyState title="No agent tasks queued" description="Approved work will appear here with its provider, scope, and review state." />}
        </CardContent></Card>
        <Card><CardContent>
          <ControlPanelHeading title="Permission boundary" description="Local pilot policy" />
          <ul className="control-permission-list"><li><FileSearch aria-hidden="true" /><span><strong>Planning is read-only</strong>Agents can inspect indexed data and propose work.</span></li><li><ShieldCheck aria-hidden="true" /><span><strong>Execution is approved</strong>No files, posts, or tasks change without sign-off.</span></li><li><Bot aria-hidden="true" /><span><strong>Publishing stays separate</strong>Agent completion never means content was posted.</span></li><li><CheckCircle2 aria-hidden="true" /><span><strong>Runs are auditable</strong>Provider, prompt, output, and approval are recorded.</span></li></ul>
        </CardContent></Card>
      </div>
      <ControlNotice><strong>Connection-ready and approval-gated.</strong> Caption tasks write only their result into the matching local draft and return it to human review. Research tasks return to review; neither task type publishes content.</ControlNotice>
    </main></AppShell>
  );
}
