export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string; partNumber: string }> }) {
  void request; void params;
  // Intentionally reject the former Worker-proxied body route. Browser video
  // bytes are PUT only to a short-lived R2 presigned URL.
  return new Response(null, { status: 405, headers: { "cache-control": "private, no-store" } });
}
