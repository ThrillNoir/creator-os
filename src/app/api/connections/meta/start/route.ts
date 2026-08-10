import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts } from "@/lib/db";
import { createMetaOAuthState, getMetaConfiguration, META_OAUTH_COOKIE, META_SCOPES } from "@/lib/integrations/meta";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const creator = await getActiveCreator();
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  const account = getAccounts(creator.id).find((candidate) => candidate.id === accountId);
  if (!account || account.platform !== "instagram") {
    return NextResponse.redirect(new URL("/connections?error=invalid_instagram_account", request.url));
  }
  const config = getMetaConfiguration();
  if (!config.ready) return NextResponse.redirect(new URL("/connections?error=meta_not_configured", request.url));
  const { state, nonce } = createMetaOAuthState(creator.id, account.id);
  const authorizeUrl = new URL("https://www.instagram.com/oauth/authorize");
  authorizeUrl.search = new URLSearchParams({
    enable_fb_login: "0",
    force_authentication: "1",
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: META_SCOPES.join(","),
    state,
  }).toString();
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(META_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/connections/meta",
    maxAge: 10 * 60,
  });
  return response;
}
