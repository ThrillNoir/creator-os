import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { RedditHandoffActions } from "@/components/reddit-handoff-actions";
import { getActiveCreator } from "@/lib/current-creator";
import { getPostPackage, getPostPackageAssets, getRedditTarget } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RedditHandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const target = getRedditTarget(Number((await params).id));
  const creator = await getActiveCreator();
  if (!target || target.creator_id !== creator.id || target.status !== "approved_for_posting") notFound();
  const post = getPostPackage(target.post_package_id);
  if (!post || post.creator_id !== creator.id || post.status !== "approved") notFound();
  const assets = getPostPackageAssets(post.id);
  const media = assets.map((asset) => ({
    filename: asset.basename,
    url: `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`,
  }));
  const submitUrl = `https://www.reddit.com/r/${encodeURIComponent(target.community_name)}/submit?type=IMAGE`;
  return (
    <main className="app-shell">
      <AppNav active="Reddit operations" />
      <section className="workspace form-workspace">
        <Link className="back-link" href="/reddit">← Back to Reddit operations</Link>
        <header className="form-header"><span className="eyebrow">APPROVED REDDIT TARGET #{target.id}</span><h1>Finish in r/{target.community_name}</h1><p>Browser assistance prepares the exact package and stops before Reddit&apos;s Submit button.</p></header>
        <div className="review-layout">
          <div className={`review-gallery ${assets.length === 1 ? "single" : ""}`}>{assets.map((asset, index) => <div className="review-gallery-item" key={asset.id}><Image src={media[index].url} alt={asset.basename} fill unoptimized sizes="(max-width: 800px) 100vw, 55vw" /><span>{index + 1}</span></div>)}</div>
          <section className="form-panel review-copy">
            <span className="approval-state approved">target approved</span>
            <h2>r/{target.community_name}</h2><p className="handle">{target.account_label}</p>
            <label>Reddit title<div>{target.title}</div></label>
            <label>Approved caption/body<div>{post.caption || "No body text."}</div></label>
            <label>Flair<div>{target.flair || "No flair recorded."}</div></label>
            <div className="edit-warning">Confirm the subreddit, account, flair and current rules inside Reddit. Do not submit if Reddit shows a warning, verification requirement, CAPTCHA or changed rule.</div>
            <RedditHandoffActions title={target.title} body={post.caption} media={media} submitUrl={submitUrl} />
          </section>
        </div>
      </section>
    </main>
  );
}
