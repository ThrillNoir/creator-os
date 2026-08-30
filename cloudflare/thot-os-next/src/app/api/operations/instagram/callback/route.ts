import { NextResponse } from "next/server";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";
import { fetchInternalService } from "@/lib/internal-service";

export async function GET(request: Request) {
  const destination = new URL("/operations?platform=instagram", request.url);
  try {
    const context = await requireCreatorContext("mutate");
    const state = new URL(request.url).searchParams.get("state");
    if (!state) throw new Error("Instagram connection state is missing.");
    const env = cloudflareEnv();
    const response = await fetchInternalService(env, "instagram", "instagram.connection.manage", env.INSTAGRAM_SCHEDULER, "https://instagram-scheduler/connections/instagram/complete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, creatorId: context.creator.creator_id }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Instagram identity could not be verified.");
    await identityAuditStatement(env.DB, humanAuditActor(context), "instagram_connection_verified", "instagram", { providerCallback: true }).run();
    destination.searchParams.set("connected", "instagram");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Instagram connection failed.");
  }
  return NextResponse.redirect(destination);
}
