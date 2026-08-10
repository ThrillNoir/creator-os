import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActiveCreator } from "@/lib/current-creator";
import {
  failComposioLinkRequest,
  getAccounts,
  getPendingComposioLinkRequest,
  recordComposioIdentity,
} from "@/lib/db";
import {
  COMPOSIO_OAUTH_COOKIE,
  verifyComposioInstagramIdentity,
  verifyComposioOAuthState,
} from "@/lib/integrations/composio";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const destination = new URL("/connections", request.url);
  let connectedAccountId = "";
  try {
    const cookieStore = await cookies();
    const payload = verifyComposioOAuthState(state, cookieStore.get(COMPOSIO_OAUTH_COOKIE)?.value);
    const activeCreator = await getActiveCreator();
    if (payload.creatorId !== activeCreator.id) throw new Error("Active creator changed during authorization.");
    const account = getAccounts(activeCreator.id).find((candidate) => candidate.id === payload.accountId);
    if (!account || account.platform !== "instagram") throw new Error("Instagram destination no longer exists.");
    const pending = getPendingComposioLinkRequest(activeCreator.id, account.id);
    if (!pending) throw new Error("Composio link request was not found.");
    connectedAccountId = pending.connected_account_id;
    const identity = await verifyComposioInstagramIdentity(
      pending.connected_account_id,
      `creator-os:${activeCreator.id}:${account.id}`,
    );
    recordComposioIdentity({
      connectedAccountId: pending.connected_account_id,
      externalAccountId: identity.id,
      externalUsername: identity.username,
      externalName: identity.name ?? identity.username,
      profileImage: identity.profile_picture_url ?? "",
    });
    destination.pathname = `/creators/${activeCreator.id}`;
    destination.searchParams.set("connected", "composio_identity_ready");
  } catch (error) {
    if (connectedAccountId) failComposioLinkRequest(connectedAccountId, error instanceof Error ? error.message : "Composio callback failed.");
    destination.searchParams.set("error", "composio_callback_failed");
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set(COMPOSIO_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: destination.protocol === "https:",
    sameSite: "lax",
    path: "/api/connections/composio",
    maxAge: 0,
  });
  return response;
}
