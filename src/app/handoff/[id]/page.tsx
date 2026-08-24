import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { markPostPublishedAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { HandoffActions } from "@/components/handoff-actions";
import { PageHeader } from "@/components/page-header";
import { DestinationSummary, WorkflowMediaGallery, WorkflowNotice, WorkflowStatusBadge } from "@/components/publication-workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPostPackage, getPostPackageAssets } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { getMyRoomzConfiguration } from "@/lib/integrations/myroomz";

export const dynamic = "force-dynamic";

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const post = getPostPackage(Number((await params).id));
  const creator = await getActiveCreator();
  if (!post || post.creator_id !== creator.id || post.status !== "approved") notFound();

  const assets = getPostPackageAssets(post.id);
  const myRoomz = getMyRoomzConfiguration();
  const media = assets.map((asset) => ({
    url: `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`,
    filename: asset.basename,
    available: asset.source_available === 1,
  }));
  const hasUnavailableMedia = media.length === 0 || media.some((asset) => !asset.available);
  const platformUrl =
    post.platform === "x"
      ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.caption)}`
      : post.platform === "myroomz" && myRoomz.ready
        ? myRoomz.uploadUrl
        : post.account_url;
  const actionLabel = post.platform === "myroomz" && myRoomz.ready ? "Open MyRoomz Vault" : `Open ${post.platform}`;

  return (
    <AppShell active="Approvals">
      <section className="workspace workflow-workspace">
        <Link className="workflow-back-link" href={`/approvals/${post.id}`}><ArrowLeft aria-hidden="true" />Back to approved package</Link>
        <PageHeader
          eyebrow={`Approved handoff #${post.id}`}
          title={post.platform === "myroomz" && myRoomz.ready ? "Send to MyRoomz Vault" : `Finish on ${post.platform}`}
          description="Use this checklist on the device where the correct destination account is already signed in. No step on this page automatically publishes the package."
          actions={<div className="workflow-page-actions"><WorkflowStatusBadge status="approved" /></div>}
        />

        <div className="workflow-handoff-layout">
          <WorkflowMediaGallery assets={assets} />
          <Card className="workflow-handoff-card">
            <div className="workflow-handoff-card-body">
              <div className="workflow-section-heading"><div><p>Approved execution checklist</p><h2>Finish in the native platform</h2><span>The exact approved package is ready to hand off. Sharing, downloading, copying, and opening the platform do not mark it published.</span></div><ClipboardCheck aria-hidden="true" /></div>
              <div className="mt-5"><DestinationSummary post={post} /></div>
              <WorkflowNotice variant="warning">Confirm the destination account before sharing media or opening the native platform. THOT OS does not inspect account login state.</WorkflowNotice>

              <div className="workflow-handoff-steps" aria-label="Handoff steps">
                <div className="workflow-handoff-step"><b>1</b><div><strong>{post.platform === "myroomz" ? "Download the approved media" : "Share or download the approved media"}</strong><span>{post.platform === "myroomz" ? "Keep the original approved file ready for the Vault uploader." : "On mobile, sharing can open the system share sheet. Choose the destination app only after confirming the correct account."}</span></div></div>
                <div className="workflow-handoff-step"><b>2</b><div><strong>Copy the approved caption</strong><span>{post.platform === "x" ? "The X composer can receive the approved text, but review the final native composer before publishing." : "Paste the approved caption into the destination’s native composer if the share sheet does not carry it across."}</span></div></div>
                <div className="workflow-handoff-step"><b>3</b><div><strong>{post.platform === "myroomz" && myRoomz.ready ? "Open the private MyRoomz Vault" : `Finish inside ${post.platform}`}</strong><span>{post.platform === "myroomz" && myRoomz.ready ? "Upload the approved files, then complete the MyRoomz workflow there." : "Choose final native settings, tags, and placement, then publish manually in the platform."}</span></div></div>
              </div>

              <div className="workflow-approved-caption-wrap"><p>Approved caption</p><div className="workflow-approved-caption">{post.caption || "No caption was included in this approved package."}</div></div>
              {hasUnavailableMedia ? <div className="mt-5"><WorkflowNotice variant="error">Approved source media is not available locally. Restore the source and refresh the read-only catalogue before sharing, downloading, or opening the destination workflow.</WorkflowNotice></div> : null}
              <HandoffActions actionLabel={actionLabel} caption={post.caption} media={media} platform={post.platform} platformUrl={platformUrl} />
            </div>
          </Card>
        </div>

        <Card className="workflow-publication-confirmation">
          <CardContent>
            <div><h2>Final human confirmation</h2><p>Only press this after you have finished posting in the native platform. It records your confirmation in THOT OS; it does not inspect or create the platform post.</p></div>
            <form action={markPostPublishedAction}><input name="id" type="hidden" value={post.id} /><input name="returnTo" type="hidden" value="schedule" /><Button type="submit" variant="destructive"><CheckCircle2 aria-hidden="true" />I finished publishing — mark published</Button></form>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
