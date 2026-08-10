import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, savePlatformConnection } from "@/lib/db";
import { exchangeRedditAuthorizationCode, REDDIT_OAUTH_COOKIE, verifyRedditOAuthState } from "@/lib/integrations/reddit";
import { encryptSecret } from "@/lib/integrations/secrets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/connections", request.url);
  if (url.searchParams.get("error")) {
    destination.searchParams.set("error", "authorization_declined");
    return NextResponse.redirect(destination);
  }
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Reddit returned an incomplete authorization response.");
    const cookieStore = await cookies();
    const payload = verifyRedditOAuthState(state, cookieStore.get(REDDIT_OAUTH_COOKIE)?.value);
    const creator = await getActiveCreator();
    if (payload.creatorId !== creator.id) throw new Error("Active creator changed during authorization.");
    const account = getAccounts(creator.id).find((item) => item.id === payload.accountId);
    if (!account || account.platform !== "reddit") throw new Error("Reddit destination no longer exists.");
    const token = await exchangeRedditAuthorizationCode(code);
    savePlatformConnection({
      creatorId: creator.id,
      accountId: account.id,
      provider: "reddit",
      externalAccountId: token.accountId,
      externalUsername: token.username,
      scopes: token.scopes,
      tokenCiphertext: encryptSecret(token.accessToken),
      refreshTokenCiphertext: token.refreshToken ? encryptSecret(token.refreshToken) : null,
      tokenExpiresAt: token.expiresAt,
      providerMetadata: token.metadata,
    });
    destination.searchParams.set("connected", "reddit");
  } catch {
    destination.searchParams.set("error", "reddit_callback_failed");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(REDDIT_OAUTH_COOKIE);
  return response;
}
