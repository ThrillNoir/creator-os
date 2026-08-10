"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enqueueStagingJob } from "@/lib/cloudflare/staging-gateway";
import { getAutomationEvent, markAutomationEventDispatched, markAutomationEventDispatchFailed, markAutomationEventDispatching } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export async function retryAutomationEventAction(formData:FormData){
  const creator=await getActiveCreator();
  const idempotencyKey=String(formData.get("idempotencyKey")||"");
  const event=getAutomationEvent(creator.id,idempotencyKey);
  if(!event)throw new Error("Automation event is outside the active creator workspace.");
  if(!["dispatch_failed","failed"].includes(event.status))throw new Error("Only failed automation events can be retried.");
  let payload:Record<string,unknown>={};
  try{payload=JSON.parse(event.payload) as Record<string,unknown>;}catch{throw new Error("Automation event payload is invalid.");}
  try{
    markAutomationEventDispatching(creator.id,idempotencyKey);
    await enqueueStagingJob({queue:event.queue,creatorId:creator.id,eventType:event.event_type,idempotencyKey,payload});
    markAutomationEventDispatched(creator.id,idempotencyKey);
  }catch(error){
    markAutomationEventDispatchFailed(creator.id,idempotencyKey,error instanceof Error?error.message:"Cloudflare dispatch failed.");
  }
  revalidatePath("/automation");
  redirect("/automation");
}
