import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { createLocalAdultPreviewSession, localAdultPreviewCookie, requireLocalAdultPreview, verifyLocalAdultGateToken } from "@/lib/local-adult-preview";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameLocalLoopbackOrigin(candidate: string, expected: string) {
  if (candidate === expected) return true;
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const received = new URL(candidate);
    const target = new URL(expected);
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    return received.protocol === target.protocol && received.port === target.port && loopback.has(received.hostname) && loopback.has(target.hostname);
  } catch {
    return false;
  }
}

function sameOriginPost(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") return sameLocalLoopbackOrigin(origin, expectedOrigin) ? "origin" : null;
  const referer = request.headers.get("referer");
  if (referer) {
    try { return sameLocalLoopbackOrigin(new URL(referer).origin, expectedOrigin) ? "referer" : null; } catch { return null; }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "same-site" ? "fetch_metadata" : null;
  // The Codex local in-app browser can submit a same-origin form without
  // Origin, Referer, or Fetch Metadata. This narrow development-only fallback
  // remains protected by the short-lived, creator/version-bound signed CSRF
  // token verified below; any supplied cross-origin signal still fails closed.
  return process.env.NODE_ENV === "development" ? "local_metadata_absent" : null;
}

function reject(reason: string, creatorId: string, versionId: string) {
  // No form values, destinations, cookies, or signed token material are ever logged.
  console.warn(JSON.stringify({ event: "local_adult_age_confirmation_rejected", reason, creatorId, versionId }));
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  requireLocalAdultPreview();
  const { versionId } = await params;
  if (!uuid.test(versionId)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const identity = await requireCreatorContext();
  const creatorId = identity.creator.creator_id;
  const sameOrigin = sameOriginPost(request);
  if (!sameOrigin) return reject("cross_origin", creatorId, versionId);
  const form = await request.formData().catch(() => null);
  if (form?.get("ageConfirmed") !== "yes") return reject("age_not_confirmed", creatorId, versionId);
  const csrf = await verifyLocalAdultGateToken(typeof form.get("csrf") === "string" ? String(form.get("csrf")) : undefined, creatorId, versionId);
  if (csrf !== "valid") return reject(`csrf_${csrf}`, creatorId, versionId);
  const version = await cloudflareEnv().DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status IN ('draft','approved')")
    .bind(versionId, creatorId).first<{ id: string }>();
  if (!version) return reject("version_unavailable", creatorId, versionId);
  const session = await createLocalAdultPreviewSession(creatorId, version.id);
  // Keep the browser on the exact loopback host that set the HttpOnly cookie.
  // An absolute URL can make the in-app browser switch between localhost and
  // 127.0.0.1, which isolates host-only cookies and incorrectly reopens the gate.
  return new Response(null, { status: 303, headers: { location: `/public-profile/preview/adult/${version.id}`, "set-cookie": localAdultPreviewCookie(session), "cache-control": "no-store" } });
}
