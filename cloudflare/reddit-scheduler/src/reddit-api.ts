export type RedditLease = {
  uploadUrl: string;
  uploadFields: Array<{ name: string; value: string }>;
  mediaUrl: string;
};

export type RedditSubmittedPost = {
  id?: string;
  name?: string;
  author?: string;
  subreddit?: string;
  title?: string;
  permalink?: string;
  created_utc?: number;
  post_hint?: string;
  is_video?: boolean;
  domain?: string;
  url?: string;
  url_overridden_by_dest?: string;
  link_flair_template_id?: string | null;
  link_flair_text?: string | null;
};

export type RedditFlairChoice = {
  id: string;
  text: string;
  textEditable: boolean;
};

export type RedditMediaReceipt = {
  externalPostId: string;
  externalUrl: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

export function imageMimeType(filename: string, suppliedType = "") {
  const normalized = suppliedType.split(";")[0].trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  const extension = filename.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const inferred = extension ? byExtension[extension] : undefined;
  if (!inferred) throw new Error("Reddit API publishing supports JPG, PNG, GIF, and WebP images.");
  return inferred;
}

export function parseMediaLease(payload: unknown): RedditLease {
  const root = record(payload);
  const args = record(root?.args);
  const action = typeof args?.action === "string" ? args.action : "";
  const rawFields = Array.isArray(args?.fields) ? args.fields : [];
  const uploadFields = rawFields.flatMap((item) => {
    const field = record(item);
    return typeof field?.name === "string" && typeof field.value === "string"
      ? [{ name: field.name, value: field.value }]
      : [];
  });
  const key = uploadFields.find((field) => field.name === "key")?.value;
  if (!action || !key || !uploadFields.length) throw new Error("Reddit did not return a valid media upload lease.");
  const uploadUrl = action.startsWith("//") ? `https:${action}` : action;
  if (!uploadUrl.startsWith("https://")) throw new Error("Reddit returned an invalid media upload destination.");
  return { uploadUrl, uploadFields, mediaUrl: `${uploadUrl.replace(/\/$/, "")}/${key.replace(/^\//, "")}` };
}

export function redditApiErrors(payload: unknown) {
  const root = record(payload);
  const json = record(root?.json);
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.map((entry) => Array.isArray(entry) ? entry.map(String).filter(Boolean).join(": ") : String(entry)).filter(Boolean);
}

export function parseRedditPostRequirements(payload: unknown) {
  return { flairRequired: record(payload)?.is_flair_required === true };
}

export function parseRedditFlairChoices(payload: unknown): RedditFlairChoice[] {
  const choices = Array.isArray(record(payload)?.choices) ? record(payload)!.choices as unknown[] : [];
  const seen = new Set<string>();
  return choices.flatMap((entry) => {
    const choice = record(entry);
    const id = typeof choice?.flair_template_id === "string" ? choice.flair_template_id.trim() : "";
    if (!id || id.length > 64 || seen.has(id)) return [];
    seen.add(id);
    const suppliedText = typeof choice?.flair_text === "string" ? choice.flair_text.trim() : "";
    return [{ id, text: (suppliedText || "Untitled flair").slice(0, 128), textEditable: choice?.flair_text_editable === true }];
  });
}

export function redditSubmissionWebsocketUrl(payload: unknown) {
  const websocketUrl = record(record(record(payload)?.json)?.data)?.websocket_url;
  if (websocketUrl == null) return null;
  if (typeof websocketUrl !== "string") throw new Error("Reddit returned an invalid media receipt channel.");
  const url = new URL(websocketUrl);
  if (url.protocol !== "wss:" || !/(^|\.)redditmedia\.com$/i.test(url.hostname)) {
    throw new Error("Reddit returned an untrusted media receipt channel.");
  }
  return url.toString();
}

export function parseRedditMediaReceipt(message: unknown): RedditMediaReceipt {
  const decoded = typeof message === "string" ? JSON.parse(message) as unknown : message;
  const root = record(decoded);
  if (root?.type === "failed") throw new Error("Reddit failed while processing the uploaded image.");
  if (root?.type !== "success") throw new Error("Reddit returned an unknown media processing receipt.");
  const redirect = record(root.payload)?.redirect;
  if (typeof redirect !== "string") throw new Error("Reddit did not return the published post URL.");
  const url = new URL(redirect);
  const match = url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
  if (!/(^|\.)reddit\.com$/i.test(url.hostname) || !match) throw new Error("Reddit returned an invalid published post URL.");
  return { externalPostId: `t3_${match[1]}`, externalUrl: url.toString() };
}

export function findPublishedImage(input: {
  children: unknown;
  expectedAuthor: string;
  expectedCommunity: string;
  expectedTitle: string;
  submittedAfterMs: number;
  expectedFlairId?: string | null;
}) {
  const listing = record(input.children);
  const data = record(listing?.data);
  const children = Array.isArray(data?.children) ? data.children : [];
  const expectedAuthor = input.expectedAuthor.replace(/^u\//i, "").toLowerCase();
  const expectedCommunity = input.expectedCommunity.replace(/^r\//i, "").toLowerCase();
  for (const child of children) {
    const post = record(record(child)?.data) as RedditSubmittedPost | undefined;
    if (!post) continue;
    const createdAt = Number(post.created_utc || 0) * 1000;
    const mediaUrl = String(post.url_overridden_by_dest || post.url || "");
    const nativeImage = post.post_hint === "image" || /^(?:https?:\/\/)?i\.redd\.it\//i.test(mediaUrl) || post.domain === "i.redd.it";
    if (
      post.author?.toLowerCase() === expectedAuthor
      && post.subreddit?.toLowerCase() === expectedCommunity
      && post.title === input.expectedTitle
      && createdAt >= input.submittedAfterMs - 60_000
      && nativeImage
      && (!input.expectedFlairId || post.link_flair_template_id === input.expectedFlairId)
      && post.permalink
      && (post.name || post.id)
    ) return post;
  }
  return null;
}
