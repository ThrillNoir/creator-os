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
};

export type FinanceImportSummary = {
  id: string;
  platform: FinancePlatform;
  source_name: string;
  row_count: number;
  imported_by: string;
  imported_at: string;
};

export type CommissionPaymentEvidence = {
  id: string;
  actor: string;
  created_at: string;
  amount_minor: number;
  currency: string;
  received_on: string;
  reference: string;
};

export type AgencySplitProposal = {
  id: string;
  actor: string;
  created_at: string;
  agency_split_bps: number;
  effective_on: string;
};

type CommissionPaymentEventRow = Pick<CommissionPaymentEvidence, "id" | "actor" | "created_at"> & { detail: string };
type AgencySplitEventRow = Pick<AgencySplitProposal, "id" | "actor" | "created_at"> & { detail: string };

function parseAgencySplitProposal(row: AgencySplitEventRow): AgencySplitProposal | null {
  try {
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    const basisPoints = detail.agencySplitBps;
    const effectiveOn = detail.effectiveOn;
    if (!Number.isSafeInteger(basisPoints) || Number(basisPoints) < 0 || Number(basisPoints) > 10000
      || typeof effectiveOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)
      || detail.basis !== "unresolved"
      || detail.revenueScope !== "thot_generated_paid_site_sales"
      || detail.eligibleRevenueEvidence !== "unresolved"
      || detail.cadence !== "unresolved"
      || detail.softwareFee !== "none_currently" || detail.futureFee !== "undecided") return null;
    const [year, month, day] = effectiveOn.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { id: row.id, actor: row.actor, created_at: row.created_at, agency_split_bps: Number(basisPoints), effective_on: effectiveOn };
  } catch {
    return null;
  }
}

function parseCommissionPaymentEvidence(row: CommissionPaymentEventRow): CommissionPaymentEvidence | null {
  try {
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    if (!Number.isSafeInteger(detail.amountMinor) || Number(detail.amountMinor) <= 0
      || typeof detail.currency !== "string" || !/^[A-Z]{3}$/.test(detail.currency)
      || typeof detail.receivedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(detail.receivedOn)
      || typeof detail.reference !== "string" || !detail.reference || detail.reference.length > 160) return null;
    return {
      id: row.id,
      actor: row.actor,
      created_at: row.created_at,
      amount_minor: Number(detail.amountMinor),
      currency: detail.currency,
      received_on: detail.receivedOn,
      reference: detail.reference,
    };
  } catch {
    return null;
  }
}

export function calculateProvisionalCommission(netRevenueMinor: number, settings: { agency_split_bps: number } | null): null {
  // The contract's calculation base remains unresolved. A percentage alone must
  // never be presented as an allocation against imported net earnings.
  void netRevenueMinor;
  void settings;
  return null;
}

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
  const [earnings, imports, settings, commissionPaymentEvents, agencySplitEvents, social, vault, messages] = await Promise.all([
    creatorPrepare(DB, creatorId, `SELECT platform,currency,COUNT(*) AS rows,MIN(period_date) AS first_date,MAX(period_date) AS latest_date,
      COALESCE(SUM(gross_revenue_minor),0) AS gross_revenue_minor,COALESCE(SUM(refunds_minor),0) AS refunds_minor,
      COALESCE(SUM(net_revenue_minor),0) AS net_revenue_minor
      FROM finance_daily_metrics WHERE creator_id=@creator GROUP BY platform,currency ORDER BY platform,currency`).all<EarningsSummary>(),
    creatorPrepare(DB, creatorId, `SELECT id,platform,source_name,row_count,imported_by,imported_at
      FROM finance_imports WHERE creator_id=@creator ORDER BY imported_at DESC LIMIT 12`).all<FinanceImportSummary>(),
    creatorPrepare(DB, creatorId, `SELECT agency_split_bps,revenue_basis,updated_by,updated_at
      FROM creator_finance_settings WHERE creator_id=@creator`).first<{ agency_split_bps: number; revenue_basis: string; updated_by: string; updated_at: string }>(),
    creatorPrepare(DB, creatorId, `SELECT id,actor,created_at,detail FROM finance_audit_events
      WHERE creator_id=@creator AND event_type='commission_payment_reported'
      ORDER BY created_at DESC,id DESC LIMIT 10`).all<CommissionPaymentEventRow>(),
    creatorPrepare(DB, creatorId, `SELECT id,actor,created_at,detail FROM finance_audit_events
      WHERE creator_id=@creator AND event_type='agency_split_proposed'
      ORDER BY created_at DESC,id DESC LIMIT 20`).all<AgencySplitEventRow>(),
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
    settings,
    agencySplitProposals: agencySplitEvents.results.map(parseAgencySplitProposal).filter((row): row is AgencySplitProposal => row !== null),
    commissionPaymentEvidence: commissionPaymentEvents.results.map(parseCommissionPaymentEvidence).filter((row): row is CommissionPaymentEvidence => row !== null),
    counts,
    scorecard: calculateDeliveryScorecard(counts),
  };
}
