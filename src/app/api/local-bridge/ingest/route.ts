import { NextResponse } from "next/server";
import { authenticateLocalBridgeCollector, ingestLocalBridgeMessages, type LocalBridgeThreadInput } from "@/lib/db";

export const dynamic = "force-dynamic";

const cors = {"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST,OPTIONS","cache-control":"no-store"};

export async function OPTIONS() {
  return new NextResponse(null,{status:204,headers:cors});
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return NextResponse.json({error:"Collector authentication required."},{status:401,headers:cors});
    let pairing;
    try {
      pairing = authenticateLocalBridgeCollector(authorization.slice(7));
    } catch {
      return NextResponse.json({error:"Collector authentication failed."},{status:401,headers:cors});
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 1_000_000) return NextResponse.json({error:"Collector payload is too large."},{status:413,headers:cors});
    const body = await request.json() as {platform?:string;threads?:LocalBridgeThreadInput[]};
    if (body.platform !== pairing.platform || !Array.isArray(body.threads)) return NextResponse.json({error:"Collector payload does not match its paired platform."},{status:400,headers:cors});
    return NextResponse.json({ok:true,...ingestLocalBridgeMessages(pairing,body.threads)},{headers:cors});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "Collector sync failed."},{status:400,headers:cors});
  }
}
