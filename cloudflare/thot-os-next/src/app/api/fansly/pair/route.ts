import { NextResponse } from "next/server";
import { issueFanslyBridgePairing, type FanslyPairingDestination } from "@/lib/fansly-pairing";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== requestUrl.origin) {
    return new NextResponse("Cross-site pairing requests are not allowed.", { status: 403 });
  }

  const formData = await request.formData();
  const requestedDestination = String(formData.get("destination") ?? "");
  if (requestedDestination !== "vault" && requestedDestination !== "messages") {
    return new NextResponse("Choose a valid Fansly destination.", { status: 400 });
  }

  const destination = requestedDestination as FanslyPairingDestination;
  try {
    const pairingUrl = await issueFanslyBridgePairing(destination, String(formData.get("installationId") ?? ""));
    return NextResponse.redirect(pairingUrl, 303);
  } catch {
    const returnUrl = new URL(destination === "messages" ? "/messages?platform=fansly&saved=fansly_pair_failed" : "/operations?platform=fansly&section=create&saved=fansly_pair_failed", requestUrl);
    return NextResponse.redirect(returnUrl, 303);
  }
}
