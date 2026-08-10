import { NextResponse } from "next/server";
import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
  const destination = new URL("/operations?platform=instagram", request.url);
  try {
    await requireAccessIdentity();
    const state = new URL(request.url).searchParams.get("state");
    if (!state) throw new Error("Instagram connection state is missing.");
    const response = await cloudflareEnv().INSTAGRAM_SCHEDULER.fetch("https://instagram-scheduler/connections/instagram/complete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Instagram identity could not be verified.");
    destination.searchParams.set("connected", "instagram");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Instagram connection failed.");
  }
  return NextResponse.redirect(destination);
}
