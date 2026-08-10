import "server-only";

import { randomBytes } from "node:crypto";
import { createTelegramPairingInvite, getActiveTelegramPairingInvite, getAgencyIntegration, recordTelegramPairingCandidate } from "@/lib/db";
import { executeComposioTool } from "@/lib/integrations/composio";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string; username?: string; first_name?: string; last_name?: string };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
  };
};

export function createRemoteTelegramPairing(creatorId:string){
  const agency=getAgencyIntegration("telegram");
  if(!agency?.display_name) throw new Error("The agency Telegram bot is not connected.");
  const username=agency.display_name.replace(/^@/,"");
  if(!username) throw new Error("The agency Telegram bot username is unavailable.");
  const token=randomBytes(24).toString("base64url");
  const expiresAt=new Date(Date.now()+30*60*1000).toISOString().replace("T"," ").replace("Z","");
  createTelegramPairingInvite(creatorId,token,expiresAt);
  return `https://t.me/${username}?start=cos_${token}`;
}

export async function discoverRemoteTelegramPairing(creatorId:string){
  const agency=getAgencyIntegration("telegram");
  const invite=getActiveTelegramPairingInvite(creatorId);
  if(!agency||!invite) throw new Error("Create a fresh Telegram pairing link first.");
  const response=await executeComposioTool<{ok?:boolean;result?:TelegramUpdate[]}>(
    {slug:"TELEGRAM_GET_UPDATES",connectedAccountId:agency.connected_account_id,entityId:agency.composio_user_id||"creator-os:agency:telegram",arguments:{limit:100,timeout:0,allowed_updates:["message"]}}
  );
  if(!response.ok) throw new Error("Telegram could not check for the creator's Start message. A webhook may already be active.");
  const expected=`/start cos_${invite.token}`;
  const update=(response.result||[]).find((item)=>item.message?.text?.trim()===expected&&item.message.chat?.type==="private"&&!item.message.from?.is_bot);
  if(!update?.message?.chat?.id||!update.message.from?.id||update.update_id==null) return false;
  const person=update.message.from;
  recordTelegramPairingCandidate({creatorId,inviteId:invite.id,chatId:String(update.message.chat.id),userId:String(person.id),username:person.username||"",displayName:[person.first_name,person.last_name].filter(Boolean).join(" ")||"Telegram user",updateId:String(update.update_id)});
  return true;
}
