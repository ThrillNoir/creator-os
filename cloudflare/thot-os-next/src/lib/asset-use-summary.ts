export type AssetUseKind = "social" | "message" | "vault" | "portfolio" | "public_profile" | "adult_profile" | "download_link";

export type AssetUseEvent = {
  id: string;
  asset_id: string;
  kind: AssetUseKind;
  status: string;
  destination: string;
  account_label: string | null;
  role: string | null;
  occurred_at: string;
  external_id: string | null;
  external_url: string | null;
  metrics?: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    saves: number | null;
    shares: number | null;
    collected_at: string;
  } | null;
};

export function verifiedSocialPost(event: AssetUseEvent) {
  return event.kind === "social" && event.status === "published" && Boolean(event.external_id && safePostUrl(event.destination, event.external_url));
}

export function useLabel(event: AssetUseEvent) {
  if (event.kind === "social") {
    const destination = event.destination === "instagram" ? "Instagram" : event.destination === "reddit" ? "Reddit" : event.destination;
    if (verifiedSocialPost(event)) return `Posted to ${destination}`;
    if (event.status === "published") return `${destination} post recorded; receipt incomplete`;
    return `${destination} · ${event.status}`;
  }
  if (event.kind === "message") return event.status === "sent" ? `Sent in ${event.destination} message` : `${event.destination} message · ${event.status}`;
  if (event.kind === "vault") return event.status === "verified" ? `Uploaded to ${event.destination} vault` : `${event.destination} vault · ${event.status}`;
  if (event.kind === "portfolio") {
    const privateReference = event.role === "Linked private full video";
    return privateReference
      ? event.status === "published" ? "Referenced by More request (private video)" : event.status === "withdrawing" ? "More private reference withdrawing" : "Previous More request reference (private video)"
      : event.status === "published" ? "On More portfolio" : event.status === "withdrawing" ? "More portfolio withdrawing" : "Previous More portfolio release";
  }
  if (event.kind === "public_profile") return "On public profile";
  if (event.kind === "adult_profile") return "On protected profile";
  if (event.status === "redeemed") return "Private download link redeemed";
  return `Private download link · ${event.status}`;
}

export function assetUseSummary(events: AssetUseEvent[]) {
  const posted = events.filter(verifiedSocialPost).length;
  const vault = events.filter((event) => event.kind === "vault" && event.status === "verified").length;
  const sentMessages = events.filter((event) => event.kind === "message" && event.status === "sent").length;
  const onPage = events.filter((event) => (event.kind === "portfolio" && event.status === "published" && event.role !== "Linked private full video") || event.kind === "public_profile" || event.kind === "adult_profile").length;
  const measured = events.filter((event) => verifiedSocialPost(event) && event.metrics).length;
  const latestMeasured = events
    .filter((event) => verifiedSocialPost(event) && event.metrics)
    .sort((a, b) => b.metrics!.collected_at.localeCompare(a.metrics!.collected_at))[0];
  const parts = [
    posted ? `${posted} post${posted === 1 ? "" : "s"} with external receipt${posted === 1 ? "" : "s"}` : "",
    vault ? `${vault} verified vault upload${vault === 1 ? "" : "s"}` : "",
    sentMessages ? `${sentMessages} sent message${sentMessages === 1 ? "" : "s"}` : "",
    onPage ? `${onPage} current page placement${onPage === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return {
    headline: parts.length ? parts.join(" · ") : events.length ? "Activity recorded; no verified placement yet" : "No tracked use yet",
    result: latestMeasured?.metrics
      ? `Latest matched Instagram observation: ${latestMeasured.metrics.views === null ? "views unavailable" : `${latestMeasured.metrics.views.toLocaleString("en-AU")} views`}${latestMeasured.metrics.likes === null ? "" : ` · ${latestMeasured.metrics.likes.toLocaleString("en-AU")} likes`}. Collected ${formatUseDate(latestMeasured.metrics.collected_at)}${measured > 1 ? `; ${measured} measured posts total` : ""}.`
      : "No matched official post results yet.",
    posted,
    vault,
    sentMessages,
    onPage,
    measured,
  };
}

export function safePostUrl(platform: string, value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (platform === "instagram" && (host === "instagram.com" || host.endsWith(".instagram.com"))) return url.toString();
    if (platform === "reddit" && (host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it")) return url.toString();
  } catch { /* An invalid provider URL is shown as an incomplete receipt. */ }
  return null;
}

export function formatUseDate(value: string | null) {
  if (!value) return "Time unavailable";
  const normalized = value.replace(" ", "T");
  const parsed = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}
