import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { buildGrowthInsights, type InstagramOfficialObservation } from "./growth-metrics";

export { buildGrowthInsights, type GrowthInsights, type GrowthRecommendation, type InsightConfidence, type InstagramOfficialObservation } from "./growth-metrics";

export async function getGrowthInsights(creatorId: string, accountId?: string) {
  const { DB } = cloudflareEnv();
  const statement = accountId
    ? creatorPrepare(DB, creatorId, `
        WITH ranked_media_observations AS (
          SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.account_id,o.media_id ORDER BY o.collected_at DESC,o.id DESC) AS observation_rank
          FROM instagram_media_metric_observations o
          WHERE o.creator_id=@creator AND o.account_id=@account AND o.source='instagram_api'
        )
        SELECT account_id,media_id,permalink,media_type,media_product_type,published_at,
          like_count,comments_count,view_count,saved_count,shares_count,collected_at,source
        FROM ranked_media_observations WHERE observation_rank=1
        ORDER BY COALESCE(published_at,collected_at) DESC
        LIMIT 250
      `).bind(accountId)
    : creatorPrepare(DB, creatorId, `
        WITH ranked_media_observations AS (
          SELECT o.*,ROW_NUMBER() OVER (
            PARTITION BY o.media_id
            ORDER BY o.collected_at DESC,(o.account_id IS NOT NULL) DESC,o.account_id DESC,o.id DESC
          ) AS observation_rank
          FROM instagram_media_metric_observations o
          WHERE o.creator_id=@creator AND o.source='instagram_api'
        )
        SELECT account_id,media_id,permalink,media_type,media_product_type,published_at,
          like_count,comments_count,view_count,saved_count,shares_count,collected_at,source
        FROM ranked_media_observations WHERE observation_rank=1
        ORDER BY COALESCE(published_at,collected_at) DESC
        LIMIT 250
      `);
  const observations = await statement.all<InstagramOfficialObservation>();
  return buildGrowthInsights({ observations: observations.results });
}
