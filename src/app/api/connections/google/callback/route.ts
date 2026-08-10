import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, savePlatformConnection } from "@/lib/db";
import { exchangeGoogleAuthorizationCode, GOOGLE_OAUTH_COOKIE, verifyGoogleOAuthState } from "@/lib/integrations/google";
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
    if (!code || !state) throw new Error("Google returned an incomplete authorization response.");
    const cookieStore = await cookies();
    const payload = verifyGoogleOAuthState(state, cookieStore.get(GOOGLE_OAUTH_COOKIE)?.value);
    const creator = await getActiveCreator();
    if (payload.creatorId !== creator.id) throw new Error("Active creator changed during authorization.");
    const account = getAccounts(creator.id).find((item) => item.id === payload.accountId);
    if (!account || account.platform !== "youtube") throw new Error("YouTube destination no longer exists.");
    const token = await exchangeGoogleAuthorizationCode(code);
    savePlatformConnection({
      creatorId: creator.id,
      accountId: account.id,
      provider: "google_youtube",
      externalAccountId: token.channelId,
      externalUsername: token.channelTitle,
      scopes: token.scopes,
      tokenCiphertext: encryptSecret(token.accessToken),
      refreshTokenCiphertext: token.refreshToken ? encryptSecret(token.refreshToken) : null,
      tokenExpiresAt: token.expiresAt,
      providerMetadata: { customUrl: token.customUrl },
    });
    destination.searchParams.set("connected", "google_youtube");
  } catch {
    destination.searchParams.set("error", "google_callback_failed");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(GOOGLE_OAUTH_COOKIE);
  return response;
}
