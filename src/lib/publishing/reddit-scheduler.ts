import "server-only";

import {getApprovedRedditTargetsForPublishing} from "@/lib/db";
import {isRedditTargetDue,publishApprovedRedditTarget} from "@/lib/publishing/composio-reddit";

export async function processDueRedditTargets(){
  const due=getApprovedRedditTargetsForPublishing(20).filter((target)=>Boolean(target.scheduled_at)&&isRedditTargetDue(target.scheduled_at));
  for(const target of due){
    try{await publishApprovedRedditTarget(target.creator_id,target.id);}catch(error){console.error(`Scheduled Reddit target ${target.id} failed`,error);}
  }
  return due.length;
}

export function startRedditScheduler(){
  const runtime=globalThis as typeof globalThis&{__creatorOsRedditScheduler?:ReturnType<typeof setInterval>};
  if(runtime.__creatorOsRedditScheduler)return;
  const run=()=>void processDueRedditTargets().catch((error)=>console.error("Reddit scheduler failed",error));
  setTimeout(run,5_000);
  runtime.__creatorOsRedditScheduler=setInterval(run,30_000);
  runtime.__creatorOsRedditScheduler.unref?.();
}
