import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { createServiceLinkRequest } from "@/lib/db";
import {
  COMPOSIO_OAUTH_COOKIE,
  type ComposioCreatorService,
  createComposioOAuthState,
  createComposioServiceLink,
} from "@/lib/integrations/composio";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const creator = await getActiveCreator();
  const service = new URL(request.url).searchParams.get("service");
  const destination = new URL(`/creators/${creator.id}`, request.url);
  if (!(["dropbox", "reddit", "youtube", "telegram"] as const).includes(service as ComposioCreatorService)) {
    destination.searchParams.set("error", "invalid_composio_service");
    return NextResponse.redirect(destination);
  }
  const creatorService = service as ComposioCreatorService;
  try {
    const { state, nonce } = createComposioOAuthState({ creatorId: creator.id, accountId: `service:${creatorService}` });
    const callbackUrl = new URL("/api/connections/composio/service/callback", request.url);
    callbackUrl.searchParams.set("state", state);
    const link = await createComposioServiceLink({
      creatorId: creator.id,
      service: creatorService,
      alias: `${creator.id}-${creatorService}-${Date.now().toString(36)}`,
      callbackUrl: callbackUrl.toString(),
    });
    createServiceLinkRequest({ creatorId: creator.id, service: creatorService, connectedAccountId: link.connected_account_id, expiresAt: link.expires_at });
    const response = NextResponse.redirect(link.redirect_url);
    response.cookies.set(COMPOSIO_OAUTH_COOKIE, nonce, {
      httpOnly: true,
      secure: callbackUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/connections/composio",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    destination.searchParams.set("error", "composio_service_link_failed");
    return NextResponse.redirect(destination);
  }
}
