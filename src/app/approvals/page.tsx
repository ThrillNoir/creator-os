import Link from "next/link";
import { CheckCircle2, Clock3, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { PostPackageCard, WorkflowEmptyState } from "@/components/publication-workflow";
import { Button } from "@/components/ui/button";
import { getPostPackages } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const creator = await getActiveCreator();
  const posts = getPostPackages(creator.id);
  const awaitingReview = posts.filter((post) => post.status === "needs_approval" || post.status === "draft");
  const approved = posts.filter((post) => post.status === "approved");
  const published = posts.filter((post) => post.status === "published");

  return (
    <AppShell active="Approvals">
      <section className="workspace workflow-workspace">
        <PageHeader
          eyebrow={`${creator.name} · human checkpoint`}
          title="Approval queue"
          description="Review the exact local media, caption, destination, and planned time together before any handoff or publication work begins."
          actions={<div className="workflow-page-actions"><Button asChild><Link href="/content/new">Prepare local drafts</Link></Button></div>}
        />

        <section className="workflow-summary-grid" aria-label="Approval queue summary">
          <article><Clock3 aria-hidden="true" /><div><strong>{awaitingReview.length}</strong><span>Need review</span></div></article>
          <article><CheckCircle2 aria-hidden="true" /><div><strong>{approved.length}</strong><span>Approved handoffs</span></div></article>
          <article><Send aria-hidden="true" /><div><strong>{published.length}</strong><span>Publication confirmed</span></div></article>
        </section>

        {posts.length ? <section className="workflow-package-list" aria-label="Post packages">
          {posts.map((post, index) => <PostPackageCard key={post.id} post={post} priority={index === 0} />)}
        </section> : <WorkflowEmptyState
          action={<Button asChild><Link href="/content/new">Prepare first local draft</Link></Button>}
          description={`Choose existing library media and a destination to prepare ${creator.name}'s first local draft package. Nothing is published from this step.`}
          title="No approval packages yet"
        />}
      </section>
    </AppShell>
  );
}
