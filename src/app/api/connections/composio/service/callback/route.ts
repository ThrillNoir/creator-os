import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { failServiceLinkRequest, getPendingServiceLinkRequest, recordServiceIdentity } from "@/lib/db";
import {
  COMPOSIO_OAUTH_COOKIE,
  type ComposioCreatorService,
  verifyComposioCreatorServiceIdentity,
  verifyComposioOAuthState,
} from "@/lib/integrations/composio";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const destination = new URL("/creators", request.url);
  let connectedAccountId = "";
  try {
    const cookieStore = await cookies();
    const state = new URL(request.url).searchParams.get("state") ?? "";
    const payload = verifyComposioOAuthState(state, cookieStore.get(COMPOSIO_OAUTH_COOKIE)?.value);
    const creator = await getActiveCreator();
    const service = payload.accountId.replace(/^service:/, "");
    if (payload.creatorId !== creator.id || !(["dropbox", "reddit", "youtube", "telegram"] as const).includes(service as ComposioCreatorService)) {
      throw new Error("Service authorization context changed.");
    }
    const pending = getPendingServiceLinkRequest(creator.id, service);
    if (!pending) throw new Error(`Pending ${service} connection was not found.`);
    connectedAccountId = pending.connected_account_id;
    const identity = await verifyComposioCreatorServiceIdentity(
      service as ComposioCreatorService,
      connectedAccountId,
      `creator-os:${creator.id}:service:${service}`,
    );
    recordServiceIdentity({
      connectedAccountId,
      externalAccountId: identity.externalAccountId,
      displayName: identity.displayName,
      email: identity.email,
    });
    destination.pathname = `/creators/${creator.id}`;
    destination.searchParams.set("connected", `${service}_identity_ready`);
  } catch (error) {
    if (connectedAccountId) failServiceLinkRequest(connectedAccountId, error instanceof Error ? error.message : "Service callback failed.");
    destination.searchParams.set("error", "composio_service_callback_failed");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set(COMPOSIO_OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/connections/composio", maxAge: 0 });
  return response;
}
