import Link from "next/link";
import { CheckCircle2, Clock3, FileCheck2, Send } from "lucide-react";

import { approvePublicationJobAction, executePublicationJobAction } from "@/app/actions";
import { ControlEmptyState, ControlNotice, ControlPanelHeading, ControlStatusBadge, ExecutionModeBadge } from "@/components/control-plane";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getPublicationJobs } from "@/lib/db";
import { getCreatorInstagramPublishingReadiness } from "@/lib/publishing/composio-instagram";
import { getXQuikConfiguration } from "@/lib/integrations/xquik";

export const dynamic = "force-dynamic";

const executionSteps = [
  ["1", "Content approval", "Media, copy, and destination"],
  ["2", "Prepare job", "Validation or live intent"],
  ["3", "Publish approval", "Separate final confirmation"],
  ["4", "Receipt", "External result recorded"],
] as const;

export default async function PublishingPage() {
  const creator = await getActiveCreator();
  const jobs = getPublicationJobs(creator.id);
  const instagram = getCreatorInstagramPublishingReadiness(creator.id);
  const xquik = getXQuikConfiguration();

  return (
    <AppShell active="API publishing"><main className="control-workspace control-publishing-workspace">
      <PageHeader eyebrow="Guarded execution" title="API publishing" description="Connection is not publishing authority. Every live job remains separately reviewable and receipted." />

      <section className="control-execution-path" aria-label="Publishing execution path">
        {executionSteps.map(([number, title, description], index) => <div key={number}><span>{number}</span><div>{index === 0 ? <FileCheck2 aria-hidden="true" /> : index === 1 ? <Clock3 aria-hidden="true" /> : index === 2 ? <Send aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}<strong>{title}</strong><small>{description}</small></div></div>)}
      </section>

      <ControlNotice tone="warning"><strong>Live execution is a separate decision.</strong> A prepared job does not publish until final approval and a recorded execution attempt. A job is not proof of publication until a receipt is recorded.</ControlNotice>

      <Card>
        <CardContent>
          <ControlPanelHeading title="Publishing jobs" description="Idempotency keys keep one approved version from creating duplicate jobs." />
          {jobs.length ? <div className="control-job-list">{jobs.map((job) => {
            const executionReady = job.provider === "xquik_x" ? xquik.ready : instagram.ready;
            const readinessMessage = job.provider === "xquik_x"
              ? (xquik.ready ? "X execution connection is ready." : "X execution needs a configured provider connection.")
              : (instagram.ready ? "Instagram media delivery is ready." : "Instagram media delivery needs setup before execution.");
            return <article className="control-job-row" key={job.id}>
              <div className="control-job-main"><div className="control-job-heading"><Link href={`/approvals/${job.post_package_id}`}>Package #{job.post_package_id}</Link><ExecutionModeBadge mode={job.mode} /><ControlStatusBadge status={job.status} /></div><p>{job.account_label} · {job.platform} · {job.provider.replaceAll("_", " ")}</p><span className="control-mono">Key {job.idempotency_key}</span><time>{new Date(job.created_at).toLocaleString("en-AU")}</time></div>
              <div className="control-job-action">
                {job.status === "awaiting_publish_approval" ? <>
                  {job.mode === "live" ? <p className="control-job-live">Live intent: confirm this final execution deliberately.</p> : <p>Validation execution remains non-live.</p>}
                  <form action={approvePublicationJobAction}><input type="hidden" name="id" value={job.id} /><Button type="submit" variant={job.mode === "live" ? "destructive" : "outline"}>{job.mode === "live" ? "Approve live execution" : "Approve validation execution"}</Button></form>
                </> : job.status === "approved_for_execution" ? <>
                  <p>{readinessMessage}</p>
                  <form action={executePublicationJobAction}><input type="hidden" name="id" value={job.id} /><Button type="submit" disabled={!executionReady} variant={job.mode === "live" ? "destructive" : "outline"}>{job.mode === "test_private" ? "Run validation" : "Publish now"}</Button></form>
                </> : <>
                  {job.external_post_id ? <p>Receipt ID <span className="control-mono">{job.external_post_id}</span></p> : null}
                  {job.receipt ? <p>Execution receipt recorded.</p> : null}
                  {job.error ? <p className="control-job-error">{job.error}</p> : null}
                  {!job.external_post_id && !job.receipt && !job.error ? <p>{job.status.replaceAll("_", " ")}</p> : null}
                </>}
              </div>
            </article>;
          })}</div> : <ControlEmptyState title="No API publishing jobs" description="Approve a post for a connected Instagram, X, or YouTube destination to prepare the next guarded job." />}
        </CardContent>
      </Card>

      <ControlNotice tone={instagram.ready ? "success" : "warning"}><strong>{instagram.ready ? "Instagram execution is available." : "Media delivery still needs setup."}</strong> {instagram.ready ? "Validation creates a media container without publishing. Live jobs publish only after the separate final approval." : "Connect Dropbox temporary links or set a public HTTPS THOT OS media origin before Instagram can fetch local assets."}</ControlNotice>
    </main></AppShell>
  );
}
