import "server-only";

import { cookies } from "next/headers";
import { getCreator, getCreators } from "@/lib/db";

export const CREATOR_COOKIE = "creator_os_active_creator";

export async function getActiveCreator() {
  const cookieStore = await cookies();
  const requestedId = cookieStore.get(CREATOR_COOKIE)?.value;
  const requested = requestedId ? getCreator(requestedId) : undefined;
  return requested ?? getCreator("thrill-noir") ?? getCreators()[0];
}
