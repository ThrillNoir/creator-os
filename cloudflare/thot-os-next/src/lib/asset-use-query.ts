// Every branch is creator-scoped. This is a record of observed use, not a
// projection from classification/destination tags or an inferred permission.
const eventBranchesSql = `
  SELECT p.id,p.asset_id,'social' AS kind,p.status,p.platform AS destination,
    oa.label AS account_label,CASE WHEN p.platform='reddit' THEN COALESCE(rc.name,'Creator profile') ELSE NULL END AS role,
    COALESCE(p.published_at,p.scheduled_at,p.created_at) AS occurred_at,
    p.external_post_id AS external_id,p.external_url
  FROM social_posts p
  LEFT JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
  LEFT JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
  WHERE p.creator_id=@creator AND p.asset_id IS NOT NULL
  UNION ALL
  SELECT a.id,a.asset_id,'message',
    CASE WHEN m.direction='outbound' AND m.delivery_status='sent' AND m.external_message_id IS NOT NULL THEN 'sent'
      ELSE 'recorded' END,
    c.platform,c.display_name,NULL,COALESCE(m.sent_at,m.created_at),NULL,NULL
  FROM message_attachments a
  JOIN messages m ON m.id=a.message_id AND m.creator_id=a.creator_id
  JOIN message_threads t ON t.id=m.thread_id AND t.creator_id=m.creator_id
  JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
  WHERE a.creator_id=@creator AND a.asset_id IS NOT NULL AND a.status='ready' AND m.direction='outbound'
  UNION ALL
  SELECT j.id,j.asset_id,'vault',j.status,j.platform,oa.label,NULL,
    COALESCE(j.completed_at,j.created_at),NULL,NULL
  FROM vault_upload_jobs j
  LEFT JOIN operational_accounts oa ON oa.id=j.account_id AND oa.creator_id=j.creator_id
  WHERE j.creator_id=@creator
  UNION ALL
  SELECT r.id || ':' || json_extract(card.value,'$.id'),json_extract(card.value,'$.assetId'),
    'portfolio',r.status,'More portfolio',NULL,'Public preview',COALESCE(r.published_at,r.approved_at),NULL,NULL
  FROM creator_portfolio_release_versions r,json_each(r.manifest_json,'$.cards') card
  WHERE r.creator_id=@creator AND r.status IN ('published','withdrawn','withdrawing')
  UNION ALL
  SELECT r.id || ':private:' || json_extract(card.value,'$.id'),json_extract(card.value,'$.fullLengthAssetId'),
    'portfolio',r.status,'More portfolio',NULL,'Linked private full video',COALESCE(r.published_at,r.approved_at),NULL,NULL
  FROM creator_portfolio_release_versions r,json_each(r.manifest_json,'$.cards') card
  WHERE r.creator_id=@creator AND r.status IN ('published','withdrawn','withdrawing')
    AND json_extract(card.value,'$.fullLengthAssetId') IS NOT NULL
  UNION ALL
  SELECT s.id,d.asset_id,'public_profile','published','Public profile',NULL,'Profile photo',s.created_at,NULL,NULL
  FROM creator_profile_library_photo_selections s
  JOIN creator_profile_library_photo_derivatives d ON d.id=s.derivative_id AND d.creator_id=s.creator_id
  JOIN creator_public_profiles p ON p.creator_id=s.creator_id AND p.published_version_id=s.public_profile_version_id AND p.status='active'
  WHERE s.creator_id=@creator AND s.surface='public_sfw'
  UNION ALL
  SELECT s.id,d.asset_id,'adult_profile','published','Protected profile',NULL,'Profile photo',s.created_at,NULL,NULL
  FROM creator_profile_library_photo_selections s
  JOIN creator_profile_library_photo_derivatives d ON d.id=s.derivative_id AND d.creator_id=s.creator_id
  JOIN creator_adult_profiles p ON p.creator_id=s.creator_id AND p.published_version_id=s.adult_profile_version_id AND p.status='active'
  WHERE s.creator_id=@creator AND s.surface='adult_profile'
  UNION ALL
  SELECT m.id,m.asset_id,'public_profile','published','Public profile',NULL,'Legacy profile photo',m.created_at,NULL,NULL
  FROM creator_public_media m
  JOIN creator_public_profile_versions v ON v.avatar_media_id=m.id AND v.creator_id=m.creator_id
  JOIN creator_public_profiles p ON p.creator_id=m.creator_id AND p.published_version_id=v.id AND p.status='active'
  WHERE m.creator_id=@creator AND m.status='approved'
  UNION ALL
  SELECT m.id,m.asset_id,'adult_profile','published','Protected profile',NULL,'Legacy profile photo',m.created_at,NULL,NULL
  FROM creator_adult_profile_media m
  JOIN creator_adult_profiles p ON p.creator_id=m.creator_id AND p.published_version_id=m.profile_version_id AND p.status='active'
  WHERE m.creator_id=@creator AND m.enabled=1
  UNION ALL
  SELECT l.id,l.asset_id,'download_link',
    CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.redeemed_at IS NOT NULL THEN 'redeemed'
      WHEN datetime(l.expires_at)<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'created' END,
    'Private download link',NULL,NULL,COALESCE(l.redeemed_at,l.created_at),NULL,NULL
  FROM content_download_links l WHERE l.creator_id=@creator
`;

// D1's SQLite build accepts only a small number of terms in one compound
// SELECT. Nest groups of three so the outer UNION also remains below the
// limit while callers can still filter, group and page one event relation.
const branches = eventBranchesSql.split("UNION ALL");
export const useEventsSql = branches.reduce<string[]>((groups, _branch, index) => {
  if (index % 3 === 0) groups.push(`SELECT * FROM (${branches.slice(index, index + 3).join("UNION ALL")})`);
  return groups;
}, []).join(" UNION ALL ");

export function latestInstagramResultsSql(assetCount: number) {
  if (!Number.isInteger(assetCount) || assetCount < 1 || assetCount > 24) throw new Error("Asset result page size is invalid.");
  return `
    WITH ranked AS (
      SELECT p.asset_id,oa.label AS account_label,o.view_count,o.like_count,o.collected_at,
        ROW_NUMBER() OVER (PARTITION BY p.asset_id ORDER BY o.collected_at DESC,o.id DESC) AS position
      FROM social_posts p JOIN instagram_media_metric_observations o
        ON o.creator_id=p.creator_id AND o.account_id=p.account_id AND o.media_id=p.external_post_id AND o.source='instagram_api'
      LEFT JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
      WHERE p.creator_id=@creator AND p.platform='instagram' AND p.status='published' AND p.asset_id IN (${Array(assetCount).fill("?").join(",")})
    ) SELECT asset_id,account_label,view_count,like_count,collected_at FROM ranked WHERE position=1
  `;
}
