import { NextResponse } from "next/server";
import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";

export async function GET(request: Request) {
  const destination = new URL("/accounts", request.url);
  try {
    const context = await requireCreatorContext("manage_identity");
    await identityAuditStatement(cloudflareEnv().DB, humanAuditActor(context), "dropbox_connection_authorized", "dropbox", { providerCallback: true, readOnlySource: true }).run();
    destination.searchParams.set("saved", "dropbox_reconnected");
  } catch (error) {
    destination.searchParams.set("connectionError", error instanceof Error ? error.message.slice(0, 300) : "Dropbox authorization did not complete.");
  }
  return NextResponse.redirect(destination);
}
