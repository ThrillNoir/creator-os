import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { integrationState } from "./integration-health";
export type { IntegrationState } from "./integration-health";

type AccountHealthRow = {
  platform: string;
  label: string;
  connection_status: string;
  publishing_authority: string;
  warning_level: string;
  warning_message: string;
  last_success_at: string | null;
  provider_status: string | null;
  provider_error: string | null;
  service_granted: number;
};

export async function getCreatorControlPlaneOverview(creatorId: string) {
  const { DB } = cloudflareEnv();
  const [creator, library, accounts, messages, publishing, exceptions] = await Promise.all([
    DB.prepare("SELECT id,name,status,created_at FROM creators WHERE id=?").bind(creatorId).first<{ id: string; name: string; status: string; created_at: string }>(),
    DB.prepare(`SELECT COUNT(*) AS assets,
      SUM(CASE WHEN source_available=1 AND preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews,
      SUM(CASE WHEN source_available=1 THEN 1 ELSE 0 END) AS available_assets
      FROM assets WHERE creator_id=?`).bind(creatorId).first<{ assets: number; previews: number | null; available_assets: number | null }>(),
    DB.prepare(`SELECT oa.platform,oa.label,oa.connection_status,oa.publishing_authority,oa.warning_level,oa.warning_message,oa.last_success_at,
      pc.status AS provider_status,pc.last_error AS provider_error,
      EXISTS(SELECT 1 FROM service_principal_creator_grants g WHERE g.creator_id=oa.creator_id AND g.status='active') AS service_granted
      FROM operational_accounts oa LEFT JOIN provider_connections pc ON pc.creator_id=oa.creator_id AND pc.service=oa.platform
      WHERE oa.creator_id=? ORDER BY oa.platform,oa.label`).bind(creatorId).all<AccountHealthRow>(),
    DB.prepare("SELECT COUNT(*) AS threads,COUNT(DISTINCT connection_id) AS connections FROM message_threads WHERE creator_id=?").bind(creatorId).first<{ threads: number; connections: number }>(),
    DB.prepare(`SELECT SUM(CASE WHEN status IN ('draft','scheduled','publishing') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published
      FROM social_posts WHERE creator_id=?`).bind(creatorId).first<{ pending: number | null; failed: number | null; published: number | null }>(),
    DB.prepare(`SELECT id,domain,code,severity,summary,remediation,last_observed_at
      FROM creator_exceptions WHERE creator_id=? AND status='open'
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,last_observed_at DESC LIMIT 8`).bind(creatorId).all<{ id: string; domain: string; code: string; severity: string; summary: string; remediation: string; last_observed_at: string }>(),
  ]);
  const integrations = accounts.results.map((account) => ({
    platform: account.platform,
    label: account.label,
    state: integrationState(account),
    configured: true,
    authenticated: account.provider_status === "active" || account.connection_status === "connected",
    serviceGranted: Boolean(account.service_granted),
    lastSuccessAt: account.last_success_at,
    currentError: account.warning_message || account.provider_error || null,
    reconnectRequired: account.connection_status === "needs_reconnection" || account.provider_status === "expired",
  }));
  return { creator, library, integrations, messages, publishing, exceptions: exceptions.results };
}
