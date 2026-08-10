import Link from "next/link";
import { approvePublicationJobAction, executePublicationJobAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { getActiveCreator } from "@/lib/current-creator";
import { getPublicationJobs } from "@/lib/db";
import { getCreatorInstagramPublishingReadiness } from "@/lib/publishing/composio-instagram";
import { getXQuikConfiguration } from "@/lib/integrations/xquik";

export const dynamic = "force-dynamic";

export default async function PublishingPage() {
  const creator = await getActiveCreator();
  const jobs = getPublicationJobs(creator.id);
  const instagram = getCreatorInstagramPublishingReadiness(creator.id);
  const xquik = getXQuikConfiguration();
  return (
    <main className="app-shell">
      <AppNav active="API publishing" />
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · GUARDED EXECUTION</span><h1>API publishing</h1><p className="page-subtitle">Connecting an account never grants blanket publishing authority.</p></div></header>
        <section className="guardrail-strip">
          <div><b>1</b><span><strong>Content approval</strong>Media, copy and destination</span></div>
          <div><b>2</b><span><strong>Prepare job</strong>Private test or live intent</span></div>
          <div><b>3</b><span><strong>Publish approval</strong>Separate final confirmation</span></div>
          <div><b>4</b><span><strong>Receipt</strong>External ID and result</span></div>
        </section>
        <section className="panel publication-table">
          <div className="panel-heading"><div><h2>Publishing jobs</h2><p>Idempotency keys prevent duplicate jobs for the same approved version.</p></div></div>
          <div className="publication-row head"><span>Package</span><span>Destination</span><span>Mode</span><span>Status</span><span>Action</span></div>
          {jobs.map((job) => (
            <div className="publication-row" key={job.id}>
              <Link href={`/approvals/${job.post_package_id}`}>#{job.post_package_id}</Link>
              <span>{job.account_label}</span>
              <span>{job.mode === "test_private" ? "Private / validation" : "Live"}</span>
              <b>{job.status.replaceAll("_", " ")}</b>
              {job.status === "awaiting_publish_approval" ? (
                <form action={approvePublicationJobAction}><input type="hidden" name="id" value={job.id} /><button>Final approve</button></form>
              ) : job.status === "approved_for_execution" ? (
                <form action={executePublicationJobAction}><input type="hidden" name="id" value={job.id} /><button disabled={job.provider === "xquik_x" ? !xquik.ready : !instagram.ready}>{job.mode === "test_private" ? "Run validation" : "Publish now"}</button></form>
              ) : (
                <span>{job.external_post_id ? `Receipt ${job.external_post_id}` : job.error || job.status.replaceAll("_", " ")}</span>
              )}
            </div>
          ))}
          {jobs.length === 0 && <div className="mini-empty">No API publishing jobs. Approve a post for a connected Instagram, X or YouTube destination first.</div>}
        </section>
        <div className="agent-note"><span>i</span><p><strong>{instagram.ready ? "Instagram execution is available." : "Media delivery still needs setup."}</strong> {instagram.ready ? "Validation creates a media container without publishing. Live jobs publish only after the separate final approval." : "Connect Dropbox temporary links or set a public HTTPS THOT OS media origin before Instagram can fetch local assets."}</p></div>
      </section>
    </main>
  );
}
