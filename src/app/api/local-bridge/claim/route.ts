import { NextResponse } from "next/server";

const allowedOrigin = "chrome-extension://mgdombndnlnaemhfdjekmmfchgoeliin";
const cors = {"access-control-allow-origin":allowedOrigin,"access-control-allow-headers":"content-type","access-control-allow-methods":"POST,OPTIONS","cache-control":"no-store"};

export async function OPTIONS(request: Request) {
  return new NextResponse(null,{status:request.headers.get("origin") === allowedOrigin ? 204 : 403,headers:cors});
}

export async function POST() {
  return NextResponse.json({error:"Automatic collector recovery is disabled. Start an explicit pairing from Creator OS."},{status:410,headers:cors});
}
