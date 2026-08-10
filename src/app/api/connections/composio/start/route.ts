import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { createComposioLinkRequest, getAccounts } from "@/lib/db";
import {
  COMPOSIO_OAUTH_COOKIE,
  createComposioInstagramLink,
  createComposioOAuthState,
  getComposioConfiguration,
} from "@/lib/integrations/composio";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const creator = await getActiveCreator();
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  const account = getAccounts(creator.id).find((candidate) => candidate.id === accountId);
  const destination = new URL(`/creators/${creator.id}`, request.url);
  if (!account || account.platform !== "instagram") {
    destination.searchParams.set("error", "invalid_composio_account");
    return NextResponse.redirect(destination);
  }
  const config = getComposioConfiguration();
  if (!config.ready) {
    destination.searchParams.set("error", "composio_not_configured");
    return NextResponse.redirect(destination);
  }
  try {
    const { state, nonce } = createComposioOAuthState({ creatorId: creator.id, accountId: account.id });
    const callbackUrl = new URL(config.callbackUrl);
    callbackUrl.searchParams.set("state", state);
    const alias = `${creator.id}-${account.platform}-${account.handle.replace(/^@/, "").toLowerCase()}-${Date.now().toString(36)}`;
    const link = await createComposioInstagramLink({
      creatorId: creator.id,
      accountId: account.id,
      alias,
      callbackUrl: callbackUrl.toString(),
    });
    createComposioLinkRequest({
      creatorId: creator.id,
      accountId: account.id,
      toolkit: "instagram",
      provider: "composio_instagram",
      connectedAccountId: link.connected_account_id,
      expectedUsername: account.handle,
      expiresAt: link.expires_at ?? null,
    });
    const response = NextResponse.redirect(link.redirect_url);
    response.cookies.set(COMPOSIO_OAUTH_COOKIE, nonce, {
      httpOnly: true,
      secure: config.callbackUrl.startsWith("https://"),
      sameSite: "lax",
      path: "/api/connections/composio",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    destination.searchParams.set("error", "composio_link_failed");
    return NextResponse.redirect(destination);
  }
}
