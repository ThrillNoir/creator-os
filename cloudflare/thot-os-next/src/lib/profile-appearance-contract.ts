/**
 * The profile appearance contract is intentionally framework-free so the
 * dashboard, safe public Worker, and adult gateway can validate and render the
 * exact same bounded values. It must never accept CSS, class names, URLs, or
 * executable content from creators.
 */
export const PROFILE_THEME_KEYS = [
  "thot-noir",
  "soft-pearl",
  "candy-pink",
  "lavender-dream",
  "sunset",
  "ocean",
  "forest",
  "crimson",
  "chrome",
  "clean-minimal",
] as const;

export const PROFILE_BUTTON_STYLES = [
  "solid-rounded",
  "full-pill",
  "minimal-outline",
  "soft-card-icon",
  "elevated-shadow-tile",
] as const;

export const PROFILE_BACKGROUND_MODES = ["solid", "gradient"] as const;
export const PROFILE_RADIUS_SCALES = ["compact", "comfortable", "round"] as const;

export type ProfileThemeKey = typeof PROFILE_THEME_KEYS[number];
export type ProfileButtonStyle = typeof PROFILE_BUTTON_STYLES[number];
export type ProfileBackgroundMode = typeof PROFILE_BACKGROUND_MODES[number];
export type ProfileRadiusScale = typeof PROFILE_RADIUS_SCALES[number];

export type ProfileAppearance = {
  themeKey: ProfileThemeKey;
  buttonStyle: ProfileButtonStyle;
  backgroundMode: ProfileBackgroundMode;
  backgroundColor: string;
  primaryColor: string;
  textColor: string;
  cardColor: string;
  radiusScale: ProfileRadiusScale;
  inheritSfwTheme: boolean;
};

export const PROFILE_THEMES: ReadonlyArray<ProfileAppearance & { name: string }> = [
  { name: "THOT Noir", themeKey: "thot-noir", buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#0c0911", primaryColor: "#7655f6", textColor: "#f8f5ff", cardColor: "#211a29", radiusScale: "comfortable", inheritSfwTheme: false },
  { name: "Soft Pearl", themeKey: "soft-pearl", buttonStyle: "soft-card-icon", backgroundMode: "solid", backgroundColor: "#f6f2ee", primaryColor: "#7d5f72", textColor: "#261d23", cardColor: "#ffffff", radiusScale: "comfortable", inheritSfwTheme: false },
  { name: "Candy Pink", themeKey: "candy-pink", buttonStyle: "full-pill", backgroundMode: "gradient", backgroundColor: "#3a102c", primaryColor: "#ff74b6", textColor: "#fff6fb", cardColor: "#5b1b46", radiusScale: "round", inheritSfwTheme: false },
  { name: "Lavender Dream", themeKey: "lavender-dream", buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#201637", primaryColor: "#b99cff", textColor: "#faf7ff", cardColor: "#352453", radiusScale: "round", inheritSfwTheme: false },
  { name: "Sunset", themeKey: "sunset", buttonStyle: "elevated-shadow-tile", backgroundMode: "gradient", backgroundColor: "#351715", primaryColor: "#ff9a62", textColor: "#fff8f4", cardColor: "#54211c", radiusScale: "comfortable", inheritSfwTheme: false },
  { name: "Ocean", themeKey: "ocean", buttonStyle: "minimal-outline", backgroundMode: "gradient", backgroundColor: "#082b3a", primaryColor: "#58c8e8", textColor: "#effcff", cardColor: "#0c465d", radiusScale: "comfortable", inheritSfwTheme: false },
  { name: "Forest", themeKey: "forest", buttonStyle: "soft-card-icon", backgroundMode: "gradient", backgroundColor: "#112c24", primaryColor: "#8bd49a", textColor: "#f2fff5", cardColor: "#1b4437", radiusScale: "compact", inheritSfwTheme: false },
  { name: "Crimson", themeKey: "crimson", buttonStyle: "elevated-shadow-tile", backgroundMode: "solid", backgroundColor: "#300d17", primaryColor: "#ee5f76", textColor: "#fff5f7", cardColor: "#541724", radiusScale: "comfortable", inheritSfwTheme: false },
  { name: "Chrome", themeKey: "chrome", buttonStyle: "minimal-outline", backgroundMode: "solid", backgroundColor: "#17191d", primaryColor: "#c7cbd3", textColor: "#f5f7fa", cardColor: "#25282e", radiusScale: "compact", inheritSfwTheme: false },
  { name: "Clean Minimal", themeKey: "clean-minimal", buttonStyle: "solid-rounded", backgroundMode: "solid", backgroundColor: "#ffffff", primaryColor: "#222222", textColor: "#161616", cardColor: "#f4f4f2", radiusScale: "compact", inheritSfwTheme: false },
];

const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_PROFILE_APPEARANCE: ProfileAppearance = { ...PROFILE_THEMES[0] };

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function component(hex: string, index: number) { return Number.parseInt(hex.slice(index, index + 2), 16) / 255; }
function luminance(hex: string) {
  const linear = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(component(hex, 1)) + 0.7152 * linear(component(hex, 3)) + 0.0722 * linear(component(hex, 5));
}

export function contrastRatio(first: string, second: string) {
  if (!isHexColor(first) || !isHexColor(second)) return 0;
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T[number];
  throw new Error("The requested profile appearance is not supported.");
}

export function appearanceForTheme(themeKey: ProfileThemeKey): ProfileAppearance {
  const theme = PROFILE_THEMES.find((candidate) => candidate.themeKey === themeKey) ?? PROFILE_THEMES[0];
  return { themeKey: theme.themeKey, buttonStyle: theme.buttonStyle, backgroundMode: theme.backgroundMode, backgroundColor: theme.backgroundColor, primaryColor: theme.primaryColor, textColor: theme.textColor, cardColor: theme.cardColor, radiusScale: theme.radiusScale, inheritSfwTheme: false };
}

function color(value: unknown, fallback: string) {
  if (value === undefined || value === null || value === "") return fallback;
  if (isHexColor(value)) return value.toLowerCase();
  throw new Error("Profile colours must use a six-digit hex value.");
}

export function parseProfileAppearance(value: Partial<Record<keyof ProfileAppearance, unknown>>, { adult = false }: { adult?: boolean } = {}): ProfileAppearance {
  const themeKey = pick(value.themeKey, PROFILE_THEME_KEYS, DEFAULT_PROFILE_APPEARANCE.themeKey);
  const base = appearanceForTheme(themeKey);
  const backgroundColor = color(value.backgroundColor, base.backgroundColor);
  const primaryColor = color(value.primaryColor, base.primaryColor);
  const textColor = color(value.textColor, base.textColor);
  const cardColor = color(value.cardColor, base.cardColor);
  if (contrastRatio(backgroundColor, textColor) < 4.5 || contrastRatio(cardColor, textColor) < 3) throw new Error("Choose colours with sufficient readable contrast.");
  return {
    themeKey,
    buttonStyle: pick(value.buttonStyle, PROFILE_BUTTON_STYLES, base.buttonStyle),
    backgroundMode: pick(value.backgroundMode, PROFILE_BACKGROUND_MODES, base.backgroundMode),
    backgroundColor,
    primaryColor,
    textColor,
    cardColor,
    radiusScale: pick(value.radiusScale, PROFILE_RADIUS_SCALES, base.radiusScale),
    inheritSfwTheme: adult && value.inheritSfwTheme === true,
  };
}

export function appearanceCss(appearance: ProfileAppearance) {
  const safe = parseProfileAppearance(appearance, { adult: true });
  const radius = safe.radiusScale === "compact" ? "0.45rem" : safe.radiusScale === "round" ? "999px" : "0.85rem";
  return {
    "--profile-background": safe.backgroundColor,
    "--profile-primary": safe.primaryColor,
    "--profile-text": safe.textColor,
    "--profile-card": safe.cardColor,
    "--profile-radius": radius,
    "--profile-background-image": safe.backgroundMode === "gradient" ? `linear-gradient(145deg, ${safe.backgroundColor}, ${safe.primaryColor}33)` : "none",
  } as Record<string, string>;
}
