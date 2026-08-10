export type Platform = "instagram" | "facebook" | "threads" | "tiktok" | "youtube" | "x" | "reddit" | "onlyfans" | "fansly" | "myroomz";
export type AssetStatus = "imported" | "draft" | "needs_approval" | "approved" | "scheduled" | "published";
export type PublishingMode = "direct_api" | "finish_on_device" | "desktop_assisted";

export interface Person {
  id: string;
  displayName: string;
  socialTags: Partial<Record<Platform, string>>;
  consentStatus: "not_required" | "requested" | "confirmed" | "expired";
}

export interface CreatorAccount {
  id: string;
  creatorId: string;
  label: string;
  platform: Platform;
  handle: string;
  publishingMode: PublishingMode;
}

export interface ContentAsset {
  id: string;
  creatorId: string;
  kind: "photo" | "video";
  sourcePath: string;
  title: string;
  creatorNotes?: string;
  peopleIds: string[];
  targetAccountIds: string[];
  status: AssetStatus;
  approvedBy?: string;
  approvedAt?: string;
}

export interface ResearchFinding {
  id: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  summary: string;
  appliesTo: Platform[];
  confidence: "low" | "medium" | "high";
  expiresAt?: string;
}

export interface CreatorVoiceProfile {
  creatorId: string;
  perspective: "first_person" | "brand_voice" | "manager_voice";
  approvedExamples: string[];
  phrasesToAvoid: string[];
  spelling: "australian" | "british" | "american";
  emojiStyle: "none" | "light" | "expressive";
  hashtagStyle: "none" | "minimal" | "platform_specific";
  notes: string[];
  updatedAt: string;
}

export interface CaptionDraft {
  id: string;
  assetId: string;
  accountId: string;
  voiceProfileVersion: string;
  researchFindingIds: string[];
  creatorContext: string;
  text: string;
  status: "draft" | "needs_approval" | "approved" | "rejected";
  generatedBy: "managing_agent" | "human";
  humanEdits?: string;
}
