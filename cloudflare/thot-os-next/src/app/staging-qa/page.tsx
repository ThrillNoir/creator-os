import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

function enabled() {
  return (cloudflareEnv() as CloudflareEnv & { STAGING_QA_ENABLED?: string }).STAGING_QA_ENABLED === "1";
}

export default async function StagingQaPage({ searchParams }: { searchParams: Promise<{ creator?: string }> }) {
  if (!enabled()) notFound();
  const creatorId = (await searchParams).creator?.trim() || undefined;
  const identity = await requireCreatorContext("view", creatorId);
  return <AppShell active="Staging QA">
    <PageHeader title="Authorization certification" subtitle="Staging-only audit probes. These controls never publish, message, upload or retrieve media." eyebrow="STAGING QA" />
    <section className="panel">
      <h2>Effective workspace</h2>
      <p data-testid="effective-creator">{identity.creator.creator_name} · {identity.creator.role}</p>
      <p><Link href={`/staging-qa?creator=${encodeURIComponent(identity.creator.creator_id)}`}>Check this creator</Link></p>
      <form action="/api/staging/qa/human-mutation" method="post">
        <input type="hidden" name="creatorId" value={identity.creator.creator_id} />
        <button className="secondary-action" type="submit">Write own-creator audit probe</button>
      </form>
      <form action="/api/staging/qa/human-mutation" method="post">
        <input type="hidden" name="creatorId" value={identity.creator.creator_id} />
        <input type="hidden" name="actor_role" value="agency_admin" />
        <button className="secondary-action" type="submit">Attempt role spoof</button>
      </form>
    </section>
  </AppShell>;
}
