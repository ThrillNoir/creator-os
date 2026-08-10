import { NextResponse } from "next/server";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

export async function GET(request: Request) {
  const destination = new URL("/operations?platform=reddit", request.url);
  try {
    const context = await requireCreatorContext("manage_identity");
    const state = new URL(request.url).searchParams.get("state");
    if (!state) throw new Error("Reddit connection state is missing.");
    const response = await cloudflareEnv().REDDIT_SCHEDULER.fetch("https://reddit-scheduler/connections/reddit/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, creatorId: context.creator.creator_id, actor: context.email }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Reddit identity could not be verified.");
    destination.searchParams.set("connected", "reddit");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Reddit connection failed.");
  }
  return NextResponse.redirect(destination);
}
