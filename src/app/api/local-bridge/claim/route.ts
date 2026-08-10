import { NextResponse } from "next/server";
import { claimLocalBridgeCollector } from "@/lib/db";

const allowedOrigin = "chrome-extension://mgdombndnlnaemhfdjekmmfchgoeliin";
const cors = {"access-control-allow-origin":allowedOrigin,"access-control-allow-headers":"content-type","access-control-allow-methods":"POST,OPTIONS","cache-control":"no-store"};

export async function OPTIONS(request: Request) {
  return new NextResponse(null,{status:request.headers.get("origin") === allowedOrigin ? 204 : 403,headers:cors});
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== allowedOrigin) return NextResponse.json({error:"Collector extension origin is not approved."},{status:403,headers:cors});
  try {
    const body = await request.json() as {platform?:string;creatorId?:string;accountId?:string};
    if (body.platform !== "onlyfans" && body.platform !== "fansly") return NextResponse.json({error:"Unsupported collector platform."},{status:400,headers:cors});
    const claimed = claimLocalBridgeCollector(body.platform,{creatorId:body.creatorId,accountId:body.accountId});
    return NextResponse.json({token:claimed.token,creatorId:claimed.creator_id,accountId:claimed.account_id,platform:claimed.platform},{headers:cors});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "Collector recovery failed."},{status:409,headers:cors});
  }
}
