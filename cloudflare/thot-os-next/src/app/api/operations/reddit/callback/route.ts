import { NextResponse } from "next/server";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";
import { fetchInternalService } from "@/lib/internal-service";

export async function GET(request: Request) {
  const destination = new URL("/operations?platform=reddit", request.url);
  try {
    const context = await requireCreatorContext("manage_identity");
    const state = new URL(request.url).searchParams.get("state");
    if (!state) throw new Error("Reddit connection state is missing.");
    const env = cloudflareEnv();
    const response = await fetchInternalService(env, "reddit", env.REDDIT_SCHEDULER, "https://reddit-scheduler/connections/reddit/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, creatorId: context.creator.creator_id }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Reddit identity could not be verified.");
    await identityAuditStatement(env.DB, humanAuditActor(context), "reddit_connection_verified", "reddit", { providerCallback: true }).run();
    destination.searchParams.set("connected", "reddit");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Reddit connection failed.");
  }
  return NextResponse.redirect(destination);
}
