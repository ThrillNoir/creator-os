export const REQUIRED_ONBOARDING_SECTION_KEYS = [
  "identity",
  "social_profiles",
  "paid_platforms",
  "brand_voice",
  "positioning",
  "about_me",
] as const;

export const OPTIONAL_ONBOARDING_SECTION_KEYS = ["chrome_access"] as const;

export const ONBOARDING_SECTION_KEYS = [...REQUIRED_ONBOARDING_SECTION_KEYS, ...OPTIONAL_ONBOARDING_SECTION_KEYS] as const;

export type OnboardingSectionRow = { section_key: string; status: string };

export function creatorContextSectionsComplete(rows: readonly OnboardingSectionRow[]) {
  return ["brand_voice", "positioning", "about_me"].every((key) => rows.find((row) => row.section_key === key)?.status === "complete");
}

export function missingRequiredOnboardingSections(rows: readonly OnboardingSectionRow[]) {
  return REQUIRED_ONBOARDING_SECTION_KEYS.filter((key) => rows.find((row) => row.section_key === key)?.status !== "complete");
}
