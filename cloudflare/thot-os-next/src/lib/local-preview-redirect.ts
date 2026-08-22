/**
 * Local previews can contain creator-controlled destinations, so their
 * successful redirects are never cacheable. Callers must validate the stored
 * destination immediately before invoking this helper.
 */
export function localPreviewRedirect(destination: URL) {
  return new Response(null, { status: 307, headers: { location: destination.toString(), "cache-control": "no-store" } });
}
