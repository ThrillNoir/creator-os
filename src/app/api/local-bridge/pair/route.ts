import { NextResponse } from "next/server";
import { pairLocalBridgeCollector } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    const pairing = pairLocalBridgeCollector(token);
    const config = JSON.stringify({token,creatorId:pairing.creator_id,accountId:pairing.account_id,platform:pairing.platform});
    if (request.headers.get("accept")?.includes("application/json")) return NextResponse.json(JSON.parse(config),{headers:{"cache-control":"no-store","access-control-allow-origin":"*"}});
    return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="creator-os-bridge" content='${config.replaceAll("'","&#39;")}'><title>THOT OS collector paired</title></head><body><main><h1>Collector paired</h1><p>THOT OS connected this isolated ${pairing.platform} browser. This tab will continue to the native inbox.</p></main></body></html>`,{
      headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'"}
    });
  } catch {
    return new NextResponse("Collector pairing is invalid or expired.",{status:401,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
  }
}
