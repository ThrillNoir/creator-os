import Link from "next/link";
import { AlertTriangle, CheckCircle2, Layers3, RadioTower, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { AppShell } from "@/components/app-shell";
import {
  ControlEmptyState,
  ControlMetric,
  ControlPanelHeading,
  OperationalHealthBadge,
} from "@/components/control-plane";
import { Card, CardContent } from "@/components/ui/card";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, getLibraryAssets, getPostPackages, getVaultUploadJobs } from "@/lib/db";
import { OPERATION_PLATFORMS, PLATFORM_CAPABILITIES } from "@/lib/platform-operations";

type PlatformHealth = "healthy" | "needs_love" | "needs_attention" | "blocked";

type PlatformSummary = {
  key: (typeof OPERATION_PLATFORMS)[number];
  accountCount: number;
  upcomingCount: number;
  eligibleAssets: number;
  health: PlatformHealth;
  reason: string;
};

export default async function OperationsPage() {
  const creator = await getActiveCreator();
  const accounts = getAccounts(creator.id);
  const posts = getPostPackages(creator.id);
  const vaultJobs = getVaultUploadJobs(creator.id);
  const platformSummaries = OPERATION_PLATFORMS.map((key): PlatformSummary => {
      const config = PLATFORM_CAPABILITIES[key];
      const platformAccounts = accounts.filter((account) =>
        config.accountPlatforms.includes(account.platform),
      );
      const upcomingCount = posts.filter(
        (post) => config.accountPlatforms.includes(post.platform) && post.status !== "published" && Boolean(post.scheduled_at),
      ).length;
      const eligibleAssets =
        key === "vault"
          ? new Set(
              [
                ...getLibraryAssets({ creatorId: creator.id, destination: "subscription", limit: 500 }),
                ...getLibraryAssets({ creatorId: creator.id, destination: "ppv", limit: 500 }),
              ].map((asset) => asset.id),
            ).size
          : config.destination ? getLibraryAssets({ creatorId: creator.id, destination: config.destination, limit: 500 }).length : 0;
      const failedVault = key === "vault" ? vaultJobs.filter((job) => job.status === "failed").length : 0;

      let health: PlatformHealth = "healthy";
      let reason = `${eligibleAssets} eligible assets · ${upcomingCount} upcoming`;
      if (!platformAccounts.length) {
        health = "needs_attention";
        reason = "No account has been added.";
      } else if (failedVault) {
        health = "blocked";
        reason = `${failedVault} vault upload${failedVault === 1 ? "" : "s"} failed.`;
      } else if (platformAccounts.some((account) => account.publishing_mode === "direct_api" && account.connection_status !== "connected")) {
        health = "blocked";
        reason = "A direct publishing connection needs to be restored.";
      } else if (!eligibleAssets) {
        health = "needs_attention";
        reason = "No assets are classified for this destination.";
      } else if (!upcomingCount) {
        health = "needs_love";
        reason = "No upcoming content is scheduled.";
      }

      return { key, accountCount: platformAccounts.length, upcomingCount, eligibleAssets, health, reason };
    });

  const healthyCount = platformSummaries.filter((platform) => platform.health === "healthy").length;
  const attentionCount = platformSummaries.filter((platform) => platform.health !== "healthy").length;
  const connectedCount = accounts.filter((account) => account.connection_status === "connected").length;

  return (
    <AppShell active="Operations"><section className="control-workspace">
      <PageHeader
        eyebrow="Control plane"
        title="Platform operations"
        description="Readiness, queue health, and approved publishing pathways by destination."
      />

      <section className="control-metric-grid" aria-label="Operations summary">
        <ControlMetric label="Destinations ready" value={`${healthyCount}/${platformSummaries.length}`} detail="Healthy operational surfaces" icon={CheckCircle2} />
        <ControlMetric label="Needs attention" value={attentionCount} detail="Review before the next run" icon={AlertTriangle} tone="warning" />
        <ControlMetric label="Connected accounts" value={connectedCount} detail={`${accounts.length} configured identities`} icon={RadioTower} tone="accent" />
        <ControlMetric label="Queued packages" value={platformSummaries.reduce((total, platform) => total + platform.upcomingCount, 0)} detail="Not yet published" icon={Layers3} />
      </section>

      {attentionCount > 0 ? (
        <Card className="control-attention-card">
          <CardContent>
            <ControlPanelHeading title="Attention queue" description="These destinations need a decision or operational follow-up." />
            <div className="control-attention-list">
              {platformSummaries
                .filter((platform) => platform.health !== "healthy")
                .map((platform) => {
                  const config = PLATFORM_CAPABILITIES[platform.key];
                  return (
                    <Link key={platform.key} href={`/operations/${platform.key}`} className="control-attention-row">
                      <ShieldAlert aria-hidden="true" />
                      <span>
                        <strong>{config.label}</strong>
                        <small>{platform.reason}</small>
                      </span>
                      <OperationalHealthBadge health={platform.health} />
                    </Link>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="platform-control-heading">
        <ControlPanelHeading id="platform-control-heading" title="Destination control surfaces" description="Open a destination to inspect connected accounts, queued packages, media, and available tools." />
        {platformSummaries.length ? (
          <div className="control-platform-grid">
            {platformSummaries.map((platform) => {
              const config = PLATFORM_CAPABILITIES[platform.key];
              return (
                <Link key={platform.key} href={`/operations/${platform.key}`} className="control-platform-card">
                  <div className="control-platform-card-heading">
                    <div>
                      <p>{config.destination}</p>
                      <h2>{config.label}</h2>
                    </div>
                    <OperationalHealthBadge health={platform.health} />
                  </div>
                  <p className="control-platform-summary">{platform.reason}</p>
                  <dl className="control-platform-facts">
                    <div><dt>Accounts</dt><dd>{platform.accountCount}</dd></div>
                    <div><dt>Upcoming</dt><dd>{platform.upcomingCount}</dd></div>
                    <div><dt>Eligible media</dt><dd>{platform.eligibleAssets}</dd></div>
                  </dl>
                  <span className="control-platform-open">Open workspace <span aria-hidden="true">→</span></span>
                </Link>
              );
            })}
          </div>
        ) : (
          <ControlEmptyState title="No platform configuration is available" description="Add a destination configuration before operating a publishing surface." />
        )}
      </section>

      <p className="control-future-note">This view reports the current operational model. Capability changes remain separate from publishing approval and execution.</p>
    </section></AppShell>
  );
}
