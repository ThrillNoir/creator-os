"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveCreator } from "@/lib/current-creator";
import { confirmTelegramPairingCandidate, revokeCreatorTelegramPairing } from "@/lib/db";
import { createRemoteTelegramPairing, discoverRemoteTelegramPairing } from "@/lib/telegram-pairing";

export async function createTelegramPairingLinkAction(){
  const creator=await getActiveCreator();
  createRemoteTelegramPairing(creator.id);
  revalidatePath(`/creators/${creator.id}`);
  redirect(`/creators/${creator.id}?telegramPairing=created`);
}

export async function checkTelegramPairingAction(){
  const creator=await getActiveCreator();
  const found=await discoverRemoteTelegramPairing(creator.id);
  revalidatePath(`/creators/${creator.id}`);
  redirect(`/creators/${creator.id}?telegramPairing=${found?"candidate":"waiting"}`);
}

export async function confirmTelegramPairingAction(formData:FormData){
  const creator=await getActiveCreator();
  const inviteId=Number(formData.get("inviteId"));
  if(!Number.isInteger(inviteId)||formData.get("identityConfirmed")!=="yes") throw new Error("Confirm the returned Telegram identity before pairing it.");
  confirmTelegramPairingCandidate(creator.id,inviteId);
  revalidatePath(`/creators/${creator.id}`);
  redirect(`/creators/${creator.id}?telegramPairing=paired`);
}

export async function revokeTelegramPairingAction(){
  const creator=await getActiveCreator();
  revokeCreatorTelegramPairing(creator.id);
  revalidatePath(`/creators/${creator.id}`);
  redirect(`/creators/${creator.id}?telegramPairing=revoked`);
}
