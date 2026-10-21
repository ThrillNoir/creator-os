export const LIBRARY_PAGE_SIZE = 120;
export const LIBRARY_MAX_PAGE = 10_000;
export const LIBRARY_QUERY_MAX_LENGTH = 120;

export function parseLibraryPage(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, LIBRARY_MAX_PAGE);
}

export function escapeLibraryLikeQuery(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function normalizeLibraryQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, LIBRARY_QUERY_MAX_LENGTH) : "";
}

export function buildLibraryAssetsQuery(filters: { safety?: string; destination?: string; type?: string; teaser?: string; query?: string; page?: string | number } = {}, destinations: readonly string[] = [], lookahead = false) {
  const conditions = ["a.creator_id=?", "a.source_available=1", "ma.asset_id IS NOT NULL"];
  const values: unknown[] = [];
  if (filters.safety === "review") conditions.push("c.safety IS NULL");
  if (filters.safety === "sfw" || filters.safety === "nsfw") { conditions.push("c.safety=?"); values.push(filters.safety); }
  if (destinations.includes(filters.destination ?? "")) {
    conditions.push("EXISTS (SELECT 1 FROM asset_destinations fd WHERE fd.asset_id=a.id AND fd.creator_id=a.creator_id AND fd.destination=?)");
    values.push(filters.destination);
  }
  if (filters.type === "photos") conditions.push("lower(a.extension) IN ('jpg','jpeg','png','webp','heic')");
  if (filters.type === "videos") conditions.push("lower(a.extension) IN ('mp4','mov','m4v','webm')");
  if (filters.teaser === "yes") conditions.push("c.is_teaser=1");
  if (filters.teaser === "no") conditions.push("COALESCE(c.is_teaser,0)=0");
  const query = normalizeLibraryQuery(filters.query);
  if (query) {
    const like = `%${escapeLibraryLikeQuery(query)}%`;
    conditions.push(`(a.basename LIKE ? ESCAPE '\\' OR a.relative_path LIKE ? ESCAPE '\\'
      OR COALESCE(c.notes,'') LIKE ? ESCAPE '\\' OR COALESCE(a.creator_notes,'') LIKE ? ESCAPE '\\'
      OR a.id LIKE ? ESCAPE '\\')`);
    values.push(like, like, like, like, like);
  }
  const page = parseLibraryPage(filters.page);
  const limit = LIBRARY_PAGE_SIZE + (lookahead ? 1 : 0);
  const offset = (page - 1) * LIBRARY_PAGE_SIZE;
  return { sql: `
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id AND d.creator_id=a.creator_id),'') AS destinations,
      ma.authority_kind AS media_origin,
      COALESCE(vp.state,ma.state) AS media_state,
      vp.state AS video_state,vp.source_codec AS video_codec,vp.playback_provider,vp.failure_code AS playback_failure_code
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      LEFT JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY a.modified_at DESC,a.id DESC LIMIT ? OFFSET ?
  `, values, limit, offset };
}
