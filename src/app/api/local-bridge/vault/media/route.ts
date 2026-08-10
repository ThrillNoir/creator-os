import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { authenticateLocalBridgeCollector, getClaimedVaultUploadMedia, getSourcePath } from "@/lib/db";

export const dynamic = "force-dynamic";
const contentTypes:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",mp4:"video/mp4",mov:"video/quicktime"};

export async function OPTIONS(){return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization","access-control-allow-methods":"GET,OPTIONS"}});}
export async function GET(request:Request){
  try{
    const authorization=request.headers.get("authorization")??"";
    if(!authorization.startsWith("Bearer "))return new Response("Collector authentication required.",{status:401});
    const pairing=authenticateLocalBridgeCollector(authorization.slice(7));
    const jobId=Number(new URL(request.url).searchParams.get("jobId"));
    if(!Number.isInteger(jobId))return new Response("Invalid vault job.",{status:400});
    const media=getClaimedVaultUploadMedia(pairing,jobId);
    if(!media)return new Response("Vault media unavailable.",{status:404});
    const source=path.resolve(getSourcePath(pairing.creator_id));
    const requested=path.resolve(source,media.relative_path);
    if(!requested.startsWith(`${source}${path.sep}`))return new Response("Invalid media path.",{status:400});
    const type=contentTypes[media.extension.toLowerCase()];
    if(!type)return new Response("Unsupported media type.",{status:415});
    const stream=Readable.toWeb(createReadStream(requested)) as ReadableStream;
    return new Response(stream,{headers:{"content-type":type,"content-length":String(media.bytes),"content-disposition":`attachment; filename*=UTF-8''${encodeURIComponent(media.basename)}`,"cache-control":"no-store","access-control-allow-origin":"*"}});
  }catch{return new Response("Collector authentication failed.",{status:401});}
}
