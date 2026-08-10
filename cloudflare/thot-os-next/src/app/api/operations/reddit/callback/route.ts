import { NextResponse } from "next/server";
import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
  const destination = new URL("/operations?platform=reddit", request.url);
  try {
    await requireAccessIdentity();
    const state = new URL(request.url).searchParams.get("state");
    if (!state) throw new Error("Reddit connection state is missing.");
    const response = await cloudflareEnv().REDDIT_SCHEDULER.fetch("https://reddit-scheduler/connections/reddit/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Reddit identity could not be verified.");
    destination.searchParams.set("connected", "reddit");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Reddit connection failed.");
  }
  return NextResponse.redirect(destination);
}
