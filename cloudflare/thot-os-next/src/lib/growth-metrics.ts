export type InsightConfidence = "insufficient" | "early" | "building" | "strong";

export type InstagramOfficialObservation = {
  media_id: string;
  permalink: string | null;
  media_type: string | null;
  media_product_type: string | null;
  published_at: string | null;
  like_count: number | null;
  comments_count: number | null;
  view_count: number | null;
  saved_count: number | null;
  shares_count: number | null;
  collected_at: string;
  source: "instagram_api" | "creator_import" | string;
};

export type GrowthEvidence = {
  source: "instagram_api";
  sourceLabel: string;
  sourceUrl: string | null;
  observedAt: string | null;
  mediaCount: number;
  completeMetricMedia: number;
  sampleSize: number;
  weightedEngagementRatePercent: number | null;
  comparisonRatePercent: number | null;
};

export type GrowthRecommendation = {
  id: "refresh_official_data" | "metric_coverage" | "insufficient_sample" | "format_validation" | "format_repeat" | "no_format_signal";
  category: "data_quality" | "format";
  title: string;
  summary: string;
  confidence: InsightConfidence;
  evidence: GrowthEvidence;
  recheckAt: string | null;
  actionBoundary: "human_review_only";
};

export type GrowthInsights = {
  generatedAt: string;
  metricDefinition: string;
  summary: {
    officialMedia: number;
    completeMetricMedia: number;
    metricCoveragePercent: number | null;
    latestObservedAt: string | null;
    confidence: InsightConfidence;
    dataQuality: Array<"official" | "incomplete" | "stale" | "unavailable">;
  };
  recommendations: GrowthRecommendation[];
};

type ScoredMedia = InstagramOfficialObservation & {
  weightedEngagementRate: number;
  format: string;
};

const MINIMUM_SAMPLE = 6;
const MINIMUM_FORMAT_SAMPLE = 3;
const STALE_AFTER_DAYS = 14;
const RECHECK_AFTER_DAYS = 7;
const MEANINGFUL_LIFT = 0.15;

function observationTime(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function afterDays(value: string | null, days: number) {
  const timestamp = observationTime(value);
  return timestamp === null ? null : new Date(timestamp + days * 86_400_000).toISOString();
}

function latestByMedia(observations: InstagramOfficialObservation[]) {
  const latest = new Map<string, InstagramOfficialObservation>();
  for (const item of observations) {
    const previous = latest.get(item.media_id);
    if (!previous || (observationTime(item.collected_at) ?? -Infinity) > (observationTime(previous.collected_at) ?? -Infinity)) latest.set(item.media_id, item);
  }
  return [...latest.values()];
}

function latestObservation(observations: InstagramOfficialObservation[]) {
  return observations.reduce<InstagramOfficialObservation | null>((current, item) => {
    if (!current || (observationTime(item.collected_at) ?? -Infinity) > (observationTime(current.collected_at) ?? -Infinity)) return item;
    return current;
  }, null);
}

function nonNegative(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatLabel(observation: InstagramOfficialObservation) {
  const raw = (observation.media_product_type || observation.media_type || "unknown").trim().toUpperCase();
  if (["REEL", "REELS"].includes(raw)) return "Reels";
  if (["FEED", "IMAGE", "CAROUSEL_ALBUM", "CAROUSEL"].includes(raw)) return "Feed posts";
  if (["STORY", "STORIES"].includes(raw)) return "Stories";
  return raw ? raw.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) : "Unknown format";
}

function scoredMedia(observation: InstagramOfficialObservation): ScoredMedia | null {
  const views = nonNegative(observation.view_count);
  const likes = nonNegative(observation.like_count);
  const comments = nonNegative(observation.comments_count);
  const saves = nonNegative(observation.saved_count);
  const shares = nonNegative(observation.shares_count);
  if (views === null || views === 0 || likes === null || comments === null || saves === null || shares === null) return null;
  const weightedActions = likes + comments * 2 + saves * 3 + shares * 3;
  return { ...observation, weightedEngagementRate: weightedActions / views, format: formatLabel(observation) };
}

function confidenceFor(sampleSize: number): InsightConfidence {
  if (sampleSize < MINIMUM_SAMPLE) return "insufficient";
  if (sampleSize < 12) return "early";
  if (sampleSize < 24) return "building";
  return "strong";
}

function percent(value: number | null) {
  return value === null ? null : Math.round(value * 10_000) / 100;
}

function officialInstagramPermalink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "instagram.com" || host.endsWith(".instagram.com")) ? url.toString() : null;
  } catch {
    return null;
  }
}

function evidence(input: {
  latest: InstagramOfficialObservation | null;
  officialMedia: number;
  completeMetricMedia: number;
  sampleSize: number;
  rate?: number | null;
  comparisonRate?: number | null;
}): GrowthEvidence {
  return {
    source: "instagram_api",
    sourceLabel: "Official Instagram insights",
    sourceUrl: officialInstagramPermalink(input.latest?.permalink ?? null),
    observedAt: input.latest?.collected_at ?? null,
    mediaCount: input.officialMedia,
    completeMetricMedia: input.completeMetricMedia,
    sampleSize: input.sampleSize,
    weightedEngagementRatePercent: percent(input.rate ?? null),
    comparisonRatePercent: percent(input.comparisonRate ?? null),
  };
}

export function buildGrowthInsights(input: { observations: InstagramOfficialObservation[]; generatedAt?: string }): GrowthInsights {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const official = latestByMedia(input.observations.filter((item) => item.source === "instagram_api"));
  const latest = latestObservation(official);
  const scored = official.map(scoredMedia).filter((item): item is ScoredMedia => item !== null);
  const confidence = confidenceFor(scored.length);
  const latestObservedAt = latest?.collected_at ?? null;
  const recheckAt = afterDays(latestObservedAt, RECHECK_AFTER_DAYS);
  const recommendations: GrowthRecommendation[] = [];
  const baseEvidence = evidence({ latest, officialMedia: official.length, completeMetricMedia: scored.length, sampleSize: scored.length });
  const latestTimestamp = observationTime(latestObservedAt);
  const generatedTimestamp = observationTime(generatedAt);
  const dataQuality: GrowthInsights["summary"]["dataQuality"] = !official.length
    ? ["unavailable"]
    : [
      "official",
      ...(scored.length < official.length ? ["incomplete" as const] : []),
      ...(latestTimestamp !== null && generatedTimestamp !== null && generatedTimestamp - latestTimestamp > STALE_AFTER_DAYS * 86_400_000 ? ["stale" as const] : []),
    ];

  if (!official.length) {
    recommendations.push({
      id: "insufficient_sample",
      category: "data_quality",
      title: "Collect an official Instagram observation",
      summary: "No approved Instagram API metrics are available for this creator yet. Connect or refresh the verified account before drawing a growth conclusion; THOT OS will not estimate missing performance.",
      confidence: "insufficient",
      evidence: baseEvidence,
      recheckAt: null,
      actionBoundary: "human_review_only",
    });
  } else {
    if (latestTimestamp !== null && generatedTimestamp !== null && generatedTimestamp - latestTimestamp > STALE_AFTER_DAYS * 86_400_000) {
      recommendations.push({
        id: "refresh_official_data",
        category: "data_quality",
        title: "Refresh the official Instagram observation",
        summary: `The latest approved observation is more than ${STALE_AFTER_DAYS} days old. Refresh the verified account before using this evidence to change a content plan.`,
        confidence: "strong",
        evidence: baseEvidence,
        recheckAt,
        actionBoundary: "human_review_only",
      });
    }
    if (scored.length < official.length) {
      recommendations.push({
        id: "metric_coverage",
        category: "data_quality",
        title: "Keep incomplete metrics unavailable",
        summary: `${official.length - scored.length} official media observation${official.length - scored.length === 1 ? " is" : "s are"} missing views or one or more engagement fields. Those rows are excluded from the comparison instead of being treated as zero.`,
        confidence: "strong",
        evidence: baseEvidence,
        recheckAt,
        actionBoundary: "human_review_only",
      });
    }

    if (scored.length < MINIMUM_SAMPLE) {
      recommendations.push({
        id: "insufficient_sample",
        category: "data_quality",
        title: "Collect more evidence before changing the plan",
        summary: `${scored.length} media item${scored.length === 1 ? " has" : "s have"} a complete official metric set. At least ${MINIMUM_SAMPLE} are required before THOT OS compares formats, so no content direction is claimed yet.`,
        confidence: "insufficient",
        evidence: baseEvidence,
        recheckAt,
        actionBoundary: "human_review_only",
      });
    } else {
      const overallRate = scored.reduce((sum, item) => sum + item.weightedEngagementRate, 0) / scored.length;
      const formatGroups = new Map<string, ScoredMedia[]>();
      for (const item of scored) formatGroups.set(item.format, [...(formatGroups.get(item.format) ?? []), item]);
      const rankedFormats = [...formatGroups.entries()]
        .filter(([, items]) => items.length >= MINIMUM_FORMAT_SAMPLE)
        .map(([format, items]) => ({ format, items, rate: items.reduce((sum, item) => sum + item.weightedEngagementRate, 0) / items.length }))
        .sort((left, right) => right.rate - left.rate || right.items.length - left.items.length);
      const leader = rankedFormats[0];
      const lift = leader && overallRate > 0 ? leader.rate / overallRate - 1 : 0;
      if (leader && lift >= MEANINGFUL_LIFT) {
        const recommendationConfidence = confidenceFor(scored.length);
        const id = recommendationConfidence === "early" ? "format_validation" : "format_repeat";
        recommendations.push({
          id,
          category: "format",
          title: recommendationConfidence === "early" ? `Validate the ${leader.format} signal` : `Prepare another ${leader.format} candidate for human review`,
          summary: `${leader.format} has a ${percent(leader.rate)}% weighted engagement rate across ${leader.items.length} fully observed item${leader.items.length === 1 ? "" : "s"}, compared with ${percent(overallRate)}% across the complete creator sample. This is an observed pattern, not a prediction. It never schedules, publishes or approves a post.`,
          confidence: recommendationConfidence,
          evidence: evidence({ latest, officialMedia: official.length, completeMetricMedia: scored.length, sampleSize: leader.items.length, rate: leader.rate, comparisonRate: overallRate }),
          recheckAt,
          actionBoundary: "human_review_only",
        });
      } else {
        recommendations.push({
          id: "no_format_signal",
          category: "format",
          title: "No repeatable format signal yet",
          summary: `The complete official sample does not show a format at least ${Math.round(MEANINGFUL_LIFT * 100)}% above the creator's current weighted engagement baseline. Keep collecting comparable observations instead of changing the publishing plan on weak evidence.`,
          confidence,
          evidence: evidence({ latest, officialMedia: official.length, completeMetricMedia: scored.length, sampleSize: scored.length, rate: overallRate }),
          recheckAt,
          actionBoundary: "human_review_only",
        });
      }
    }
  }

  return {
    generatedAt,
    metricDefinition: "Weighted engagement rate = (likes + 2 × comments + 3 × saves + 3 × shares) ÷ views. A rate is shown only when every component is returned by the official API.",
    summary: {
      officialMedia: official.length,
      completeMetricMedia: scored.length,
      metricCoveragePercent: official.length ? Math.round((scored.length / official.length) * 100) : null,
      latestObservedAt,
      confidence,
      dataQuality,
    },
    recommendations,
  };
}
