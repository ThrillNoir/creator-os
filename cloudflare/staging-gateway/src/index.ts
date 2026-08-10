interface R2Bucket {
  put(key:string,value:string,options?:{httpMetadata?:{contentType?:string}}):Promise<unknown>;
}
interface Queue {
  send(message:unknown,options?:{contentType?:"json"}):Promise<void>;
}
interface QueueMessage<T> {
  id:string;
  attempts:number;
  body:T;
  ack():void;
  retry(options?:{delaySeconds?:number}):void;
}
interface MessageBatch<T> { messages:Array<QueueMessage<T>> }

interface Env {
  INTAKE: R2Bucket;
  PACKAGES: R2Bucket;
  INTAKE_QUEUE: Queue;
  AI_QUEUE: Queue;
  STAGING_GATEWAY_TOKEN: string;
  CREATOR_OS_CALLBACK_URL?:string;
  CREATOR_OS_CALLBACK_TOKEN?:string;
}

type GatewayQueue = "intake" | "ai";
type AutomationMessage = {
  type:string;
  source:string;
  creatorId:string;
  idempotencyKey:string;
  payload:Record<string,unknown>;
  queuedAt:string;
};
type JobBody = Partial<Pick<AutomationMessage,"creatorId"|"idempotencyKey"|"payload">> & {
  queue?:GatewayQueue;
  eventType?:string;
};

function authorised(request:Request,env:Env){
  const expected=env.STAGING_GATEWAY_TOKEN?.trim();
  return Boolean(expected)&&request.headers.get("authorization")===`Bearer ${expected}`;
}

function isAutomationMessage(value:unknown):value is AutomationMessage{
  if(!value||typeof value!=="object")return false;
  const item=value as Record<string,unknown>;
  return typeof item.type==="string"&&typeof item.source==="string"&&typeof item.creatorId==="string"&&
    typeof item.idempotencyKey==="string"&&typeof item.queuedAt==="string"&&Boolean(item.payload)&&typeof item.payload==="object";
}

async function notifyCreatorOS(env:Env,input:{
  creatorId:string;idempotencyKey:string;eventType:string;queue:GatewayQueue;
  status:"queued"|"running"|"completed"|"failed";receiptKey:string;workflowType:string;
  detail?:Record<string,unknown>;error?:string;
}){
  const url=env.CREATOR_OS_CALLBACK_URL?.trim();
  const token=env.CREATOR_OS_CALLBACK_TOKEN?.trim();
  if(!url||!token)return false;
  const response=await fetch(url,{
    method:"POST",
    headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
    body:JSON.stringify({...input,source:"cloudflare.staging-gateway"}),
  });
  if(!response.ok)throw new Error(`CreatorOS callback failed (${response.status}).`);
  return true;
}

async function processMessage(message:AutomationMessage,env:Env){
  const safeKey=message.idempotencyKey.replace(/[^a-zA-Z0-9._:-]/g,"_");
  await env.INTAKE.put(
    `events/${message.creatorId}/${safeKey}.json`,
    JSON.stringify({...message,processedAt:new Date().toISOString()}),
    {httpMetadata:{contentType:"application/json"}},
  );

  if(message.type==="library.indexed"){
    const childKey=`${message.idempotencyKey}:asset-intelligence`;
    await env.AI_QUEUE.send({
      type:"asset.intelligence.requested",
      source:"cloudflare.staging-gateway",
      creatorId:message.creatorId,
      idempotencyKey:childKey,
      payload:{...message.payload,parentIdempotencyKey:message.idempotencyKey},
      queuedAt:new Date().toISOString(),
    },{contentType:"json"});
    await notifyCreatorOS(env,{
      creatorId:message.creatorId,idempotencyKey:message.idempotencyKey,eventType:message.type,queue:"intake",
      status:"completed",receiptKey:`${message.idempotencyKey}:intake-routed`,workflowType:"cloudflare.intake.route",
      detail:{nextEvent:"asset.intelligence.requested",nextIdempotencyKey:childKey},
    });
    return;
  }

  if(message.type==="asset.intelligence.requested"){
    const notified=await notifyCreatorOS(env,{
      creatorId:message.creatorId,idempotencyKey:message.idempotencyKey,eventType:message.type,queue:"ai",
      status:"queued",receiptKey:`${message.idempotencyKey}:local-required`,workflowType:"local.asset-intelligence",
      detail:{state:"awaiting_local_worker",parentIdempotencyKey:message.payload.parentIdempotencyKey},
    });
    if(!notified)throw new Error("CreatorOS callback is not configured for local asset-intelligence work.");
    return;
  }

  await notifyCreatorOS(env,{
    creatorId:message.creatorId,idempotencyKey:message.idempotencyKey,eventType:message.type,queue:"ai",
    status:"failed",receiptKey:`${message.idempotencyKey}:unsupported`,workflowType:"cloudflare.unsupported-event",
    error:`Unsupported event type: ${message.type}`,
  });
}

const worker={
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health"){
      return Response.json({
        ok:true,service:"creator-os-staging-gateway",environment:"staging",
        resources:{intakeBucket:Boolean(env.INTAKE),packagesBucket:Boolean(env.PACKAGES),intakeQueue:Boolean(env.INTAKE_QUEUE),aiQueue:Boolean(env.AI_QUEUE)},
        callbackConfigured:Boolean(env.CREATOR_OS_CALLBACK_URL&&env.CREATOR_OS_CALLBACK_TOKEN),timestamp:new Date().toISOString(),
      });
    }
    if(request.method==="POST"&&url.pathname==="/jobs"){
      if(!authorised(request,env))return Response.json({ok:false,error:"unauthorised"},{status:401});
      let body:JobBody;
      try{body=await request.json();}catch{return Response.json({ok:false,error:"invalid_json"},{status:400});}
      if(!body.queue||!body.creatorId||!body.eventType||!body.idempotencyKey||!body.payload||
        (body.queue!=="intake"&&body.queue!=="ai")){
        return Response.json({ok:false,error:"queue_creator_event_idempotency_and_payload_required"},{status:400});
      }
      const queue=body.queue==="intake"?env.INTAKE_QUEUE:env.AI_QUEUE;
      await queue.send({type:body.eventType,source:"creator-os-staging-gateway",creatorId:body.creatorId,
        idempotencyKey:body.idempotencyKey,payload:body.payload,queuedAt:new Date().toISOString()},{contentType:"json"});
      return Response.json({ok:true,queue:body.queue,idempotencyKey:body.idempotencyKey},{status:202});
    }
    return Response.json({ok:false,error:"not_found",service:"creator-os-staging-gateway"},{status:404});
  },

  async queue(batch:MessageBatch<unknown>,env:Env):Promise<void>{
    for(const item of batch.messages){
      if(!isAutomationMessage(item.body)){
        console.error("Discarding invalid automation message",{messageId:item.id});
        item.ack();
        continue;
      }
      try{
        await processMessage(item.body,env);
        item.ack();
      }catch(error){
        console.error("Automation message failed",{messageId:item.id,attempts:item.attempts,error:String(error)});
        item.retry({delaySeconds:Math.min(30*(2**Math.max(0,item.attempts-1)),3600)});
      }
    }
  },
};

export default worker;
