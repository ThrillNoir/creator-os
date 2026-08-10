import { timingSafeEqual } from "node:crypto";
import { applyAutomationCallback } from "@/lib/db";

function authorised(request:Request){
  const expected=process.env.CREATOR_OS_AUTOMATION_CALLBACK_TOKEN?.trim();
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!expected||supplied.length!==expected.length)return false;
  return timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}

export async function POST(request:Request){
  if(!authorised(request))return Response.json({ok:false,error:"unauthorised"},{status:401});
  let body:Record<string,unknown>;
  try{body=await request.json();}catch{return Response.json({ok:false,error:"invalid_json"},{status:400});}
  const status=String(body.status||"");
  const queue=String(body.queue||"");
  if(!body.creatorId||!body.idempotencyKey||!body.eventType||!body.source||!body.receiptKey||!body.workflowType||
    !["queued","running","completed","failed"].includes(status)||!["intake","ai"].includes(queue)){
    return Response.json({ok:false,error:"invalid_automation_callback"},{status:400});
  }
  try{
    let publicUrl:string|undefined;
    if(body.publicUrl){
      const candidate=new URL(String(body.publicUrl));
      if(!["http:","https:"].includes(candidate.protocol))throw new Error("Receipt URL must use HTTP or HTTPS.");
      publicUrl=candidate.toString();
    }
    const eventId=applyAutomationCallback({
      creatorId:String(body.creatorId),idempotencyKey:String(body.idempotencyKey),eventType:String(body.eventType),
      source:String(body.source),queue:queue as "intake"|"ai",status:status as "queued"|"running"|"completed"|"failed",
      receiptKey:String(body.receiptKey),workflowType:String(body.workflowType),
      externalId:body.externalId?String(body.externalId):undefined,publicUrl,
      detail:body.detail&&typeof body.detail==="object"?body.detail as Record<string,unknown>:undefined,
      verified:body.verified===true,error:body.error?String(body.error):undefined,
    });
    return Response.json({ok:true,eventId});
  }catch(error){
    const message=error instanceof Error?error.message:"Automation callback failed.";
    const statusCode=message.includes("Creator workspace")?404:500;
    return Response.json({ok:false,error:message},{status:statusCode});
  }
}
