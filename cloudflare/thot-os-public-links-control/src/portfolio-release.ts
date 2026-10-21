import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers";
import { validLivePortfolio, type LivePortfolioCard, type LivePortfolioProjection } from "../../thot-os-adult-gateway/src/portfolio.ts";
import { isShortMp4Preview } from "./mp4-preview-duration.ts";

export type PortfolioParams = { creatorId: string; versionId: string };

type ManifestCard = {
  id: string; assetId: string; previewAssetId?: string | null; fullLengthAssetId?: string | null; kind: "image" | "video";
  title: string; description: string; section: string; genre?: string;
  previewKey: string; posterKey: string | null;
};
type Manifest = { schemaVersion: 1 | 2; contact: { telegramUsername?: string; email?: string; message?: string }; cards: ManifestCard[] };
type Release = { id: string; creator_id: string; adult_profile_version_id: string; status: string; manifest_json: string; approved_by: string; slug: string; profile_status: string; published_version_id: string | null; profile_version_status: string };
type MediaSource = { key: string; bucket: "PREVIEWS" | "LIBRARY_MEDIA"; checksum?: string; etag?: string; version?: string; size?: number; mime: "image/jpeg" | "video/mp4" };

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA = /^[a-f0-9]{64}$/;
const LABEL = /^[^\u0000-\u001f\u007f<>]{1,50}$/;
const TELEGRAM = /^[A-Za-z0-9_]{5,32}$/;
// Existing approved releases may contain addresses accepted by the original contract.
// New drafts use the tighter web form validator; public mailto links encode the address.
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

function snapshotKey(slug: string) { return `adult-portfolio:${slug}`; }
function mediaKey(slug: string, version: string, card: ManifestCard, kind: "preview" | "poster") {
  return `adult-portfolio/${slug}/${version}/${card.id}/${kind}.${kind === "poster" || card.kind === "image" ? "jpg" : "mp4"}`;
}
function onlyKeys(value: object, allowed: string[]) { return Object.keys(value).every((key) => allowed.includes(key)); }

export function parsePortfolioManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const manifest = value as Partial<Manifest>;
  if (!onlyKeys(manifest, ["schemaVersion", "contact", "cards"]) || (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) ||
    !manifest.contact || typeof manifest.contact !== "object" || Array.isArray(manifest.contact) ||
    !onlyKeys(manifest.contact, ["telegramUsername", "email", "message"]) ||
    (manifest.contact.telegramUsername !== undefined && !TELEGRAM.test(manifest.contact.telegramUsername)) ||
    (manifest.contact.email !== undefined && !EMAIL.test(manifest.contact.email)) ||
    (manifest.contact.message !== undefined && (typeof manifest.contact.message !== "string" || manifest.contact.message.length < 1 ||
      manifest.contact.message.length > 500 || /[\u0000-\u0009\u000b-\u001f\u007f<>]/.test(manifest.contact.message))) ||
    !Array.isArray(manifest.cards) || manifest.cards.length < 1 || manifest.cards.length > 24) return null;
  const ids = new Set<string>();
  const assets = new Set<string>();
  for (const card of manifest.cards) {
    if (!card || typeof card !== "object" || !onlyKeys(card, manifest.schemaVersion === 1
      ? ["id", "assetId", "previewAssetId", "kind", "title", "description", "section", "genre", "previewKey", "posterKey"]
      : ["id", "assetId", "fullLengthAssetId", "kind", "title", "description", "section", "previewKey", "posterKey"]) ||
      typeof card.id !== "string" || !ID.test(card.id) || ids.has(card.id) ||
      typeof card.assetId !== "string" || !ASSET_ID.test(card.assetId) || assets.has(card.assetId) ||
      (card.kind !== "image" && card.kind !== "video") || typeof card.title !== "string" || !card.title.trim() || card.title.length > 100 ||
      typeof card.description !== "string" || card.description.length > 280 ||
      typeof card.section !== "string" || !LABEL.test(card.section) ||
      (manifest.schemaVersion === 1 && (typeof card.genre !== "string" || (card.genre !== "" && !LABEL.test(card.genre)))) ||
      typeof card.previewKey !== "string" || card.previewKey.length > 1024 ||
      (card.kind === "image" && card.posterKey !== null) ||
      (card.kind === "video" && !card.posterKey) ||
      (manifest.schemaVersion === 1 && (card.kind === "image" ? card.previewAssetId !== null : typeof card.previewAssetId !== "string" || !ASSET_ID.test(card.previewAssetId))) ||
      (manifest.schemaVersion === 2 && (card.previewAssetId !== undefined ||
        (card.fullLengthAssetId !== null && (typeof card.fullLengthAssetId !== "string" || !ASSET_ID.test(card.fullLengthAssetId) || card.fullLengthAssetId === card.assetId))))) return null;
    ids.add(card.id); assets.add(card.assetId);
  }
  return manifest as Manifest;
}

async function releaseRow(env: Env, params: PortfolioParams, states: string[]) {
  const row = await env.DB.prepare(`SELECT r.id,r.creator_id,r.adult_profile_version_id,r.status,r.manifest_json,r.approved_by,c.slug,
      p.status AS profile_status,p.published_version_id,v.status AS profile_version_status
    FROM creator_portfolio_release_versions r
    JOIN creators c ON c.id=r.creator_id AND c.status='active'
    JOIN creator_adult_profiles p ON p.creator_id=r.creator_id
    JOIN creator_adult_profile_versions v ON v.id=r.adult_profile_version_id AND v.creator_id=r.creator_id
    WHERE r.id=? AND r.creator_id=?`).bind(params.versionId, params.creatorId).first<Release>();
  if (!row || !states.includes(row.status) || !ID.test(row.id) || !ID.test(row.slug)) throw new Error("portfolio_release_unavailable");
  if ((states.includes("approved") || states.includes("publishing")) && (row.profile_status !== "active" || row.published_version_id !== row.adult_profile_version_id || row.profile_version_status !== "published")) throw new Error("portfolio_adult_profile_not_current");
  const manifest = parsePortfolioManifest(JSON.parse(row.manifest_json));
  if (!manifest) throw new Error("portfolio_release_manifest_invalid");
  return { row, manifest };
}

async function assertAssetConsent(env: Env, creatorId: string, assetId: string) {
  const row = await env.DB.prepare(`SELECT a.id FROM assets a
    JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
    WHERE a.creator_id=? AND a.id=? AND a.source_available=1
      AND (c.is_multi=0 OR EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=a.creator_id AND ap.asset_id=a.id))
      AND NOT EXISTS (SELECT 1 FROM asset_people ap
        LEFT JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
        LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
        WHERE ap.creator_id=a.creator_id AND ap.asset_id=a.id AND (COALESCE(p.consent_status,'not_recorded')<>'recorded' OR pc.person_id IS NULL))`)
    .bind(creatorId, assetId).first<{ id: string }>();
  if (!row) throw new Error("portfolio_media_rights_or_consent_missing");
}

async function sourceForCard(env: Env, creatorId: string, card: ManifestCard, schemaVersion: 1 | 2, pinned = false) {
  await assertAssetConsent(env, creatorId, card.assetId);
  if (schemaVersion === 2 && card.fullLengthAssetId) {
    await assertAssetConsent(env, creatorId, card.fullLengthAssetId);
    const full = await env.DB.prepare("SELECT id FROM assets WHERE id=? AND creator_id=? AND source_available=1 AND lower(extension)='mp4'")
      .bind(card.fullLengthAssetId, creatorId).first<{ id: string }>();
    if (!full) throw new Error("portfolio_full_length_unavailable");
  }
  if (card.kind === "image") {
    const row = await env.DB.prepare("SELECT preview_r2_key FROM assets WHERE id=? AND creator_id=? AND source_available=1").bind(card.assetId, creatorId).first<{ preview_r2_key: string | null }>();
    if (!row || (!pinned && row.preview_r2_key !== card.previewKey) || !card.previewKey.startsWith(`creators/${creatorId}/assets/`) || !card.previewKey.endsWith(".jpg")) throw new Error("portfolio_image_preview_changed");
    if (pinned && !await env.PREVIEWS.head(card.previewKey)) throw new Error("portfolio_image_preview_missing");
    return { preview: { key: card.previewKey, bucket: "PREVIEWS", mime: "image/jpeg" } as MediaSource, poster: null };
  }
  const previewAssetId = schemaVersion === 1 ? card.previewAssetId : card.assetId;
  if (!previewAssetId || (schemaVersion === 1 && previewAssetId === card.assetId)) throw new Error("portfolio_video_preview_missing");
  if (schemaVersion === 1) await assertAssetConsent(env, creatorId, previewAssetId);
  const row = await env.DB.prepare(`SELECT a.preview_r2_key,c.is_teaser,c.teaser_for_asset_id,vp.source_codec,vp.state,
      o.object_key,o.sha256,o.byte_count,o.verified_mime_type,o.r2_version,o.r2_etag
    FROM assets a
    JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
    JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    JOIN asset_storage_objects o ON o.id=vp.canonical_storage_object_id AND o.asset_id=a.id AND o.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1 AND lower(a.extension)='mp4'
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'`)
    .bind(previewAssetId, creatorId).first<{ preview_r2_key: string | null; is_teaser: number; teaser_for_asset_id: string | null; source_codec: string | null; state: string; object_key: string; sha256: string; byte_count: number; verified_mime_type: string; r2_version: string | null; r2_etag: string | null }>();
  if (!row || (schemaVersion === 1 && !pinned && (row.is_teaser !== 1 || row.teaser_for_asset_id !== card.assetId)) || row.source_codec !== "h264" ||
    !["canonical_verified", "processing_queued", "processing", "playback_ready", "processing_failed"].includes(row.state) ||
    !row.r2_version || !row.r2_etag || row.verified_mime_type !== "video/mp4" || row.byte_count < 1 || row.byte_count > MAX_VIDEO_BYTES ||
    !SHA.test(row.sha256) || (!pinned && row.preview_r2_key !== card.posterKey) || !card.posterKey?.startsWith(`creators/${creatorId}/assets/`) || !card.posterKey.endsWith(".jpg")) throw new Error("portfolio_short_preview_changed_or_too_large");
  if (pinned && !await env.PREVIEWS.head(card.posterKey)) throw new Error("portfolio_short_preview_poster_missing");
  return {
    preview: { key: row.object_key, bucket: "LIBRARY_MEDIA", mime: "video/mp4", checksum: row.sha256, etag: row.r2_etag, version: row.r2_version, size: row.byte_count } as MediaSource,
    poster: { key: card.posterKey, bucket: "PREVIEWS", mime: "image/jpeg" } as MediaSource,
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function copySource(env: Env, release: Release, card: ManifestCard, kind: "preview" | "poster", source: MediaSource) {
  const bucket = source.bucket === "PREVIEWS" ? env.PREVIEWS : env.LIBRARY_MEDIA;
  if (!bucket || !env.ADULT_MEDIA) throw new Error("portfolio_media_binding_missing");
  const head = await bucket.head(source.key);
  const maxBytes = source.mime === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!head || head.size < 1 || head.size > maxBytes || head.httpMetadata?.contentType !== source.mime ||
    (source.size !== undefined && head.size !== source.size) || (source.etag && head.etag !== source.etag) || (source.version && head.version !== source.version)) throw new Error("portfolio_source_integrity_failed");
  const object = await bucket.get(source.key, { onlyIf: { etagMatches: head.etag } });
  if (!object || !("body" in object) || object.etag !== head.etag || object.version !== head.version) throw new Error("portfolio_source_changed_during_copy");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const checksum = await sha256(bytes);
  if (bytes.byteLength !== head.size || (source.checksum && checksum !== source.checksum)) throw new Error("portfolio_source_checksum_failed");
  if (source.mime === "video/mp4" && !isShortMp4Preview(bytes)) throw new Error("portfolio_video_preview_exceeds_sixty_seconds_or_is_unreadable");
  const key = mediaKey(release.slug, release.id, card, kind);
  const stored = await env.ADULT_MEDIA.put(key, bytes, {
    httpMetadata: { contentType: source.mime }, sha256: checksum,
    customMetadata: { surface: "adult_portfolio", creatorSlug: release.slug, profileVersionId: release.adult_profile_version_id,
      portfolioVersionId: release.id, cardId: card.id, kind, checksum },
  });
  if (!stored || stored.size !== bytes.byteLength) throw new Error("portfolio_public_copy_failed");
  return { key, checksum };
}

async function releaseEvent(env: Env, release: Release, type: string, detail: object = {}) {
  await env.DB.prepare("INSERT INTO creator_portfolio_release_events (id,creator_id,release_version_id,actor,event_type,detail) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), release.creator_id, release.id, "portfolio-publication-control", type, JSON.stringify(detail)).run();
}

/** Make a creator-initiated withdrawal unavailable to new visitors immediately. */
export async function beginPortfolioWithdrawal(env: Env, params: PortfolioParams) {
  const { row } = await releaseRow(env, params, ["published", "withdrawing"]);
  if (!env.ADULT_PROFILES) throw new Error("portfolio_projection_binding_missing");
  const key = snapshotKey(row.slug);
  const current = await env.ADULT_PROFILES.get(key, "json");
  if (current && (!validLivePortfolio(current, row.slug, row.adult_profile_version_id) || current.portfolioVersionId !== row.id)) {
    throw new Error("portfolio_projection_version_mismatch");
  }
  const transition = await env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='withdrawing' WHERE id=? AND creator_id=? AND status IN ('published','withdrawing')")
    .bind(row.id, row.creator_id).run();
  if (transition.meta?.changes !== 1) throw new Error("portfolio_release_changed_during_withdrawal");
  await env.ADULT_PROFILES.delete(key);
  await releaseEvent(env, row, "withdraw_requested");
}

export class PortfolioPublishWorkflow extends WorkflowEntrypoint<Env, PortfolioParams> {
  async run(event: { payload: PortfolioParams }, step: WorkflowStep) {
    const { row, manifest } = await step.do("load approved portfolio release", () => releaseRow(this.env, event.payload, ["approved", "publishing"]));
    await step.do("record portfolio publication intent", async () => {
      await this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='publishing' WHERE id=? AND creator_id=? AND status IN ('approved','publishing')").bind(row.id, row.creator_id).run();
      await releaseEvent(this.env, row, "publish_requested");
    });
    const previous = await step.do("snapshot prior public portfolio", async () => {
      const current = await this.env.ADULT_PROFILES?.get(snapshotKey(row.slug), "json");
      return validLivePortfolio(current, row.slug, row.adult_profile_version_id) && current.portfolioVersionId !== row.id ? current : null;
    });
    try {
      const cards: LivePortfolioCard[] = [];
      for (const card of manifest.cards) {
        const sources = await step.do(`validate approved source ${card.id}`, () => sourceForCard(this.env, row.creator_id, card, manifest.schemaVersion));
        const preview = await step.do(`copy approved preview ${card.id}`, () => copySource(this.env, row, card, "preview", sources.preview));
        const poster = sources.poster ? await step.do(`copy approved poster ${card.id}`, () => copySource(this.env, row, card, "poster", sources.poster!)) : null;
        cards.push({ id: card.id, title: card.title, description: card.description, section: card.section, genre: card.genre ?? "",
          kind: card.kind, previewPath: `/portfolio-media/${row.slug}/${card.id}/preview`, mediaKey: preview.key, checksum: preview.checksum,
          ...(manifest.schemaVersion === 2 ? { hasFullLength: Boolean(card.fullLengthAssetId) } : {}),
          ...(poster ? { posterPath: `/portfolio-media/${row.slug}/${card.id}/poster`, posterKey: poster.key, posterChecksum: poster.checksum } : {}) });
      }
      const projection: LivePortfolioProjection = { schemaVersion: 2, creatorSlug: row.slug, publishedProfileVersionId: row.adult_profile_version_id,
        portfolioVersionId: row.id, contact: manifest.contact, cards };
      if (!validLivePortfolio(projection, row.slug, row.adult_profile_version_id)) throw new Error("portfolio_projection_invalid");
      await step.do("write isolated portfolio projection", async () => {
        if (!this.env.ADULT_PROFILES) throw new Error("portfolio_projection_binding_missing");
        // Re-check every release condition immediately before exposing copies.
        await releaseRow(this.env, event.payload, ["publishing"]);
        for (const card of manifest.cards) await sourceForCard(this.env, row.creator_id, card, manifest.schemaVersion);
        const current = await this.env.ADULT_PROFILES.get(snapshotKey(row.slug), "json");
        if (current) {
          if (!validLivePortfolio(current, row.slug, row.adult_profile_version_id) ||
            (current.portfolioVersionId !== previous?.portfolioVersionId && current.portfolioVersionId !== row.id))
            throw new Error("portfolio_projection_changed_during_publish");
        }
        if (!current && previous) throw new Error("portfolio_projection_changed_during_publish");
        await this.env.ADULT_PROFILES.put(snapshotKey(row.slug), JSON.stringify(projection), { metadata: { creatorId: row.creator_id, portfolioVersionId: row.id, profileVersionId: row.adult_profile_version_id } });
      });
      await step.do("record portfolio delivery", async () => {
        await this.env.DB.batch([
          this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='withdrawn',withdrawn_at=CURRENT_TIMESTAMP WHERE creator_id=? AND id<>? AND status='published'").bind(row.creator_id, row.id),
          this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='published',published_at=CURRENT_TIMESTAMP,failure_code=NULL WHERE id=? AND creator_id=? AND status='publishing'").bind(row.id, row.creator_id),
          this.env.DB.prepare("INSERT INTO creator_portfolio_release_events (id,creator_id,release_version_id,actor,event_type,detail) VALUES (?,?,?,?,?,?)")
            .bind(crypto.randomUUID(), row.creator_id, row.id, "portfolio-publication-control", "published", JSON.stringify({ cardCount: cards.length })),
        ]);
      });
      return { published: true, slug: row.slug, versionId: row.id, cardCount: cards.length };
    } catch (error) {
      const committed = await step.do("reconcile portfolio publication outcome", async () => {
        const status = await this.env.DB.prepare("SELECT status FROM creator_portfolio_release_versions WHERE id=? AND creator_id=?")
          .bind(row.id, row.creator_id).first<{ status: string }>();
        if (status?.status === "published") return true;
        if (!status || !["publishing", "failed"].includes(status.status)) throw new Error("portfolio_release_state_uncertain");
        const code = error instanceof Error && error.message.includes("portfolio_video_preview_exceeds_sixty_seconds")
          ? "preview_duration_failed" : "projection_failed";
        const key = snapshotKey(row.slug);
        const current = await this.env.ADULT_PROFILES?.get(key, "json");
        if (validLivePortfolio(current, row.slug, row.adult_profile_version_id) && current.portfolioVersionId === row.id) {
          let restored = false;
          if (previous) {
            try {
              const old = await releaseRow(this.env, { creatorId: row.creator_id, versionId: previous.portfolioVersionId }, ["published"]);
              for (const card of old.manifest.cards) await sourceForCard(this.env, row.creator_id, card, old.manifest.schemaVersion, true);
              const latest = await this.env.ADULT_PROFILES?.get(key, "json");
              if (validLivePortfolio(latest, row.slug, row.adult_profile_version_id) && latest.portfolioVersionId === row.id) {
                await this.env.ADULT_PROFILES?.put(key, JSON.stringify(previous), { metadata: { creatorId: row.creator_id,
                  portfolioVersionId: previous.portfolioVersionId, profileVersionId: row.adult_profile_version_id } });
                restored = true;
              }
            } catch { /* Revoked or stale prior releases must not be restored. */ }
          }
          if (!restored) {
            const latest = await this.env.ADULT_PROFILES?.get(key, "json");
            if (validLivePortfolio(latest, row.slug, row.adult_profile_version_id) && latest.portfolioVersionId === row.id) await this.env.ADULT_PROFILES?.delete(key);
          }
        }
        const keys = manifest.cards.flatMap((card) => card.kind === "video"
          ? [mediaKey(row.slug, row.id, card, "preview"), mediaKey(row.slug, row.id, card, "poster")]
          : [mediaKey(row.slug, row.id, card, "preview")]);
        await this.env.ADULT_MEDIA?.delete(keys);
        await this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='failed',failure_code=? WHERE id=? AND creator_id=? AND status='publishing'").bind(code, row.id, row.creator_id).run();
        await releaseEvent(this.env, row, "publish_failed", { code });
        return false;
      });
      if (committed) return { published: true, slug: row.slug, versionId: row.id, cardCount: manifest.cards.length };
      throw error;
    }
  }
}

export class PortfolioWithdrawWorkflow extends WorkflowEntrypoint<Env, PortfolioParams> {
  async run(event: { payload: PortfolioParams }, step: WorkflowStep) {
    const { row, manifest } = await step.do("load published portfolio release", () => releaseRow(this.env, event.payload, ["published", "withdrawing"]));
    await step.do("record portfolio withdrawal intent", async () => {
      await this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='withdrawing' WHERE id=? AND creator_id=? AND status IN ('published','withdrawing')").bind(row.id, row.creator_id).run();
      await releaseEvent(this.env, row, "withdraw_requested");
    });
    const key = snapshotKey(row.slug);
    const profiles = this.env.ADULT_PROFILES;
    const media = this.env.ADULT_MEDIA;
    if (!profiles || !media) throw new Error("portfolio_release_bindings_unavailable");
    await step.do("verify current isolated portfolio projection", async () => {
      const value = await profiles.get(key, "json");
      if (value && (!validLivePortfolio(value, row.slug, row.adult_profile_version_id) || value.portfolioVersionId !== row.id)) throw new Error("portfolio_projection_version_mismatch");
    });
    await step.do("remove isolated portfolio projection", () => profiles.delete(key));
    await step.do("remove isolated preview media", async () => {
      const keys = manifest.cards.flatMap((card) => card.kind === "video"
        ? [mediaKey(row.slug, row.id, card, "preview"), mediaKey(row.slug, row.id, card, "poster")]
        : [mediaKey(row.slug, row.id, card, "preview")]);
      await media.delete(keys);
    });
    await step.do("record portfolio withdrawal", async () => {
      await this.env.DB.prepare("UPDATE creator_portfolio_release_versions SET status='withdrawn',withdrawn_at=CURRENT_TIMESTAMP,failure_code=NULL WHERE id=? AND creator_id=? AND status='withdrawing'").bind(row.id, row.creator_id).run();
      await releaseEvent(this.env, row, "withdrawn");
    });
    return { withdrawn: true, slug: row.slug, versionId: row.id };
  }
}

/** Existing fifteen-minute control cron rechecks rights and retries withdrawal. */
export async function reconcilePublishedPortfolios(env: Env) {
  if (!env.PORTFOLIO_WITHDRAW) return;
  let afterApprovedAt = "";
  let afterId = "";
  while (true) {
    const rows = await env.DB.prepare(`SELECT id,creator_id,status,approved_at FROM creator_portfolio_release_versions
      WHERE status IN ('published','withdrawing')
        AND (approved_at > ? OR (approved_at = ? AND id > ?))
      ORDER BY approved_at ASC,id ASC LIMIT 100`)
      .bind(afterApprovedAt, afterApprovedAt, afterId)
      .all<{ id: string; creator_id: string; status: string; approved_at: string }>();
    if (!rows.results.length) break;
    for (const item of rows.results) {
      const params = { creatorId: item.creator_id, versionId: item.id };
      let needsWithdrawal = item.status === "withdrawing";
      if (!needsWithdrawal) {
        try {
          const { row, manifest } = await releaseRow(env, params, ["published"]);
          if (row.profile_status !== "active" || row.published_version_id !== row.adult_profile_version_id || row.profile_version_status !== "published") throw new Error("portfolio_adult_profile_no_longer_current");
          for (const card of manifest.cards) await sourceForCard(env, item.creator_id, card, manifest.schemaVersion, true);
        } catch { needsWithdrawal = true; }
      }
      if (needsWithdrawal) {
        try {
          await beginPortfolioWithdrawal(env, params);
          await env.PORTFOLIO_WITHDRAW.create({ id: `adult-portfolio-reconcile-${item.id}-${crypto.randomUUID()}`, params });
        } catch { console.warn(JSON.stringify({ event: "adult_portfolio_reconcile_retry_pending", creatorId: item.creator_id, versionId: item.id })); }
      }
    }
    const last = rows.results[rows.results.length - 1];
    afterApprovedAt = last.approved_at;
    afterId = last.id;
  }
}
