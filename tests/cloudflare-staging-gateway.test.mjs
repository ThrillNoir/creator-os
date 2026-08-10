import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/staging-gateway/src/index.ts";

function environment(){
  const intakeMessages=[];const aiMessages=[];const objects=[];
  return {
    env:{
      INTAKE:{async put(key,value,options){objects.push({key,value,options});}},
      PACKAGES:{async put(){}},
      INTAKE_QUEUE:{async send(message,options){intakeMessages.push({message,options});}},
      AI_QUEUE:{async send(message,options){aiMessages.push({message,options});}},
      STAGING_GATEWAY_TOKEN:"test-token",
    },intakeMessages,aiMessages,objects,
  };
}

test("gateway rejects unauthorised jobs",async()=>{
  const {env}=environment();
  const response=await worker.fetch(new Request("https://worker.test/jobs",{method:"POST",body:"{}"}),env);
  assert.equal(response.status,401);
});

test("gateway queues a creator-scoped JSON event",async()=>{
  const {env,intakeMessages}=environment();
  const response=await worker.fetch(new Request("https://worker.test/jobs",{
    method:"POST",headers:{authorization:"Bearer test-token","content-type":"application/json"},
    body:JSON.stringify({queue:"intake",creatorId:"adelaide",eventType:"library.indexed",idempotencyKey:"sync-1",payload:{assetCount:70}}),
  }),env);
  assert.equal(response.status,202);
  assert.equal(intakeMessages.length,1);
  assert.equal(intakeMessages[0].message.creatorId,"adelaide");
  assert.equal(intakeMessages[0].message.idempotencyKey,"sync-1");
  assert.deepEqual(intakeMessages[0].options,{contentType:"json"});
});

test("intake consumer archives and routes library events",async()=>{
  const {env,aiMessages,objects}=environment();
  let acknowledged=false;
  const message={id:"message-1",attempts:1,body:{type:"library.indexed",source:"test",creatorId:"adelaide",idempotencyKey:"sync-1",payload:{assetCount:70},queuedAt:new Date().toISOString()},ack(){acknowledged=true;},retry(){throw new Error("should not retry");}};
  await worker.queue({messages:[message]},env);
  assert.equal(acknowledged,true);
  assert.equal(objects.length,1);
  assert.equal(aiMessages.length,1);
  assert.equal(aiMessages[0].message.type,"asset.intelligence.requested");
  assert.equal(aiMessages[0].message.idempotencyKey,"sync-1:asset-intelligence");
});

test("consumer acknowledges invalid messages without retrying",async()=>{
  const {env}=environment();
  let acknowledged=false;let retried=false;
  await worker.queue({messages:[{id:"bad",attempts:1,body:{nope:true},ack(){acknowledged=true;},retry(){retried=true;}}]},env);
  assert.equal(acknowledged,true);
  assert.equal(retried,false);
});

test("AI handoff retries when the private CreatorOS callback is unavailable",async()=>{
  const {env}=environment();
  let acknowledged=false;let retryDelay=0;
  const message={id:"ai-1",attempts:1,body:{type:"asset.intelligence.requested",source:"test",creatorId:"adelaide",idempotencyKey:"sync-1:asset-intelligence",payload:{},queuedAt:new Date().toISOString()},ack(){acknowledged=true;},retry(options){retryDelay=options.delaySeconds;}};
  await worker.queue({messages:[message]},env);
  assert.equal(acknowledged,false);
  assert.equal(retryDelay,30);
});
