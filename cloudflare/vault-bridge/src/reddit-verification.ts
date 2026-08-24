export type RedditPublicPost = {
  id?: string; name?: string; author?: string; subreddit?: string; title?: string; is_self?: boolean;
  is_gallery?: boolean; is_video?: boolean; is_reddit_media_domain?: boolean; post_hint?: string;
  domain?: string; url_overridden_by_dest?: string; media_metadata?: Record<string, unknown>;
  media?: { reddit_video?: { fallback_url?: string } } | null;
};

function normaliseHandle(value: string) {
  return value.trim().replace(/^u\//i, "").replace(/^@/, "").toLowerCase();
}

export function redditHasNativeMedia(post: RedditPublicPost) {
  if (post.is_self === true) return false;
  if (post.is_reddit_media_domain === true && (post.post_hint === "image" || post.is_gallery === true || post.is_video === true)) return true;
  if (post.is_gallery === true && post.media_metadata && Object.keys(post.media_metadata).length > 0) return true;
  if (post.is_video === true && Boolean(post.media?.reddit_video?.fallback_url)) return true;
  try {
    const hostname = new URL(post.url_overridden_by_dest ?? "").hostname.toLowerCase();
    return hostname === "i.redd.it" || hostname === "v.redd.it";
  } catch { return false; }
}

export function verifyRedditPostMetadata(
  published: RedditPublicPost,
  externalId: string,
  expected: { title: string; expected_handle: string; community_name: string },
) {
  if (String(published.id ?? "").toLowerCase() !== externalId.toLowerCase()) throw new Error("Reddit did not return the submitted post metadata.");
  if (normaliseHandle(published.author ?? "") !== normaliseHandle(expected.expected_handle)) throw new Error("Reddit returned a post from a different account.");
  if (String(published.subreddit ?? "").toLowerCase() !== expected.community_name.toLowerCase()) throw new Error("Reddit returned a post from a different community.");
  if (String(published.title ?? "").trim() !== expected.title.trim()) throw new Error("Reddit returned a post with a different title.");
  return { published, nativeMedia: redditHasNativeMedia(published) };
}
