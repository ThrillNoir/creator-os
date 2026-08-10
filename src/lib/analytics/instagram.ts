import "server-only";

import {
  completeInstagramAnalyticsSync,
  captureInstagramOutcomeSnapshots,
  failInstagramAnalyticsSync,
  getPlatformConnections,
  startInstagramAnalyticsSync,
  type InstagramMediaAnalyticsInput,
} from "@/lib/db";
import { executeComposioTool } from "@/lib/integrations/composio";

type MediaItem = {
  id?: string; caption?: string; media_type?: string; media_product_type?: string;
  permalink?: string; timestamp?: string; like_count?: number; comments_count?: number;
  total_like_count?: number; total_comments_count?: number; total_views_count?: number;
  saved_count?: number; shares_count?: number; reposts_count?: number; view_count?: number;
};

type InsightMetric = { name?: string; values?: Array<{ value?: number | Record<string, number>; end_time?: string }>; total_value?: { value?: number | Record<string, number> } };

function metricsFrom(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const object = value as { data?: unknown; result?: unknown };
  if (Array.isArray(object.data)) return object.data as InsightMetric[];
  if (object.result && typeof object.result === "object" && Array.isArray((object.result as { data?: unknown }).data)) return (object.result as { data: InsightMetric[] }).data;
  return [];
}

function metricNumber(metrics: InsightMetric[], name: string) {
  const metric = metrics.find((item) => item.name === name);
  const value = metric?.total_value?.value ?? metric?.values?.[0]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function followerActivityFrom(value: unknown) {
  return metricsFrom(value).filter((item) => item.name === "online_followers").flatMap((metric) =>
    (metric.values || []).flatMap((entry) => {
      if (!entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) return [];
      const hourly = Object.fromEntries(Object.entries(entry.value).filter(([, count]) => Number.isFinite(Number(count))).map(([hour, count]) => [hour, Number(count)]));
      return Object.keys(hourly).length ? [{ observedAt: entry.end_time || new Date().toISOString(), hourly }] : [];
    }),
  );
}

async function getMediaInsights(connectedAccountId: string, entityId: string, mediaId: string) {
  const metricSets = [
    ["reach", "views", "saved", "likes", "comments", "shares", "total_interactions", "reposts"],
    ["reach", "saved", "likes", "comments", "shares", "total_interactions"],
  ];
  for (const metric of metricSets) {
    try {
      const response = await executeComposioTool<unknown>({ slug: "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", connectedAccountId, entityId, arguments: { ig_media_id: mediaId, metric, period: "lifetime" } });
      return metricsFrom(response);
    } catch {
      // Media types and post ages expose different metric sets; try the conservative set.
    }
  }
  return [];
}

export async function syncInstagramAnalytics(creatorId: string) {
  const connection = getPlatformConnections(creatorId).find((item) => item.provider === "composio_instagram" && item.status === "connected" && item.identity_confirmed_at);
  if (!connection?.external_account_id) throw new Error("Connect and verify the creator's Instagram account first.");
  const metadata = JSON.parse(connection.provider_metadata || "{}") as { connectedAccountId?: string };
  if (!metadata.connectedAccountId) throw new Error("The Instagram Composio connection is incomplete.");
  const syncId = startInstagramAnalyticsSync(creatorId, connection.account_id);
  const entityId = `creator-os:${creatorId}:${connection.account_id}`;
  try {
    const followerResponse = await executeComposioTool<unknown>({
      slug: "INSTAGRAM_GET_USER_INSIGHTS", connectedAccountId: metadata.connectedAccountId, entityId,
      arguments: { ig_user_id: connection.external_account_id, metric: ["online_followers"], period: "lifetime" },
    });
    const followerActivity = followerActivityFrom(followerResponse);
    const since = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);
    const media: MediaItem[] = [];
    let after = "";
    for (let page = 0; page < 4 && media.length < 100; page += 1) {
      const response = await executeComposioTool<{ data?: MediaItem[]; paging?: { cursors?: { after?: string } } }>({
        slug: "INSTAGRAM_GET_IG_USER_MEDIA", connectedAccountId: metadata.connectedAccountId, entityId,
        arguments: {
          ig_user_id: connection.external_account_id, limit: 25, since,
          fields: "id,caption,media_type,media_product_type,permalink,timestamp,username,like_count,comments_count,total_like_count,total_comments_count,total_views_count,saved_count,shares_count,reposts_count,view_count",
          ...(after ? { after } : {}),
        },
      });
      const pageMedia = response.data || [];
      media.push(...pageMedia);
      const next = response.paging?.cursors?.after || "";
      if (!next || !pageMedia.length || next === after) break;
      after = next;
    }
    const records: InstagramMediaAnalyticsInput[] = [];
    let insightCount = 0;
    for (let index = 0; index < media.length; index += 4) {
      const batch = media.slice(index, index + 4);
      const insights = await Promise.all(batch.map((item) => item.id ? getMediaInsights(metadata.connectedAccountId!, entityId, item.id) : Promise.resolve([])));
      for (const [batchIndex, item] of batch.entries()) {
        if (!item.id || !item.timestamp) continue;
        const itemInsights = insights[batchIndex];
        if (itemInsights.length) insightCount += 1;
        records.push({
          mediaId: item.id, caption: item.caption || "", mediaType: item.media_type || "",
          mediaProductType: item.media_product_type || "", permalink: item.permalink || "",
          publishedAt: item.timestamp,
          likes: metricNumber(itemInsights, "likes") ?? item.like_count ?? item.total_like_count ?? null,
          comments: metricNumber(itemInsights, "comments") ?? item.comments_count ?? item.total_comments_count ?? null,
          reach: metricNumber(itemInsights, "reach"),
          views: metricNumber(itemInsights, "views") ?? item.view_count ?? item.total_views_count ?? null,
          saves: metricNumber(itemInsights, "saved") ?? item.saved_count ?? null,
          shares: metricNumber(itemInsights, "shares") ?? item.shares_count ?? null,
          totalInteractions: metricNumber(itemInsights, "total_interactions"),
          reposts: metricNumber(itemInsights, "reposts") ?? item.reposts_count ?? null,
          rawJson: JSON.stringify({ media: item, insights: itemInsights }),
        });
      }
    }
    completeInstagramAnalyticsSync({ syncId, creatorId, accountId: connection.account_id, media: records, followerActivity, insightCount });
    const outcomeSnapshots = captureInstagramOutcomeSnapshots(creatorId);
    return { mediaCount: records.length, insightCount, activitySnapshots: followerActivity.length, outcomeSnapshots };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram analytics sync failed.";
    failInstagramAnalyticsSync(syncId, creatorId, message);
    throw new Error(message);
  }
}
