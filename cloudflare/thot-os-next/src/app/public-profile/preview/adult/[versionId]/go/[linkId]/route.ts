import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { localAdultPreviewCookieName, readLocalAdultPreviewSession, requireLocalAdultPreview } from "@/lib/local-adult-preview";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AdultLink = { destination_url: string; destination_host: string };

function approvedDestination(link: AdultLink) {
  try {
    const destination = new URL(link.destination_url);
    if (destination.protocol !== "https:" || destination.username || destination.password || !destination.hostname || destination.hostname.toLowerCase() !== link.destination_host.toLowerCase()) return null;
    return destination;
  } catch { return null; }
}

export async function GET(_: Request, { params }: { params: Promise<{ versionId: string; linkId: string }> }) {
  requireLocalAdultPreview();
  const { versionId, linkId } = await params;
  if (!uuid.test(versionId) || !uuid.test(linkId)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const identity = await requireCreatorContext();
  const session = await readLocalAdultPreviewSession((await cookies()).get(localAdultPreviewCookieName)?.value);
  if (!session || session.creatorId !== identity.creator.creator_id || session.versionId !== versionId) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const link = await cloudflareEnv().DB.prepare(`SELECT l.destination_url,l.destination_host
    FROM creator_adult_link_revisions l
    JOIN creator_adult_profile_versions v ON v.id=l.profile_version_id AND v.creator_id=l.creator_id
    WHERE l.id=? AND l.creator_id=? AND l.profile_version_id=? AND l.enabled=1 AND v.status IN ('draft','approved')`)
    .bind(linkId, identity.creator.creator_id, versionId).first<AdultLink>();
  const destination = link && approvedDestination(link);
  if (!destination) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  redirect(destination.toString());
}
