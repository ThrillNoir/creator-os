import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers";
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";

type PublishParams = {
  creatorId: string;
  profileId: string;
  versionId: string;
};

type WithdrawParams = PublishParams;

type ProfileRow = {
  profile_id: string;
  creator_id: string;
  slug: string;
  profile_status: string;
  version_id: string;
  version_status: string;
  display_name: string;
  headline: string;
  bio: string;
  approved_by: string | null;
  approved_at: string | null;
  content_checksum: string;
};

type LinkRow = {
  id: string;
  label: string;
  destination_url: string;
  destination_host: string;
};

type ActiveProfileRow = {
  profile_id: string;
  creator_id: string;
  slug: string;
  version_id: string;
  approved_by: string;
};

type PublicProfileSnapshot = {
  schemaVersion: 1;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; headline: string; bio: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
};

const CREATOR_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const RECORD_ID = /^[a-zA-Z0-9_-]{1,160}$/;

function snapshotKey(slug: string) {
  return `public-profile:${slug}`;
}

function validHttpsDestination(value: string, expectedHost: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === expectedHost.toLowerCase();
  } catch {
    return false;
  }
}

async function loadApprovedProfile(env: Env, params: PublishParams) {
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,p.slug,p.status AS profile_status,
      v.id AS version_id,v.status AS version_status,v.display_name,v.headline,v.bio,v.approved_by,v.approved_at,v.content_checksum
    FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=? AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=?`).bind(params.versionId, params.profileId, params.creatorId).first<ProfileRow>();
  if (!profile || !["draft", "active", "paused"].includes(profile.profile_status) || !["approved", "published", "superseded"].includes(profile.version_status) || !profile.approved_by || !profile.approved_at) {
    throw new Error("The requested public profile version is not explicitly approved for publication.");
  }
  const links = await env.DB.prepare(`SELECT id,label,destination_url,destination_host
    FROM creator_public_links
    WHERE profile_version_id=? AND creator_id=?
    ORDER BY sort_order ASC`).bind(profile.version_id, profile.creator_id).all<LinkRow>();
  if (!links.results.length || links.results.some((link) => !validHttpsDestination(link.destination_url, link.destination_host))) {
    throw new Error("The approved profile has no valid HTTPS destination links.");
  }
  return { profile, links: links.results };
}

function toSnapshot(profile: ProfileRow, links: LinkRow[]): PublicProfileSnapshot {
  return {
    schemaVersion: 1,
    publishedVersionId: profile.version_id,
    creator: { slug: profile.slug, displayName: profile.display_name, headline: profile.headline, bio: profile.bio },
    links: links.map((link) => ({ id: link.id, label: link.label, destinationUrl: link.destination_url, destinationHost: link.destination_host })),
  };
}

export class PublicProfilePublishWorkflow extends WorkflowEntrypoint<Env, PublishParams> {
  async run(event: { payload: PublishParams }, step: WorkflowStep) {
    const loaded = await step.do("load approved profile", async () => {
      const { profile, links } = await loadApprovedProfile(this.env, event.payload);
      return { profile, links };
    });
    const snapshot = toSnapshot(loaded.profile, loaded.links);
    const key = snapshotKey(snapshot.creator.slug);
    await step.do("write approved public snapshot", async () => {
      await this.env.PUBLIC_LINKS.put(key, JSON.stringify(snapshot), { metadata: { creatorId: loaded.profile.creator_id, versionId: loaded.profile.version_id, contentChecksum: loaded.profile.content_checksum } });
      return { key };
    });
    await step.do("record publication", async () => {
      const publicationId = `public-profile-publication:${loaded.profile.version_id}`;
      const operationId = `public-profile-publish:${loaded.profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, loaded.profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ profileId: loaded.profile.profile_id, versionId: loaded.profile.version_id, key })),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE profile_id=? AND creator_id=? AND status='published' AND id<>?")
          .bind(loaded.profile.profile_id, loaded.profile.creator_id, loaded.profile.version_id),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='published' WHERE id=? AND profile_id=? AND creator_id=? AND status IN ('approved','published','superseded')")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare(`INSERT INTO creator_public_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
          VALUES (?,?,?,?,'published',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET public_snapshot_key=excluded.public_snapshot_key,error=NULL`)
          .bind(publicationId, loaded.profile.creator_id, loaded.profile.profile_id, loaded.profile.version_id, loaded.profile.approved_by, key),
      ]);
      return { publicationId };
    });
    return { published: true, creatorSlug: snapshot.creator.slug, versionId: snapshot.publishedVersionId };
  }
}

async function loadActiveProfileForWithdrawal(env: Env, params: WithdrawParams) {
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,p.slug,p.published_version_id AS version_id,v.approved_by
    FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.status='active' AND p.published_version_id=? AND v.status='published'`)
    .bind(params.profileId, params.creatorId, params.versionId).first<ActiveProfileRow>();
  if (!profile || !profile.approved_by) throw new Error("The requested public profile is not currently published.");
  return profile;
}

/**
 * Removing a public profile is deliberately separate from editing it. This is
 * a durable, idempotent withdrawal operation: the public KV projection is
 * removed first, then the private publication pointer and history are updated.
 */
export class PublicProfileWithdrawWorkflow extends WorkflowEntrypoint<Env, WithdrawParams> {
  async run(event: { payload: WithdrawParams }, step: WorkflowStep) {
    const profile = await step.do("load active public profile", () => loadActiveProfileForWithdrawal(this.env, event.payload));
    const key = snapshotKey(profile.slug);
    await step.do("remove public snapshot", async () => {
      await this.env.PUBLIC_LINKS.delete(key);
      return { key };
    });
    await step.do("record withdrawal", async () => {
      const operationId = `public-profile-withdraw:${profile.profile_id}:${profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ profileId: profile.profile_id, versionId: profile.version_id, key, action: "withdraw" })),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE id=? AND profile_id=? AND creator_id=? AND status='published'")
          .bind(profile.version_id, profile.profile_id, profile.creator_id),
        this.env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=NULL,status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND published_version_id=?")
          .bind(profile.profile_id, profile.creator_id, profile.version_id),
        this.env.DB.prepare(`INSERT INTO creator_public_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
          VALUES (?,?,?,?,'rolled_back',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET error=NULL`)
          .bind(`public-profile-withdrawal:${profile.version_id}`, profile.creator_id, profile.profile_id, profile.version_id, profile.approved_by, key),
      ]);
      return { operationId };
    });
    return { withdrawn: true, creatorSlug: profile.slug, versionId: profile.version_id };
  }
}

function parsePublishParams(value: unknown): PublishParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<PublishParams>;
  if (typeof input.creatorId !== "string" || !CREATOR_ID.test(input.creatorId) || typeof input.profileId !== "string" || !RECORD_ID.test(input.profileId) || typeof input.versionId !== "string" || !RECORD_ID.test(input.versionId)) return null;
  return { creatorId: input.creatorId, profileId: input.profileId, versionId: input.versionId };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isPublish = url.pathname === "/publish";
    const isWithdraw = url.pathname === "/withdraw";
    if (request.method !== "POST" || (!isPublish && !isWithdraw)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const params = parsePublishParams(await request.clone().json().catch(() => null));
    if (!params) return Response.json({ ok: false, error: "invalid_publication_request" }, { status: 400 });
    try {
      const service = await requireInternalServiceForCreator(request, env.DB, params.creatorId, "thot-os-web-public-links", isPublish ? "public.profile.publish" : "public.profile.withdraw");
      await internalServiceAuditStatement(env.DB, service, url.pathname).run();
    } catch {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const instanceId = `${isPublish ? "public-profile" : "public-profile-withdraw"}-${params.versionId}`;
    try {
      const instance = isPublish
        ? await env.PUBLIC_PROFILE_PUBLISH.create({ id: instanceId, params })
        : await env.PUBLIC_PROFILE_WITHDRAW.create({ id: instanceId, params });
      return Response.json({ ok: true, instanceId: instance.id }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow could not be created.";
      if (/already exists|already.*instance/i.test(message)) return Response.json({ ok: true, instanceId, duplicate: true }, { status: 202 });
      console.error(JSON.stringify({ event: "public_profile_publish_start_failed", creatorId: params.creatorId, profileId: params.profileId, versionId: params.versionId, message }));
      return Response.json({ ok: false, error: "publication_unavailable" }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
