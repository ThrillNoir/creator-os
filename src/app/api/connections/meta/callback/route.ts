import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, savePlatformConnection } from "@/lib/db";
import { encryptSecret } from "@/lib/integrations/secrets";
import { exchangeMetaAuthorizationCode, META_OAUTH_COOKIE, verifyMetaOAuthState } from "@/lib/integrations/meta";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const destination = new URL("/connections", request.url);
  if (providerError) {
    destination.searchParams.set("error", "authorization_declined");
    return NextResponse.redirect(destination);
  }
  try {
    if (!code || !state) throw new Error("Instagram returned an incomplete authorization response.");
    const cookieStore = await cookies();
    const payload = verifyMetaOAuthState(state, cookieStore.get(META_OAUTH_COOKIE)?.value);
    const activeCreator = await getActiveCreator();
    if (payload.creatorId !== activeCreator.id) throw new Error("Active creator changed during authorization.");
    const account = getAccounts(activeCreator.id).find((candidate) => candidate.id === payload.accountId);
    if (!account || account.platform !== "instagram") throw new Error("Instagram destination no longer exists.");
    const token = await exchangeMetaAuthorizationCode(code);
    if (!token.externalAccountId) throw new Error("Instagram account identity could not be verified.");
    savePlatformConnection({
      creatorId: activeCreator.id,
      accountId: account.id,
      provider: "meta_instagram",
      externalAccountId: token.externalAccountId,
      externalUsername: token.externalUsername,
      scopes: token.scopes,
      tokenCiphertext: encryptSecret(token.accessToken),
      tokenExpiresAt: token.expiresAt,
    });
    destination.searchParams.set("connected", "meta_instagram");
  } catch {
    destination.searchParams.set("error", "meta_callback_failed");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(META_OAUTH_COOKIE);
  return response;
}
