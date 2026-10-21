import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import type { PortfolioMediaFact } from "./portfolio-blockers";

export async function getPortfolioReleaseFacts(creatorId: string, assetIds: string[]) {
  const ids = [...new Set(assetIds)];
  if (!ids.length) return {} as Record<string, PortfolioMediaFact>;
  const marks = ids.map(() => "?").join(",");
  const rows = await creatorPrepare(cloudflareEnv().DB, creatorId, `SELECT a.id,a.extension,a.source_available,
      EXISTS(SELECT 1 FROM asset_media_authorities ma WHERE ma.asset_id=a.id AND ma.creator_id=a.creator_id
        AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed')) AS authority_ready,
      (SELECT COUNT(*) FROM asset_people ap
        LEFT JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
        LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id
          AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
        WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id
          AND (COALESCE(p.consent_status,'not_recorded')<>'recorded' OR pc.person_id IS NULL)) AS missing_consent_count,
      vp.source_codec,vp.state AS video_state,
      CASE WHEN o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
        AND o.ingest_status='verified' AND o.verified_mime_type='video/mp4'
        AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL THEN 1 ELSE 0 END AS canonical_ready,
      o.byte_count
    FROM assets a
    LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    LEFT JOIN asset_storage_objects o ON o.id=vp.canonical_storage_object_id AND o.asset_id=a.id AND o.creator_id=a.creator_id
    WHERE a.creator_id=@creator AND a.id IN (${marks})`).bind(...ids).all<PortfolioMediaFact>();
  return Object.fromEntries(rows.results.map((row) => [row.id, row])) as Record<string, PortfolioMediaFact>;
}
