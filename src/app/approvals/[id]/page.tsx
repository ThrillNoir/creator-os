import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, MessageCircle, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import {
  approvePostAction,
  confirmInstagramPublicationMatchAction,
  createPublicationJobAction,
  queueCaptionTaskAction,
  sendApprovedPostToTelegramAction,
  updatePostAction,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  CaptionQualityPanel,
  DestinationSummary,
  PackageActivity,
  WorkflowMediaGallery,
  WorkflowNotice,
  WorkflowStatusBadge,
} from "@/components/publication-workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  getAccounts,
  getAgentTasks,
  getCreatorActivity,
  getInstagramMatchCandidates,
  getLatestTelegramHandoff,
  getPlatformConnections,
  getPostOutcomeSnapshots,
  getPostPackage,
  getPostPackageAssets,
  getPostPackagePeople,
  getPublicationMatches,
  getRecentCaptions,
  getTelegramCreatorPairing,
  getVoiceProfile,
} from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { evaluateCaption } from "@/lib/caption-quality";

export const dynamic = "force-dynamic";

function handleForPlatform(tags: string, platform: string) {
  return tags.split(" · ").find((tag) => tag.startsWith(`${platform}:`))?.slice(platform.length + 1) || "";
}

export default async function ApprovalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ telegram?: string }> }) {
  const post = getPostPackage(Number((await params).id));
  const creator = await getActiveCreator();
  const query = await searchParams;
  if (!post || post.creator_id !== creator.id) notFound();

  const accounts = getAccounts(creator.id);
  const assets = getPostPackageAssets(post.id);
  const people = getPostPackagePeople(post.id);
  const voice = getVoiceProfile(creator.id);
  const telegramPairing = getTelegramCreatorPairing(creator.id);
  const telegramHandoff = getLatestTelegramHandoff(creator.id, post.id);
  const publicationMatch = getPublicationMatches(creator.id).find((item) => item.post_package_id === post.id);
  const matchCandidates = post.platform === "instagram" && !publicationMatch && post.status === "published" ? getInstagramMatchCandidates(creator.id, post.id) : [];
  const outcomes = getPostOutcomeSnapshots(creator.id, post.id);
  const activity = getCreatorActivity(creator.id, post.id);
  const connection = getPlatformConnections(creator.id).find((item) =>
    item.account_id === post.account_id &&
    item.provider === (post.platform === "x" ? "xquik_x" : "composio_instagram") &&
    item.status === "connected" &&
    item.identity_confirmed_at &&
    item.publishing_authorized_at,
  );
  const captionTask = getAgentTasks(creator.id).find((task) => task.post_package_id === post.id && task.status !== "failed");
  const captionIssues = evaluateCaption({
    caption: post.caption,
    platform: post.platform,
    phrasesToAvoid: voice?.phrases_to_avoid,
    recentCaptions: getRecentCaptions(creator.id, post.id),
    allowedHandles: people.map((person) => handleForPlatform(person.tags, post.platform)).filter(Boolean),
  });

  return (
    <AppShell active="Approvals">
      <section className="workspace workflow-workspace">
        <Link className="workflow-back-link" href="/approvals"><ArrowLeft aria-hidden="true" />Back to approval queue</Link>
        <PageHeader
          eyebrow={`Approval package #${post.id}`}
          title="Review exact package"
          description="A decision applies to this local media, caption, destination, and planned time together."
          actions={<div className="workflow-page-actions"><WorkflowStatusBadge status={post.status} /><Button asChild size="sm" variant="outline"><Link href="/schedule">Open schedule</Link></Button></div>}
        />

        <div className="workflow-detail-layout">
          <WorkflowMediaGallery assets={assets} />
          <div className="workflow-detail-column">
            <Card className="workflow-detail-card">
              <div className="workflow-detail-card-body">
                <div className="workflow-section-heading"><div><p>Exact package</p><h2>Media, caption, destination</h2><span>Saving any change returns this package to human review before it can be handed off or published.</span></div></div>
                <div className="mt-5"><DestinationSummary post={post} /></div>

                <form action={updatePostAction} className="workflow-edit-form">
                  <input name="id" type="hidden" value={post.id} />
                  <label className="workflow-field" htmlFor="approval-caption"><span>Caption</span><Textarea id="approval-caption" name="caption" placeholder="No caption drafted yet." defaultValue={post.caption} /></label>
                  <details className="workflow-more-details">
                    <summary>Destination, context, people, and timing</summary>
                    <div className="workflow-more-grid">
                      <label className="workflow-field" htmlFor="approval-account"><span>Destination account</span><select defaultValue={post.account_id} id="approval-account" name="accountId">{accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.handle}</option>)}</select></label>
                      <label className="workflow-field" htmlFor="approval-context"><span>Creator and post context</span><Textarea id="approval-context" name="creatorNotes" required defaultValue={post.creator_notes} /></label>
                      <div className="workflow-field"><span>Recorded people and tagging context</span><div>
                        {people.length ? people.map((person) => {
                          const handle = handleForPlatform(person.tags, post.platform);
                          return <div className="workflow-people-summary" key={person.id}><strong>{person.stage_name || person.display_name}</strong><span>Consent: {person.consent_status.replaceAll("_", " ")} · Tagging preference: {person.tagging_preference.replaceAll("_", " ")} · {handle ? `${post.platform} handle recorded: ${handle}` : `No ${post.platform} handle recorded — no tag offered`} · Package tag record: {person.tag_approved ? "approved" : "not approved"}</span></div>;
                        }) : <div className="workflow-people-summary"><strong>No recorded people attached</strong><span>No consent, tagging, or handle information is inferred for this package.</span></div>}
                      </div></div>
                      <label className="workflow-field" htmlFor="approval-time"><span>Planned posting time</span><input defaultValue={post.scheduled_at?.slice(0, 16) ?? ""} id="approval-time" name="scheduledAt" type="datetime-local" /></label>
                    </div>
                  </details>
                  <div className="workflow-invalidation-warning"><CircleAlert aria-hidden="true" /><span>Saving a changed caption, destination, creator context, or planned time removes the current approval and returns this exact package for review.</span></div>
                  <div className="workflow-edit-actions"><Button type="submit" variant="outline">Save package changes</Button></div>
                </form>
              </div>
            </Card>

            <CaptionQualityPanel issues={captionIssues} />

            {post.status === "approved" ? <Card className="workflow-decision-card" data-state="approved">
              <CardContent>
                <div className="workflow-section-heading"><div><p>Human approval recorded</p><h2>Ready for a controlled handoff</h2><span>An approved package can be prepared for a human to post. Handoff, API jobs, and publication confirmation remain separate events.</span></div><CheckCircle2 aria-hidden="true" /></div>
                {query.telegram === "sent" ? <div className="mt-5"><WorkflowNotice variant="success">Sent to the paired Telegram chat. THOT OS has not marked this package published.</WorkflowNotice></div> : null}
                {query.telegram === "failed" ? <div className="mt-5"><WorkflowNotice variant="error">Telegram delivery failed{telegramHandoff?.sent_asset_count ? ` after ${telegramHandoff.sent_asset_count}/${telegramHandoff.asset_count} assets` : " before any assets were sent"}. {telegramHandoff?.error || "Review the pairing and retry when ready."}</WorkflowNotice></div> : null}
                <div className="workflow-action-stack">
                  <div className="workflow-action-box"><div><h3>Manual posting handoff</h3><p>Download or share the approved files, copy the approved caption, then finish inside the native destination platform.</p></div><Button asChild><Link href={`/handoff/${post.id}`}>Open handoff</Link></Button></div>
                  {telegramPairing ? <div className="workflow-action-box"><div><h3>Mobile handoff via Telegram</h3><p>{telegramHandoff?.status === "sent" ? `Last sent ${telegramHandoff.completed_at}. Sending again is still a handoff, not publication.` : `Paired private chat · ${telegramPairing.telegram_username ? `@${telegramPairing.telegram_username}` : telegramPairing.display_name}`}</p></div><form action={sendApprovedPostToTelegramAction}><input name="id" type="hidden" value={post.id} /><Button type="submit" variant="secondary"><MessageCircle aria-hidden="true" />{telegramHandoff?.status === "sent" ? "Send again" : telegramHandoff?.status === "failed" ? "Retry handoff" : "Send to mobile"}</Button></form></div> : null}
                  {connection ? <div className="workflow-action-box workflow-live-job"><div><h3>Authorised API job</h3><p>Preparing a job does not publish. Validation-only creates a non-live job; a live job still requires later approval and execution in API publishing.</p></div><form action={createPublicationJobAction} className="workflow-action-form"><input name="postPackageId" type="hidden" value={post.id} /><label className="sr-only" htmlFor="publication-mode">Job mode</label><select defaultValue="test_private" id="publication-mode" name="mode"><option value="test_private">Validation only — do not publish</option><option value="live">Live {post.platform === "x" ? "X" : "Instagram"} post</option></select><Button type="submit" variant="outline">Prepare API job</Button></form></div> : null}
                </div>
              </CardContent>
            </Card> : post.status === "published" ? <Card className="workflow-decision-card" data-state="published"><CardContent><div className="workflow-section-heading"><div><p>Publication confirmed</p><h2>Ready for outcome matching</h2><span>The human publication confirmation is recorded. Match this package to exact imported Instagram media before attributing performance.</span></div><CheckCircle2 aria-hidden="true" /></div></CardContent></Card> : <Card className="workflow-decision-card"><CardContent><div className="workflow-section-heading"><div><p>Human decision required</p><h2>Approve this exact package</h2><span>Approval enables the next handoff step; it does not publish or send the package anywhere.</span></div><WorkflowStatusBadge status={post.status} /></div><form action={approvePostAction} className="workflow-approve-form"><input name="id" type="hidden" value={post.id} /><Button className="primary-approval" type="submit"><CheckCircle2 aria-hidden="true" />Approve package for handoff</Button></form></CardContent></Card>}

            {(captionTask || voice?.approved_examples.trim()) ? <details className="workflow-agent-tools"><summary>Managing-agent caption tools</summary>{captionTask ? <p>Task #{captionTask.id} · {captionTask.provider} · {captionTask.status.replaceAll("_", " ")}. {captionTask.status === "awaiting_approval" ? <Link href="/agents">Approve and run the local task</Link> : "Its result remains separate from human package approval."}</p> : <div className="workflow-agent-actions"><form action={queueCaptionTaskAction}><input name="postId" type="hidden" value={post.id} /><input name="provider" type="hidden" value="codex" /><Button size="sm" type="submit" variant="outline"><Sparkles aria-hidden="true" />Queue with Codex</Button></form><form action={queueCaptionTaskAction}><input name="postId" type="hidden" value={post.id} /><input name="provider" type="hidden" value="claude" /><Button size="sm" type="submit" variant="outline"><Sparkles aria-hidden="true" />Queue with Claude</Button></form></div>}</details> : null}
          </div>
        </div>

        {(post.status === "published" || publicationMatch) ? <Card className="workflow-outcome-card" variant="quiet"><CardContent><div className="workflow-section-heading"><div><p>Measured outcome</p><h2>Match the exact published post</h2><span>THOT OS can suggest imported Instagram media, but manual confirmation is required before performance is attributed.</span></div></div>{publicationMatch ? <div className="workflow-match-confirmed mt-5"><div><p>Match confirmed · {publicationMatch.match_method.replaceAll("_", " ")}</p><strong>{publicationMatch.external_media_id}</strong></div><Button asChild size="sm" variant="outline"><a href={publicationMatch.permalink} rel="noreferrer" target="_blank">View live post</a></Button></div> : matchCandidates.length ? <form action={confirmInstagramPublicationMatchAction} className="workflow-match-form mt-5"><input name="postPackageId" type="hidden" value={post.id} /><label className="workflow-field" htmlFor="instagram-match"><span>Imported Instagram post</span><select id="instagram-match" name="externalMediaId" required>{matchCandidates.map((item) => <option key={item.media_id} value={item.media_id}>{new Date(item.published_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })} · {item.media_product_type || item.media_type} · {Math.round(item.similarity * 100)}% caption match</option>)}</select></label><Button type="submit">Confirm exact post</Button></form> : <p className="workflow-inline-empty">No unmatched imported Instagram candidates are available. Sync Analytics after the post appears on Instagram.</p>}{outcomes.length ? <div className="workflow-outcome-grid">{outcomes.filter((item, index, list) => list.findIndex((other) => other.horizon === item.horizon) === index).map((item) => <article key={item.id}><span>{item.horizon}</span><strong>{(item.reach || 0).toLocaleString()} reach</strong><small>{(item.total_interactions || 0).toLocaleString()} interactions · captured {new Date(item.captured_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</small></article>)}</div> : null}</CardContent></Card> : null}

        <PackageActivity activity={activity} />
      </section>
    </AppShell>
  );
}
