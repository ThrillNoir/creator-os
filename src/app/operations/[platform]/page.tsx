import Link from "next/link";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { notFound } from "next/navigation";

import { ControlEmptyState, ControlPanelHeading, ControlStatusBadge, ControlTabs, ExecutionModeBadge } from "@/components/control-plane";
import { AppShell } from "@/components/app-shell";
import { MediaPreview } from "@/components/media-workflow";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, getCreatorServiceConnections, getLibraryAssets, getPostPackages } from "@/lib/db";
import { OPERATION_PLATFORMS, PLATFORM_CAPABILITIES, type OperationPlatform } from "@/lib/platform-operations";

export const dynamic = "force-dynamic";

const tabs = ["overview", "create", "upcoming", "analytics", "assets", "tools"] as const;

export default async function PlatformOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { platform: rawPlatform } = await params;
  if (!OPERATION_PLATFORMS.includes(rawPlatform as OperationPlatform)) notFound();

  const platform = rawPlatform as OperationPlatform;
  const { tab: rawTab = "overview" } = await searchParams;
  const tab = tabs.includes(rawTab as (typeof tabs)[number]) ? (rawTab as (typeof tabs)[number]) : "overview";
  const config = PLATFORM_CAPABILITIES[platform];
  const creator = await getActiveCreator();
  const accounts = getAccounts(creator.id).filter((account) => config.accountPlatforms.includes(account.platform));
  const serviceConnections = getCreatorServiceConnections(creator.id);
  const posts = getPostPackages(creator.id).filter((post) => config.accountPlatforms.includes(post.platform));
  const upcoming = posts
    .filter((post) => post.status !== "published" && Boolean(post.scheduled_at))
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const past = posts.filter((post) => post.status === "published").slice(0, 20);
  const assets = config.key === "vault"
    ? [...new Map(
      [
        ...getLibraryAssets({ creatorId: creator.id, destination: "subscription", limit: 80 }),
        ...getLibraryAssets({ creatorId: creator.id, destination: "ppv", limit: 80 }),
      ].map((asset) => [asset.id, asset]),
    ).values()].slice(0, 48)
    : config.destination ? getLibraryAssets({ creatorId: creator.id, destination: config.destination, limit: 48 }) : [];
  const createLabel = platform === "reddit" ? "Open Reddit create" : platform === "vault" ? "Open Vault uploads" : `Create for ${config.label}`;
  const createHref = config.createHref;

  return (
    <AppShell active="Operations"><section className="control-workspace control-platform-workspace">
      <Link className="control-back-link" href="/operations"><ArrowLeft aria-hidden="true" /> Operations overview</Link>
      <PageHeader
        eyebrow="Platform workspace"
        title={config.label}
        description={`${config.publishing.replaceAll("_", " ")} delivery with account state, queue context, and media eligibility in one place.`}
        actions={<Button asChild><Link href={createHref}><Plus aria-hidden="true" /> {createLabel}</Link></Button>}
      />

      <ControlTabs
        label="Platform operations"
        items={OPERATION_PLATFORMS.map((item) => ({ href: `/operations/${item}?tab=${tab}`, label: PLATFORM_CAPABILITIES[item].shortLabel, active: item === platform }))}
      />
      <ControlTabs
        label={`${config.label} sections`}
        items={tabs.map((item) => ({ href: `/operations/${platform}?tab=${item}`, label: item, active: item === tab }))}
      />

      {tab === "overview" ? (
        <div className="control-platform-layout">
          <Card>
            <CardContent>
              <ControlPanelHeading title="Account status" description="Credentials and connection management stay in Accounts & connections." />
              {accounts.length ? <div className="control-account-list">{accounts.map((account) => {
                const service = serviceConnections.find((item) => item.service === account.platform && item.status === "connected" && item.identity_confirmed_at);
                const isConnected = account.connection_status === "connected" || Boolean(service);
                return <article className="control-account-row" key={account.id}>
                  <div><strong>{account.label}</strong><span>{account.handle}</span></div>
                  <ControlStatusBadge status={isConnected ? "completed" : "needs_attention"} label={isConnected ? "Identity verified" : account.connection_status.replaceAll("_", " ")} />
                  <ExecutionModeBadge mode={account.publishing_mode === "direct_api" ? "live" : "test_private"} />
                </article>;
              })}</div> : <ControlEmptyState title={`No ${config.label} account yet`} description="Add an account in Accounts & connections before preparing this destination." action={<Button asChild variant="outline"><Link href="/accounts">Open accounts</Link></Button>} />}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <ControlPanelHeading title="Capabilities & limits" description="The supported surface for this destination." />
              <dl className="control-capability-list">
                <div><dt>Authentication</dt><dd>{config.auth}</dd></div>
                <div><dt>Media</dt><dd>{config.media}</dd></div>
                <div><dt>Scheduling</dt><dd>{config.scheduling}</dd></div>
                <div><dt>Account features</dt><dd>{config.features.join(" · ")}</dd></div>
              </dl>
              <div className="control-capability-note"><strong>Platform note</strong><p>{config.bestPractice}</p></div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "create" ? <Card className="control-create-card"><CardContent>
        <div><p className="control-kicker">Create inside {config.label}</p><h2>Start with media already marked suitable</h2><p>{assets.length} eligible assets are available. The final composer applies this destination&apos;s caption, tagging, scheduling, and publishing rules.</p><Button asChild><Link href={createHref}>{createLabel} <ExternalLink aria-hidden="true" /></Link></Button></div>
        <aside><strong>Current delivery mode</strong><p>{config.publishing.replaceAll("_", " ")}</p><small>{config.bestPractice}</small></aside>
      </CardContent></Card> : null}

      {tab === "upcoming" ? <Card><CardContent>
        <ControlPanelHeading title={`Upcoming ${config.label} posts`} description="Scheduled content for the accounts in this workspace." action={<span className="control-count">{upcoming.length}</span>} />
        {upcoming.length ? <div className="control-post-list">{upcoming.map((post) => <Link href={`/approvals/${post.id}`} key={post.id}><div><strong>{post.account_label}</strong><span>{post.basename}</span></div><time>{post.scheduled_at ? new Date(post.scheduled_at).toLocaleString("en-AU") : "Not scheduled"}</time><ControlStatusBadge status={post.status} /></Link>)}</div> : <ControlEmptyState title="Nothing is scheduled here yet" description="This is why this account may need more queue attention." />}
      </CardContent></Card> : null}

      {tab === "analytics" ? <div className="control-platform-layout"><Card><CardContent>
        <ControlPanelHeading title="Past & measured posts" description="Confirmed publication history for this platform." action={<span className="control-count">{past.length}</span>} />
        {past.length ? <div className="control-post-list">{past.map((post) => <Link href={`/approvals/${post.id}`} key={post.id}><div><strong>{post.account_label}</strong><span>{post.caption || post.basename}</span></div><time>{post.published_at ? new Date(post.published_at).toLocaleDateString("en-AU") : "Published"}</time><ControlStatusBadge status="completed" label="Published" /></Link>)}</div> : <ControlEmptyState title="No confirmed posts are recorded" description="Publication history appears here after a receipt is recorded." />}
      </CardContent></Card><Card><CardContent>
        <ControlPanelHeading title="Analytics sources" description="Reporting remains evidence-backed." />
        <div className="control-link-list"><Link href="/analytics">Open analytics imports <span>→</span></Link><Link href="/reporting">Open reporting & finance <span>→</span></Link></div><p className="control-panel-note">THOT OS does not invent unavailable metrics; provider syncs and imports remain labelled by source.</p>
      </CardContent></Card></div> : null}

      {tab === "assets" ? <section><ControlPanelHeading title={`${config.label}-eligible assets`} description="These come directly from shared Content Library classification." action={<Button asChild variant="outline"><Link href={`/library?destination=${config.destination ?? ""}`}>Open Library filters</Link></Button>} />
        {assets.length ? <div className="control-asset-grid">{assets.map((asset) => <Link href={`/library/asset?asset=${encodeURIComponent(asset.id)}`} key={asset.id} className="control-asset-card"><MediaPreview asset={asset} sizes="(max-width: 620px) 50vw, (max-width: 1080px) 25vw, 180px" /><strong>{asset.basename}</strong><small>{asset.classification_safety?.toUpperCase()} {asset.is_multi ? "· Multi" : ""}</small></Link>)}</div> : <ControlEmptyState title="No eligible assets" description={`No media is marked suitable for ${config.label} yet.`} />}
      </section> : null}

      {tab === "tools" ? <div className="control-platform-layout"><Card><CardContent><ControlPanelHeading title="Account tools & permissions" description="Platform-specific controls live here; secrets do not." /><div className="control-link-list"><Link href="/accounts">Connections and permissions <span>→</span></Link>{platform === "reddit" ? <Link href="/reddit?tab=communities">Subreddit onboarding <span>→</span></Link> : null}{platform === "vault" ? <Link href="/vault">Native bridge queue <span>→</span></Link> : null}<Link href="/activity">Receipts and activity <span>→</span></Link></div></CardContent></Card><Card><CardContent><ControlPanelHeading title="Recommendations" description="Human-reviewed operational prompts." /><div className="control-capability-note"><strong>Best-practice reminder</strong><p>{config.bestPractice}</p></div><div className="control-capability-note"><strong>Inventory</strong><p>{assets.length ? `${assets.length} classified assets are available.` : "Classify suitable assets before building the next post."}</p></div></CardContent></Card></div> : null}
    </section></AppShell>
  );
}
