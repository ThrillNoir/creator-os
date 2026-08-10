export type CaptionIssue = {
  code: string;
  severity: "warning" | "blocker";
  message: string;
};

const genericPhrases = [
  "step into your power",
  "embrace your journey",
  "unleash your",
  "in a world where",
  "more than just",
  "capturing the essence",
  "elevate your",
  "dive into",
];

const platformLimits: Record<string, number> = {
  x: 280,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  reddit: 40000,
};

export function evaluateCaption(input: {
  caption: string;
  platform: string;
  phrasesToAvoid?: string;
  recentCaptions?: string[];
  allowedHandles?: string[];
}) {
  const issues: CaptionIssue[] = [];
  const caption = input.caption.trim();
  if (!caption) return [{ code: "empty", severity: "blocker", message: "No caption has been drafted." }] satisfies CaptionIssue[];

  const limit = platformLimits[input.platform];
  if (limit && caption.length > limit) issues.push({ code: "length", severity: "blocker", message: `${caption.length} characters exceeds the ${input.platform} limit used by THOT OS (${limit}).` });

  const lower = caption.toLowerCase();
  const unwanted = [
    ...genericPhrases,
    ...(input.phrasesToAvoid ?? "").split(/[\n,]/).map((phrase) => phrase.trim().toLowerCase()).filter(Boolean),
  ];
  const matched = unwanted.find((phrase) => lower.includes(phrase));
  if (matched) issues.push({ code: "voice_phrase", severity: "warning", message: `Contains a discouraged phrase: “${matched}”.` });

  const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > 8) issues.push({ code: "hashtags", severity: "warning", message: `Contains ${hashtags.length} hashtags; check that each is intentional.` });

  const handles = caption.match(/@[\p{L}\p{N}_.]+/gu) ?? [];
  const allowed = new Set((input.allowedHandles ?? []).map((handle) => handle.toLowerCase()));
  const unknownHandles = handles.filter((handle) => !allowed.has(handle.toLowerCase()));
  if (unknownHandles.length) issues.push({ code: "unknown_tags", severity: "blocker", message: `Unapproved social tags: ${unknownHandles.join(", ")}.` });

  const opening = lower.split(/\s+/).slice(0, 7).join(" ");
  const repeated = (input.recentCaptions ?? []).some((recent) => recent.toLowerCase().split(/\s+/).slice(0, 7).join(" ") === opening);
  if (opening && repeated) issues.push({ code: "repeated_opening", severity: "warning", message: "The opening repeats a recent caption." });

  return issues;
}
