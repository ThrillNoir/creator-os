import { NextResponse } from "next/server";
import { authenticateLocalBridgeCollector, claimPendingMessageThread, failPendingMessageThread } from "@/lib/db";

export const dynamic = "force-dynamic";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "cache-control": "no-store",
};

function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Collector authentication failed.");
  return authenticateLocalBridgeCollector(authorization.slice(7));
}

export async function OPTIONS() {
  return new NextResponse(null,{status:204,headers:cors});
}

export async function GET(request: Request) {
  try {
    const pairing = authenticate(request);
    return NextResponse.json({thread:claimPendingMessageThread(pairing) ?? null},{headers:cors});
  } catch {
    return NextResponse.json({error:"Collector authentication failed."},{status:401,headers:cors});
  }
}

export async function POST(request: Request) {
  try {
    const pairing = authenticate(request);
    const body = await request.json() as {threadId?:number;error?:string};
    if (!Number.isInteger(body.threadId)) return NextResponse.json({error:"Invalid pending thread."},{status:400,headers:cors});
    failPendingMessageThread(pairing,body.threadId!,body.error ?? "The native conversation could not be collected.");
    return NextResponse.json({ok:true},{headers:cors});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "Pending thread update failed."},{status:400,headers:cors});
  }
}
