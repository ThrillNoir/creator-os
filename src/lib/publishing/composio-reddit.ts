import "server-only";

import path from "node:path";
import {
  claimRedditTargetForPublishing,
  completeRedditTargetPublishing,
  failRedditTargetPublishing,
  getCreator,
  getCreatorServiceConnections,
  getPostPackage,
  getPostPackageAssets,
  getRedditTarget,
} from "@/lib/db";
import {executeComposioTool} from "@/lib/integrations/composio";

type UnknownRecord=Record<string,unknown>;

function asRecord(value:unknown):UnknownRecord|undefined{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as UnknownRecord:undefined;
}

function collectFlairs(value:unknown,depth=0):Array<{id:string;text:string}>{
  if(depth>4)return [];
  if(Array.isArray(value))return value.flatMap((item)=>collectFlairs(item,depth+1));
  const record=asRecord(value);
  if(!record)return [];
  const id=typeof record.id==="string"?record.id:typeof record.flair_id==="string"?record.flair_id:"";
  const text=typeof record.text==="string"?record.text:typeof record.name==="string"?record.name:typeof record.flair_text==="string"?record.flair_text:"";
  return [...(id&&text?[{id,text}]:[]),...Object.values(record).flatMap((item)=>collectFlairs(item,depth+1))];
}

function receiptFrom(value:unknown){
  const root=asRecord(value)??{};
  const data=asRecord(root.data)??root;
  const success=typeof data.success==="boolean"?data.success:typeof root.success==="boolean"?root.success:undefined;
  if(success===false){
    const message=[data.validation_message,data.validation_error,data.message,root.message].find((item)=>typeof item==="string");
    throw new Error(typeof message==="string"?message:"Reddit rejected the post.");
  }
  const externalPostId=[data.name,data.fullname,data.id,root.name,root.id].find((item)=>typeof item==="string") as string|undefined;
  let externalUrl=[data.url,data.permalink,root.url,root.permalink].find((item)=>typeof item==="string") as string|undefined;
  if(externalUrl?.startsWith("/"))externalUrl=`https://www.reddit.com${externalUrl}`;
  if(!externalPostId&&!externalUrl)throw new Error("Reddit returned no post receipt. Check the account before retrying.");
  return {externalPostId:externalPostId||externalUrl||"",externalUrl:externalUrl||""};
}

function isDue(scheduledAt:string|null){
  if(!scheduledAt)return true;
  const timestamp=new Date(scheduledAt).getTime();
  return Number.isFinite(timestamp)&&timestamp<=Date.now();
}

export async function publishApprovedRedditTarget(creatorId:string,targetId:number){
  const target=getRedditTarget(targetId);
  if(!target||target.creator_id!==creatorId)throw new Error("Reddit target is outside this creator workspace.");
  if(target.status!=="approved_for_posting")throw new Error("Approve this Reddit target before publishing.");
  if(!isDue(target.scheduled_at))return {status:"scheduled" as const};
  if(!claimRedditTargetForPublishing(creatorId,targetId))throw new Error("This Reddit target is already being processed.");

  try{
    const post=getPostPackage(target.post_package_id);
    const assets=getPostPackageAssets(target.post_package_id);
    const creator=getCreator(creatorId);
    if(!post||post.creator_id!==creatorId||post.status!=="approved")throw new Error("The approved Reddit package is unavailable.");
    if(assets.length!==1)throw new Error("Direct Reddit link posting currently supports exactly one asset.");
    const services=getCreatorServiceConnections(creatorId);
    const reddit=services.find((item)=>item.service==="reddit"&&item.status==="connected"&&item.identity_confirmed_at);
    const dropbox=services.find((item)=>item.service==="dropbox"&&item.status==="connected"&&item.identity_confirmed_at);
    if(!reddit)throw new Error("Connect and verify the creator Reddit identity.");
    if(!dropbox)throw new Error("Connect Dropbox so Reddit can receive the media URL.");
    const marker=`${path.sep}Dropbox${path.sep}`;
    const markerIndex=creator?.media_source?.indexOf(marker)??-1;
    if(!creator?.media_source||markerIndex<0)throw new Error("The creator media source is not inside the connected Dropbox folder.");
    const rootInDropbox=creator.media_source.slice(markerIndex+marker.length).split(path.sep).join("/");
    const dropboxPath=`/${[rootInDropbox,assets[0].relative_path].filter(Boolean).join("/")}`;
    const temporary=await executeComposioTool<{link?:string}>({slug:"DROPBOX_GET_TEMPORARY_LINK",connectedAccountId:dropbox.connected_account_id,entityId:`creator-os:${creatorId}:service:dropbox`,arguments:{path:dropboxPath}});
    if(!temporary.link)throw new Error("Dropbox did not return a media link.");

    let flairId="";
    if(target.flair){
      const flairResponse=await executeComposioTool<unknown>({slug:"REDDIT_LIST_SUBREDDIT_POST_FLAIRS",connectedAccountId:reddit.connected_account_id,entityId:reddit.composio_user_id||`creator-os:${creatorId}:service:reddit`,arguments:{subreddit:target.community_name}});
      const wanted=target.flair.trim().toLowerCase();
      flairId=collectFlairs(flairResponse).find((item)=>item.id===target.flair||item.text.trim().toLowerCase()===wanted)?.id||"";
      if(!flairId)throw new Error(`Reddit flair “${target.flair}” was not found in r/${target.community_name}.`);
    }

    const response=await executeComposioTool<unknown>({slug:"REDDIT_CREATE_REDDIT_POST",connectedAccountId:reddit.connected_account_id,entityId:reddit.composio_user_id||`creator-os:${creatorId}:service:reddit`,arguments:{subreddit:target.community_name,title:target.title,kind:"link",url:temporary.link,...(flairId?{flair_id:flairId}:{})}});
    const receipt=receiptFrom(response);
    let warning="";
    if(post.caption&&post.caption.trim()!==target.title.trim()&&receipt.externalPostId){
      try{
        await executeComposioTool<unknown>({slug:"REDDIT_POST_REDDIT_COMMENT",connectedAccountId:reddit.connected_account_id,entityId:reddit.composio_user_id||`creator-os:${creatorId}:service:reddit`,arguments:{thing_id:receipt.externalPostId,text:post.caption}});
      }catch(error){warning=`Post created, but the caption comment failed: ${error instanceof Error?error.message:"Unknown error"}`;}
    }
    completeRedditTargetPublishing({creatorId,id:targetId,...receipt,warning});
    return {status:"submitted" as const,...receipt,warning};
  }catch(error){
    const message=error instanceof Error?error.message:"Reddit publishing failed.";
    failRedditTargetPublishing(creatorId,targetId,message);
    throw new Error(message);
  }
}

export {isDue as isRedditTargetDue};
