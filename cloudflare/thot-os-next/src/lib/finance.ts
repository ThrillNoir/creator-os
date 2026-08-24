import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { calculateDeliveryScorecard, type DeliveryCounts, type FinancePlatform } from "./finance-metrics";

export type EarningsSummary = {
  platform: FinancePlatform;
  currency: string;
  rows: number;
  first_date: string;
  latest_date: string;
  gross_revenue_minor: number;
  refunds_minor: number;
  net_revenue_minor: number;
  subscribers: number;
};

export type FinanceImportSummary = {
  id: string;
  platform: FinancePlatform;
  source_name: string;
  row_count: number;
  imported_by: string;
  imported_at: string;
};

type SocialReliabilityRow = {
  verified_social: number;
  failed_social: number;
  unreviewed_social: number;
  stalled_social: number;
  approval_required: number;
  approval_gaps: number;
};

type VaultReliabilityRow = {
  verified_vault: number;
  failed_vault: number;
  awaiting_device: number;
  stalled_vault: number;
};

export async function getMoneyDashboard(creatorId: string) {
  const { DB } = cloudflareEnv();
  const [earnings, imports, settings, social, vault, messages] = await Promise.all([
    creatorPrepare(DB, creatorId, `SELECT platform,currency,COUNT(*) AS rows,MIN(period_date) AS first_date,MAX(period_date) AS latest_date,
      COALESCE(SUM(gross_revenue_minor),0) AS gross_revenue_minor,COALESCE(SUM(refunds_minor),0) AS refunds_minor,
      COALESCE(SUM(net_revenue_minor),0) AS net_revenue_minor,COALESCE(SUM(subscribers),0) AS subscribers
      FROM finance_daily_metrics WHERE creator_id=@creator GROUP BY platform,currency ORDER BY platform,currency`).all<EarningsSummary>(),
    creatorPrepare(DB, creatorId, `SELECT id,platform,source_name,row_count,imported_by,imported_at
      FROM finance_imports WHERE creator_id=@creator ORDER BY imported_at DESC LIMIT 12`).all<FinanceImportSummary>(),
    creatorPrepare(DB, creatorId, `SELECT agency_split_bps,revenue_basis,updated_by,updated_at
      FROM creator_finance_settings WHERE creator_id=@creator`).first<{ agency_split_bps: number; revenue_basis: string; updated_by: string; updated_at: string }>(),
    creatorPrepare(DB, creatorId, `SELECT
      COALESCE(SUM(CASE WHEN status='published' AND external_post_id IS NOT NULL AND external_url IS NOT NULL THEN 1 ELSE 0 END),0) AS verified_social,
      COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed_social,
      COALESCE(SUM(CASE WHEN status='failed' AND failure_reviewed_at IS NULL THEN 1 ELSE 0 END),0) AS unreviewed_social,
      COALESCE(SUM(CASE WHEN status='publishing' AND unixepoch(updated_at)<=unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS stalled_social,
      COALESCE(SUM(CASE WHEN status IN ('scheduled','publishing','published') THEN 1 ELSE 0 END),0) AS approval_required,
      COALESCE(SUM(CASE WHEN status IN ('scheduled','publishing','published') AND approved_at IS NULL THEN 1 ELSE 0 END),0) AS approval_gaps
      FROM social_posts WHERE creator_id=@creator`).first<SocialReliabilityRow>(),
    creatorPrepare(DB, creatorId, `SELECT
      COALESCE(SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END),0) AS verified_vault,
      COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed_vault,
      COALESCE(SUM(CASE WHEN status IN ('approved','claimed','staged') THEN 1 ELSE 0 END),0) AS awaiting_device,
      COALESCE(SUM(CASE WHEN status='claimed' AND unixepoch(updated_at)<=unixepoch('now')-900 THEN 1 ELSE 0 END),0) AS stalled_vault
      FROM vault_upload_jobs WHERE creator_id=@creator`).first<VaultReliabilityRow>(),
    creatorPrepare(DB, creatorId, "SELECT COALESCE(SUM(unread_count),0) AS unread FROM message_threads WHERE creator_id=@creator AND status='open'").first<{ unread: number }>(),
  ]);
  const counts: DeliveryCounts = {
    verifiedSocial: Number(social?.verified_social ?? 0),
    failedSocial: Number(social?.failed_social ?? 0),
    unreviewedSocial: Number(social?.unreviewed_social ?? 0),
    stalledSocial: Number(social?.stalled_social ?? 0),
    approvalRequired: Number(social?.approval_required ?? 0),
    approvalGaps: Number(social?.approval_gaps ?? 0),
    verifiedVault: Number(vault?.verified_vault ?? 0),
    failedVault: Number(vault?.failed_vault ?? 0),
    awaitingDevice: Number(vault?.awaiting_device ?? 0),
    stalledVault: Number(vault?.stalled_vault ?? 0),
    unreadConversations: Number(messages?.unread ?? 0),
  };
  return {
    earnings: earnings.results,
    imports: imports.results,
    settings: settings ?? { agency_split_bps: 0, revenue_basis: "imported_net_earnings", updated_by: "", updated_at: null },
    counts,
    scorecard: calculateDeliveryScorecard(counts),
  };
}
