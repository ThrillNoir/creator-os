import { getAgentRuntimeStatuses } from "@/lib/agents/runtime";
import { runCaptionTaskAction } from "@/app/actions";
import { getAgentTasks } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const runtimes = await getAgentRuntimeStatuses();
  const creator = await getActiveCreator();
  const tasks = getAgentTasks(creator.id);

  return (
    <AppShell active="Agent control">
      <section className="workspace agent-page">
      <div className="agent-wrap">
        <Link className="back-link" href="/">← Back to dashboard</Link>
        <div className="agent-hero">
          <div>
            <span className="eyebrow">CREATOR OS CONTROL PLANE</span>
            <h1>Agent control</h1>
            <p>Plan, assign and review work for {creator.name}.</p>
          </div>
          <Link className="primary-button button-link" href="/approvals">Create from approval</Link>
        </div>

        <section className="runtime-grid">
          {runtimes.map((runtime) => (
            <article className="runtime-card" key={runtime.provider}>
              <div className={`runtime-logo ${runtime.provider}`}>
                {runtime.provider === "codex" ? "C" : "A"}
              </div>
              <div>
                <span className="runtime-state"><i /> Installed locally</span>
                <h2>{runtime.label}</h2>
                <p>{runtime.version}</p>
              </div>
              <button aria-label={`${runtime.label} options`}>•••</button>
            </article>
          ))}
        </section>

        <section className="agent-layout">
          <div className="panel">
            <div className="panel-heading">
              <div><h2>Task queue</h2><p>Every execution requires human approval</p></div>
              <button className="text-button">View history →</button>
            </div>
            <div className="task-table">
              <div className="task-row task-head"><span>Task</span><span>Owner</span><span>Status</span><span /></div>
              {tasks.map((task) => (
                <div className="task-row" key={task.id}>
                  <strong>{task.role === "research_agent" ? "Research brief" : `Caption for package #${task.post_package_id}`}{task.output && <small>{task.output}</small>}</strong>
                  <span>{task.provider} · {task.role.replaceAll("_", " ")}</span>
                  <span className={`task-status ${task.status === "failed" ? "amber" : "neutral"}`}>{task.status.replaceAll("_", " ")}</span>
                  {task.status === "awaiting_approval" ? (
                    <form action={runCaptionTaskAction}><input type="hidden" name="taskId" value={task.id} /><button>Run</button></form>
                  ) : task.post_package_id ? <Link href={`/approvals/${task.post_package_id}`}>Open</Link> : <span />}
                </div>
              ))}
              {tasks.length === 0 && <div className="mini-empty">No agent tasks queued yet.</div>}
            </div>
          </div>

          <aside className="panel permissions-panel">
            <div className="panel-heading"><div><h2>Permission boundary</h2><p>Local pilot policy</p></div></div>
            <ul>
              <li><i>✓</i><span><strong>Planning is read-only</strong>Agents can inspect indexed data and propose work.</span></li>
              <li><i>✓</i><span><strong>Execution is approved</strong>No files, posts or tasks change without sign-off.</span></li>
              <li><i>✓</i><span><strong>Publishing stays separate</strong>Agent completion never means content was posted.</span></li>
              <li><i>✓</i><span><strong>Runs are auditable</strong>Provider, prompt, output and approval are recorded.</span></li>
            </ul>
          </aside>
        </section>

        <section className="agent-note">
          <span>i</span>
          <p><strong>Connection ready and approval-gated.</strong> Clicking Run is the execution approval. Caption tasks run read-only, write only their result into the matching draft, and never publish.</p>
        </section>
      </div>
      </section>
    </AppShell>
  );
}
