export type TimingMedia = {
  published_at: string;
  media_product_type: string;
  media_type: string;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  total_interactions: number | null;
};

export type TimingRecommendation = {
  weekday: number;
  weekdayLabel: string;
  hour: number;
  label: string;
  score: number;
  confidence: "early" | "building" | "strong";
  sampleSize: number;
  reason: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const weekdayName = parts.find((part) => part.type === "weekday")?.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName || "");
  return { weekday: Math.max(0, weekday), hour: Number(parts.find((part) => part.type === "hour")?.value || 0) };
}

function maxOrOne(values: number[]) {
  return Math.max(1, ...values.filter(Number.isFinite));
}

function performanceValue(item: TimingMedia, maxima: { exposure: number; engagement: number }) {
  const exposure = Math.max(item.reach || 0, item.views || 0);
  const engagement = item.total_interactions ?? ((item.likes || 0) + (item.comments || 0) * 2 + (item.saves || 0) * 3 + (item.shares || 0) * 3);
  return (exposure / maxima.exposure) * 0.55 + (engagement / maxima.engagement) * 0.45;
}

export function calculateInstagramTiming(input: {
  media: TimingMedia[];
  followerActivity: Array<Record<string, number>>;
  timeZone?: string;
  limit?: number;
}) {
  const timeZone = input.timeZone || "Australia/Perth";
  const exposures = input.media.map((item) => Math.max(item.reach || 0, item.views || 0));
  const engagements = input.media.map((item) => item.total_interactions ?? ((item.likes || 0) + (item.comments || 0) * 2 + (item.saves || 0) * 3 + (item.shares || 0) * 3));
  const maxima = { exposure: maxOrOne(exposures), engagement: maxOrOne(engagements) };
  const postBuckets = new Map<string, number[]>();
  for (const item of input.media) {
    if (!Number.isFinite(new Date(item.published_at).getTime())) continue;
    const { weekday, hour } = localParts(item.published_at, timeZone);
    const key = `${weekday}:${hour}`;
    postBuckets.set(key, [...(postBuckets.get(key) || []), performanceValue(item, maxima)]);
  }
  const hourTotals = Array.from({ length: 24 }, (_, hour) => input.followerActivity.reduce((sum, snapshot) => sum + Number(snapshot[String(hour)] || 0), 0));
  const maxFollowers = maxOrOne(hourTotals);
  const hasActivity = hourTotals.some((value) => value > 0);
  const slots: TimingRecommendation[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const samples = postBuckets.get(`${weekday}:${hour}`) || [];
      const performance = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
      const activity = hourTotals[hour] / maxFollowers;
      const score = hasActivity ? activity * 0.7 + performance * 0.3 : performance;
      if (score <= 0) continue;
      const confidence = input.media.length >= 25 && input.followerActivity.length >= 2 ? "strong" : input.media.length >= 8 || hasActivity ? "building" : "early";
      const time = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hour)));
      slots.push({
        weekday,
        weekdayLabel: WEEKDAYS[weekday],
        hour,
        label: `${WEEKDAYS[weekday]} · ${time}`,
        score: Math.round(score * 100),
        confidence,
        sampleSize: samples.length,
        reason: samples.length
          ? `${samples.length} historical post${samples.length === 1 ? "" : "s"} in this window${hasActivity ? " plus follower activity" : ""}.`
          : "Recommended from follower activity; post-history evidence is still building.",
      });
    }
  }
  return {
    recommendations: slots.sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize).slice(0, input.limit || 5),
    confidence: input.media.length >= 25 && input.followerActivity.length >= 2 ? "strong" as const : input.media.length >= 8 || hasActivity ? "building" as const : "early" as const,
    mediaCount: input.media.length,
    activitySnapshots: input.followerActivity.length,
    hasFollowerActivity: hasActivity,
    timeZone,
  };
}

export function findNextRecommendedSlot(input: {
  recommendations: TimingRecommendation[];
  occupied: string[];
  now?: Date;
  timeZone?: string;
  minimumSpacingHours?: number;
}) {
  const now = input.now || new Date();
  const timeZone = input.timeZone || "Australia/Perth";
  const spacingMs = (input.minimumSpacingHours ?? 4) * 3_600_000;
  const occupied = input.occupied.map((value) => new Date(value).getTime()).filter(Number.isFinite);
  const candidates: Array<{ date: Date; recommendation: TimingRecommendation; utility: number }> = [];
  for (const recommendation of input.recommendations) {
    const cursor = new Date(now.getTime());
    cursor.setUTCMinutes(0, 0, 0);
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    for (let offset = 0; offset < 24 * 21; offset += 1) {
      const candidate = new Date(cursor.getTime() + offset * 3_600_000);
      const parts = localParts(candidate.toISOString(), timeZone);
      if (parts.weekday !== recommendation.weekday || parts.hour !== recommendation.hour) continue;
      if (occupied.some((time) => Math.abs(time - candidate.getTime()) < spacingMs)) continue;
      const daysAway = (candidate.getTime() - now.getTime()) / 86_400_000;
      candidates.push({ date: candidate, recommendation, utility: recommendation.score - daysAway * 4 });
      break;
    }
  }
  return candidates.sort((a, b) => b.utility - a.utility || a.date.getTime() - b.date.getTime())[0] || null;
}
