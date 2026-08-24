import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approvePostAction, confirmInstagramPublicationMatchAction, createPublicationJobAction, queueCaptionTaskAction, sendApprovedPostToTelegramAction, updatePostAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getAccounts, getAgentTasks, getCreatorActivity, getInstagramMatchCandidates, getLatestTelegramHandoff, getPlatformConnections, getPostOutcomeSnapshots, getPostPackage, getPostPackageAssets, getPostPackagePeople, getPublicationMatches, getRecentCaptions, getTelegramCreatorPairing, getVoiceProfile } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { evaluateCaption } from "@/lib/caption-quality";

export const dynamic = "force-dynamic";
const photoExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

function handleForPlatform(tags:string,platform:string){
  return tags.split(" · ").find((tag)=>tag.startsWith(`${platform}:`))?.slice(platform.length+1)||"";
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
  const publicationMatch=getPublicationMatches(creator.id).find(item=>item.post_package_id===post.id);
  const matchCandidates=post.platform==="instagram"&&!publicationMatch&&post.status==="published"?getInstagramMatchCandidates(creator.id,post.id):[];
  const outcomes=getPostOutcomeSnapshots(creator.id,post.id);
  const activity=getCreatorActivity(creator.id,post.id);
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
    allowedHandles: people.map((person)=>handleForPlatform(person.tags,post.platform)).filter(Boolean),
  });
  return (
    <AppShell active="Approvals">
      <section className="workspace form-workspace">
        <Link className="back-link" href="/approvals">← Back to approvals</Link>
        <header className="form-header"><span className="eyebrow">APPROVAL PACKAGE #{post.id}</span><h1>Review post</h1><p>Approval applies to this media, copy and destination together.</p></header>
        <div className="review-layout">
          <div className={`review-gallery ${assets.length === 1 ? "single" : ""}`}>
            {assets.map((asset, index) => {
              const mediaUrl = `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;
              return <div className="review-gallery-item" key={asset.id}>{photoExtensions.has(asset.extension) ? <Image src={mediaUrl} alt={asset.basename} fill sizes="(max-width: 800px) 50vw, 28vw" unoptimized priority={index === 0} /> : <video src={mediaUrl} controls playsInline preload="metadata" />}<span>{index + 1}</span></div>;
            })}
          </div>
          <section className="form-panel review-copy">
            <span className={`approval-state ${post.status}`}>{post.status.replaceAll("_", " ")}</span>
            <div className="approval-destination"><div><span>DESTINATION</span><h2>{post.account_label}</h2><p className="handle">{post.handle}</p></div><b>{post.platform === "x" ? "X" : post.platform.toUpperCase()}</b></div>
            <form action={updatePostAction} className="approval-edit-form">
              <input type="hidden" name="id" value={post.id} />
              <label className="approval-caption">Caption<textarea name="caption" defaultValue={post.caption} placeholder="No caption drafted yet." /></label>
              <details className="approval-more">
                <summary>More details and editing</summary>
                <div className="approval-more-fields">
                  <label>Destination<select name="accountId" defaultValue={post.account_id}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.label} · {account.handle}</option>)}</select></label>
                  <label>Creator context<textarea name="creatorNotes" required defaultValue={post.creator_notes} /></label>
                  <label>Creator friends and destination tags<div>{people.length ? people.map((person) => {const handle=handleForPlatform(person.tags,post.platform);return `${person.stage_name || person.display_name} · ${handle||`no ${post.platform} handle — no tag offered`}`;}).join("\n") : "No creator friends attached."}</div></label>
                  <label>Planned time<input name="scheduledAt" type="datetime-local" defaultValue={post.scheduled_at?.slice(0, 16) ?? ""} /></label>
                  <div className="edit-warning">Saving changes removes the current approval and returns the package for review.</div>
                  <button className="handoff-button save-edit">Save changes</button>
                </div>
              </details>
            </form>
            <div className={`quality-box compact ${captionIssues.length ? "has-issues" : "clear"}`}>
              {captionIssues.length ? captionIssues.map((issue) => <p className={issue.severity} key={issue.code}>{issue.severity === "blocker" ? "!" : "△"} {issue.message}</p>) : <p className="clear">✓ Caption checks passed. Human voice review is still required.</p>}
            </div>
            {post.status === "approved" ? (
              <>
                <div className="approved-actions"><strong>✓ Approved by BR</strong><Link href={`/handoff/${post.id}`}>Open posting handoff →</Link></div>
                {query.telegram === "sent" && <div className="handoff-result success">Sent to the paired Telegram chat. THOT OS has not marked it published.</div>}
                {query.telegram === "failed" && <div className="handoff-result failed">Telegram delivery failed{telegramHandoff?.sent_asset_count ? ` after ${telegramHandoff.sent_asset_count}/${telegramHandoff.asset_count} assets` : " before any assets were sent"}. {telegramHandoff?.error || "Review the connection and retry."}</div>}
                {telegramPairing && <div className="telegram-handoff-box">
                  <div><strong>Send to mobile</strong><span>{telegramHandoff?.status === "sent" ? `Last sent ${telegramHandoff.completed_at}` : `Private chat · ${telegramPairing.telegram_username ? `@${telegramPairing.telegram_username}` : telegramPairing.display_name}`}</span></div>
                  <form action={sendApprovedPostToTelegramAction}><input type="hidden" name="id" value={post.id} /><button className="primary-button">{telegramHandoff?.status === "sent" ? "Send again" : telegramHandoff?.status === "failed" ? "Retry Telegram" : "Send via Telegram"}</button></form>
                </div>}
                {connection && <form action={createPublicationJobAction} className="api-job-form"><input type="hidden" name="postPackageId" value={post.id} /><select name="mode"><option value="test_private">Validation only — do not publish</option><option value="live">Live {post.platform === "x" ? "X" : "Instagram"} post</option></select><button className="handoff-button">Prepare API job</button></form>}
              </>
            ) : post.status === "published" ? (
              <div className="approved-actions"><strong>✓ Publication confirmed</strong><span>Ready for outcome matching</span></div>
            ) : (
              <form action={approvePostAction}><input type="hidden" name="id" value={post.id} /><button className="primary-button full-approve">Approve this package</button></form>
            )}
            {(captionTask || voice?.approved_examples.trim()) && <details className="caption-agent-box compact-agent-box">
              <summary>Managing-agent caption tools</summary>
              {captionTask ? (
                <p>Task #{captionTask.id} · {captionTask.provider} · {captionTask.status.replaceAll("_", " ")}. {captionTask.status === "awaiting_approval" && <Link href="/agents">Approve and run →</Link>}</p>
              ) : (
                <div className="agent-provider-actions">
                  <form action={queueCaptionTaskAction}><input type="hidden" name="postId" value={post.id} /><input type="hidden" name="provider" value="codex" /><button>Queue with Codex</button></form>
                  <form action={queueCaptionTaskAction}><input type="hidden" name="postId" value={post.id} /><input type="hidden" name="provider" value="claude" /><button>Queue with Claude</button></form>
                </div>
              )}
            </details>}
          </section>
        </div>
        {(post.status==="published"||publicationMatch)&&<section className="panel outcome-panel">
          <div className="panel-heading"><div><h2>Published outcome</h2><p>Connect this package to the exact Instagram media before THOT OS attributes performance.</p></div></div>
          {publicationMatch?<div className="match-confirmed"><div><span>MATCHED · {publicationMatch.match_method.replaceAll("_"," ")}</span><strong>{publicationMatch.external_media_id}</strong></div><a href={publicationMatch.permalink} target="_blank" rel="noreferrer">View live post ↗</a></div>:matchCandidates.length?<form action={confirmInstagramPublicationMatchAction} className="match-form"><input type="hidden" name="postPackageId" value={post.id}/><label>Instagram post<select name="externalMediaId" required>{matchCandidates.map(item=><option value={item.media_id} key={item.media_id}>{new Date(item.published_at).toLocaleString("en-AU",{timeZone:"Australia/Perth"})} · {item.media_product_type||item.media_type} · {Math.round(item.similarity*100)}% caption match</option>)}</select></label><button className="primary-button">Confirm exact post</button><p>THOT OS suggests candidates but never confirms a manual match itself.</p></form>:<div className="mini-empty">No unmatched Instagram candidates are available. Sync Analytics after the post appears on Instagram.</div>}
          {outcomes.length>0&&<div className="outcome-grid">{outcomes.filter((item,index,list)=>list.findIndex(other=>other.horizon===item.horizon)===index).map(item=><article key={item.id}><span>{item.horizon}</span><strong>{(item.reach||0).toLocaleString()} reach</strong><small>{(item.total_interactions||0).toLocaleString()} interactions · captured {new Date(item.captured_at).toLocaleString("en-AU")}</small></article>)}</div>}
        </section>}
        <section className="panel package-activity"><div className="panel-heading"><div><h2>Package history</h2><p>Approval, handoff, publication and measurement remain distinct events.</p></div><Link href="/activity">All activity →</Link></div>{activity.slice(0,8).map(item=><article key={item.id}><time>{new Date(item.occurredAt).toLocaleString("en-AU")}</time><div><strong>{item.title}</strong><span>{item.detail}</span></div><b>{item.status}</b></article>)}{!activity.length&&<div className="mini-empty">No package events yet.</div>}</section>
      </section>
    </AppShell>
  );
}
