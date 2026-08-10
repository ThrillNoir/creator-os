import { NextResponse } from "next/server";
import { authenticateLocalBridgeCollector, claimLocalBridgeOutbound, completeLocalBridgeOutbound } from "@/lib/db";

const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,OPTIONS","cache-control":"no-store"};
const authenticate=(request:Request)=>{
  const value=request.headers.get("authorization")??"";
  if(!value.startsWith("Bearer "))throw new Error("auth");
  return authenticateLocalBridgeCollector(value.slice(7));
};
export async function OPTIONS(){return new NextResponse(null,{status:204,headers:cors});}
export async function GET(request:Request){
  try{const pairing=authenticate(request);const activeThread=new URL(request.url).searchParams.get("thread");return NextResponse.json({job:claimLocalBridgeOutbound(pairing,activeThread??undefined)??null},{headers:cors});}
  catch{return NextResponse.json({error:"Collector authentication failed."},{status:401,headers:cors});}
}
export async function POST(request:Request){
  try{
    const pairing=authenticate(request);const body=await request.json() as {jobId?:number;sent?:boolean;error?:string;receipt?:Record<string,unknown>};
    if(!Number.isInteger(body.jobId)||typeof body.sent!=="boolean")return NextResponse.json({error:"Invalid outbound receipt."},{status:400,headers:cors});
    completeLocalBridgeOutbound({pairing,jobId:body.jobId!,sent:body.sent,error:body.error,receipt:body.receipt});
    return NextResponse.json({ok:true},{headers:cors});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Receipt failed."},{status:400,headers:cors});}
}
