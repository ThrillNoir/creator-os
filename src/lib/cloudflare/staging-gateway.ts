type GatewayQueue = "intake" | "ai";

export async function enqueueStagingJob(input: {
  queue: GatewayQueue;
  creatorId: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  const baseUrl = process.env.CLOUDFLARE_STAGING_GATEWAY_URL?.trim();
  const token = process.env.CLOUDFLARE_STAGING_GATEWAY_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("Cloudflare staging gateway is not configured.");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Cloudflare staging gateway rejected the job (${response.status}).`);
  return response.json() as Promise<{ ok: true; queue: GatewayQueue; idempotencyKey: string }>;
}
