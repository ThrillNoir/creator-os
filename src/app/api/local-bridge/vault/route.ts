import { NextResponse } from "next/server";
import { authenticateLocalBridgeCollector, claimVaultUpload, completeVaultUpload } from "@/lib/db";

export const dynamic = "force-dynamic";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type,x-creator-os-vault-client","access-control-allow-methods":"GET,POST,OPTIONS","cache-control":"no-store"};
const authenticate=(request:Request)=>{
  const value=request.headers.get("authorization")??"";
  if(!value.startsWith("Bearer "))throw new Error("Collector authentication failed.");
  return authenticateLocalBridgeCollector(value.slice(7));
};

export async function OPTIONS(){return new NextResponse(null,{status:204,headers:cors});}
export async function GET(request:Request){
  if(request.headers.get("x-creator-os-vault-client")!=="explicit-v3"){
    return NextResponse.json({error:"Reload the THOT OS extension and use the in-page vault assistant."},{status:428,headers:cors});
  }
  try{
    const pairing=authenticate(request);
    const job=claimVaultUpload(pairing);
    return NextResponse.json({job:job?{...job,mediaUrl:`http://127.0.0.1:3000/api/local-bridge/vault/media?jobId=${job.id}`} : null},{headers:cors});
  }catch{return NextResponse.json({error:"Collector authentication failed."},{status:401,headers:cors});}
}
export async function POST(request:Request){
  try{
    const pairing=authenticate(request);
    const body=await request.json() as {jobId?:number;status?:"staged"|"verified"|"failed";error?:string;receipt?:Record<string,unknown>};
    if(!Number.isInteger(body.jobId)||!body.status||!["staged","verified","failed"].includes(body.status))return NextResponse.json({error:"Invalid vault upload receipt."},{status:400,headers:cors});
    completeVaultUpload({pairing,jobId:body.jobId!,status:body.status,error:body.error,receipt:body.receipt});
    return NextResponse.json({ok:true},{headers:cors});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Vault receipt failed."},{status:400,headers:cors});}
}
