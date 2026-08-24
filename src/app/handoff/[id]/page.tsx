import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HandoffActions } from "@/components/handoff-actions";
import { getPostPackage, getPostPackageAssets } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { markPostPublishedAction } from "@/app/actions";
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
  }));
  const platformUrl =
    post.platform === "x"
      ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.caption)}`
      : post.platform === "myroomz" && myRoomz.ready
        ? myRoomz.uploadUrl
      : post.account_url;
  const actionLabel = post.platform === "myroomz" && myRoomz.ready ? "Open MyRoomz Vault" : `Open ${post.platform}`;

  return (
    <AppShell active="Approvals">
      <section className="workspace form-workspace">
        <Link className="back-link" href={`/approvals/${post.id}`}>← Back to approval</Link>
        <header className="form-header">
          <span className="eyebrow">APPROVED HANDOFF #{post.id}</span>
          <h1>{post.platform === "myroomz" && myRoomz.ready ? "Send to MyRoomz Vault" : `Finish on ${post.platform}`}</h1>
          <p>Use this page on the device where you have the correct account logged in.</p>
        </header>
        <div className="review-layout">
          <div className={`review-gallery ${assets.length === 1 ? "single" : ""}`}>
            {assets.map((asset, index) => <div className="review-gallery-item" key={asset.id}><Image src={media[index].url} alt={asset.basename} fill sizes="(max-width: 800px) 50vw, 28vw" unoptimized priority={index === 0} /><span>{index + 1}</span></div>)}
          </div>
          <section className="form-panel review-copy">
            <span className="approval-state approved">approved</span>
            <h2>{post.account_label}</h2>
            <p className="handle">{post.handle}</p>
            <div className="handoff-steps">
              <div><b>1</b><span><strong>{post.platform === "myroomz" ? "Download the approved media" : "Share or download the media"}</strong>{post.platform === "myroomz" ? "Keep the original exported file ready for the Vault uploader." : "On iPhone or Android, “Share media to apps” opens the system share sheet. Choose the destination app if it appears."}</span></div>
              <div><b>2</b><span><strong>Copy the caption</strong>{post.platform === "x" ? "The X composer will also receive the approved text automatically." : "Instagram may ignore text supplied through the share sheet, so paste it during the final post."}</span></div>
              <div><b>3</b><span><strong>{post.platform === "myroomz" && myRoomz.ready ? "Open the private MyRoomz Vault" : `Finish inside ${post.platform}`}</strong>{post.platform === "myroomz" && myRoomz.ready ? "Upload the approved files, then finish the MyRoomz post in its desktop workflow." : "Choose the final media settings, tags and placement, then publish manually."}</span></div>
            </div>
            <label>Approved caption<div>{post.caption || "No caption was included in this approved package."}</div></label>
            <HandoffActions media={media} caption={post.caption} platformUrl={platformUrl} platform={post.platform} actionLabel={actionLabel} />
            <form action={markPostPublishedAction} className="handoff-published-form">
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="returnTo" value="schedule" />
              <button className="handoff-button published-button">✓ I finished publishing this post</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
