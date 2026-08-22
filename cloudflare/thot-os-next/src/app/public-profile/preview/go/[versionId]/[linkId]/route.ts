import { notFound, redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PreviewLink = { destination_url: string; destination_host: string };

function approvedDestination(link: PreviewLink) {
  try {
    const destination = new URL(link.destination_url);
    if (destination.protocol !== "https:" || destination.username || destination.password || !destination.hostname || destination.hostname.toLowerCase() !== link.destination_host.toLowerCase()) return null;
    return destination;
  } catch {
    return null;
  }
}

/**
 * Local-preview equivalent of the public /go redirect. The path identifies a
 * database row, never a caller-provided destination, and the URL is validated
 * again immediately before the redirect.
 */
export async function GET(_: Request, { params }: { params: Promise<{ versionId: string; linkId: string }> }) {
  const { versionId, linkId } = await params;
  if (!uuid.test(versionId) || !uuid.test(linkId)) notFound();
  const identity = await requireCreatorContext();
  const link = await cloudflareEnv().DB.prepare(`SELECT l.destination_url,l.destination_host
    FROM creator_public_links l
    JOIN creator_public_profile_versions v ON v.id=l.profile_version_id AND v.creator_id=l.creator_id
    LEFT JOIN creator_public_profiles p ON p.id=v.profile_id AND p.creator_id=v.creator_id
    WHERE l.creator_id=? AND l.id=? AND v.id=?
      AND (v.status IN ('draft','approved') OR p.published_version_id=v.id)`)
    .bind(identity.creator.creator_id, linkId, versionId).first<PreviewLink>();
  const destination = link && approvedDestination(link);
  if (!destination) notFound();
  redirect(destination.toString());
}
