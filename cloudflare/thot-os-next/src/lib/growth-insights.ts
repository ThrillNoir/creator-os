import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { buildGrowthInsights, type InstagramOfficialObservation } from "./growth-metrics";

export { buildGrowthInsights, type GrowthInsights, type GrowthRecommendation, type InsightConfidence, type InstagramOfficialObservation } from "./growth-metrics";

export async function getGrowthInsights(creatorId: string) {
  const { DB } = cloudflareEnv();
  const observations = await creatorPrepare(DB, creatorId, `
    WITH latest_media_observations AS (
      SELECT media_id,MAX(collected_at) AS collected_at
      FROM instagram_media_metric_observations
      WHERE creator_id=@creator AND source='instagram_api'
      GROUP BY media_id
    )
    SELECT o.media_id,o.permalink,o.media_type,o.media_product_type,o.published_at,
      o.like_count,o.comments_count,o.view_count,o.saved_count,o.shares_count,o.collected_at,o.source
    FROM instagram_media_metric_observations o
    JOIN latest_media_observations latest ON latest.media_id=o.media_id AND latest.collected_at=o.collected_at
    WHERE o.creator_id=@creator AND o.source='instagram_api'
    ORDER BY COALESCE(o.published_at,o.collected_at) DESC
    LIMIT 250
  `).all<InstagramOfficialObservation>();
  return buildGrowthInsights({ observations: observations.results });
}
