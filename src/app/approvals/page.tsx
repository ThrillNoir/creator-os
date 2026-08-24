import Image from "next/image";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getPostPackages } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const creator = await getActiveCreator();
  const posts = getPostPackages(creator.id);
  return (
    <AppShell active="Approvals">
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · HUMAN CHECKPOINT</span><h1>Approvals</h1><p className="page-subtitle">Review the exact media, copy and destination</p></div><Link className="primary-button button-link" href="/content/new">＋ Prepare content</Link></header>
        <div className="approval-grid">
          {posts.map((post) => (
            <Link className="approval-card" href={`/approvals/${post.id}`} key={post.id}>
              <div className="approval-thumb"><Image src={`/api/media/${post.relative_path.split("/").map(encodeURIComponent).join("/")}`} alt="" fill sizes="150px" unoptimized /></div>
              <div><span className={`approval-state ${post.status}`}>{post.status.replaceAll("_", " ")}</span><h2>{post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename}</h2><p>{post.account_label} · {post.handle}</p><small>{post.creator_notes}</small></div>
              <b>→</b>
            </Link>
          ))}
        </div>
        {posts.length === 0 && <div className="empty-state"><h2>No approval packages yet</h2><p>Choose a library asset and prepare the first Thrill Noir post.</p><Link className="primary-button button-link" href="/content/new">Prepare first post</Link></div>}
      </section>
    </AppShell>
  );
}
