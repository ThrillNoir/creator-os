import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts } from "@/lib/db";
import { createRedditOAuthState, getRedditConfiguration, REDDIT_OAUTH_COOKIE, REDDIT_SCOPES } from "@/lib/integrations/reddit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const creator = await getActiveCreator();
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  const account = getAccounts(creator.id).find((item) => item.id === accountId);
  if (!account || account.platform !== "reddit") return NextResponse.redirect(new URL("/connections?error=invalid_reddit_account", request.url));
  const config = getRedditConfiguration();
  if (!config.ready) return NextResponse.redirect(new URL("/connections?error=reddit_not_configured", request.url));
  const { state, nonce } = createRedditOAuthState(creator.id, account.id);
  const authorize = new URL("https://www.reddit.com/api/v1/authorize");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    state,
    redirect_uri: config.redirectUri,
    duration: "permanent",
    scope: REDDIT_SCOPES.join(" "),
  }).toString();
  const response = NextResponse.redirect(authorize);
  response.cookies.set(REDDIT_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure: config.baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/connections/reddit",
    maxAge: 10 * 60,
  });
  return response;
}
