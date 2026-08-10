import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts } from "@/lib/db";
import { createGoogleOAuthState, getGoogleConfiguration, GOOGLE_OAUTH_COOKIE, YOUTUBE_SCOPES } from "@/lib/integrations/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const creator = await getActiveCreator();
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  const account = getAccounts(creator.id).find((item) => item.id === accountId);
  if (!account || account.platform !== "youtube") return NextResponse.redirect(new URL("/connections?error=invalid_youtube_account", request.url));
  const config = getGoogleConfiguration();
  if (!config.ready) return NextResponse.redirect(new URL("/connections?error=google_not_configured", request.url));
  const { state, nonce } = createGoogleOAuthState(creator.id, account.id);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: YOUTUBE_SCOPES.join(" "),
    state,
  }).toString();
  const response = NextResponse.redirect(authorize);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/connections/google",
    maxAge: 10 * 60,
  });
  return response;
}
