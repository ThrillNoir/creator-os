import "server-only";

import path from "node:path";
import { completeTelegramCreatorMessage, completeTelegramHandoff, createTelegramCreatorMessage, createTelegramHandoff, failCreatorReminder, failTelegramCreatorMessage, failTelegramHandoff, getAgencyIntegration, getCreator, getCreatorReminderForSending, getCreatorServiceConnections, getPostPackage, getPostPackageAssets, getTelegramCreatorPairing, markCreatorReminderSent } from "@/lib/db";
import { executeComposioTool } from "@/lib/integrations/composio";

type TelegramResponse = { ok?: boolean; result?: { message_id?: number } };

function splitTelegramText(text: string, limit = 4000) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.6)) cut = remaining.lastIndexOf(" ", limit);
    if (cut < 1) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function platformOpenUrl(platform: string) {
  if (platform === "instagram") return "https://www.instagram.com/";
  if (platform === "x") return "https://x.com/compose/post";
  if (platform === "tiktok") return "https://www.tiktok.com/upload";
  return "";
}

function platformLabel(platform: string) {
  if (platform === "instagram") return "Instagram";
  if (platform === "x") return "X";
  if (platform === "tiktok") return "TikTok";
  return "platform";
}

export async function sendApprovedPostToTelegram(creatorId: string, postPackageId: number) {
  const post = getPostPackage(postPackageId);
  if (!post || post.creator_id !== creatorId) throw new Error("Post package is outside the active creator workspace.");
  if (post.status !== "approved" || !post.approved_at) throw new Error("Only a currently approved package can be sent to Telegram.");
  const pairing = getTelegramCreatorPairing(creatorId);
  if (!pairing) throw new Error("Pair this creator's private Telegram chat first.");
  const services = getCreatorServiceConnections(creatorId);
  const telegram = getAgencyIntegration("telegram");
  const dropbox = services.find((item) => item.service === "dropbox" && item.status === "connected" && item.identity_confirmed_at);
  if (!telegram) throw new Error("The agency Telegram bot is not connected.");
  if (!dropbox) throw new Error("Dropbox must be connected to deliver original media to Telegram.");
  const creator = getCreator(creatorId);
  const marker = `${path.sep}Dropbox${path.sep}`;
  const markerIndex = creator?.media_source?.indexOf(marker) ?? -1;
  if (!creator?.media_source || markerIndex < 0) throw new Error("The creator media source is not inside the connected Dropbox folder.");
  const rootInDropbox = creator.media_source.slice(markerIndex + marker.length).split(path.sep).join("/");
  const assets = getPostPackageAssets(postPackageId);
  if (!assets.length) throw new Error("This package has no media to hand off.");
  const handoffId = createTelegramHandoff({ creatorId, postPackageId, chatId: pairing.chat_id, assetCount: assets.length });
  const entityId = telegram.composio_user_id || "creator-os:agency:telegram";
  const messageIds: string[] = [];
  let sentAssetCount = 0;
  try {
    for (const [index, asset] of assets.entries()) {
      const dropboxPath = `/${[rootInDropbox, asset.relative_path].filter(Boolean).join("/")}`;
      const temporary = await executeComposioTool<{ link?: string }>({ slug: "DROPBOX_GET_TEMPORARY_LINK", connectedAccountId: dropbox.connected_account_id, entityId: `creator-os:${creatorId}:service:dropbox`, arguments: { path: dropboxPath } });
      if (!temporary.link) throw new Error(`Dropbox did not return a link for asset ${index + 1}.`);
      const delivery = await executeComposioTool<TelegramResponse>({
        slug: "TELEGRAM_SEND_DOCUMENT", connectedAccountId: telegram.connected_account_id, entityId,
        arguments: {
          chat_id: pairing.chat_id,
          document: temporary.link,
          caption: assets.length > 1 ? `1. Asset ${index + 1}/${assets.length}` : "1. Asset",
          reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "Download", url: temporary.link }]] }),
        },
      });
      if (!delivery.ok || !delivery.result?.message_id) throw new Error(`Telegram did not confirm asset ${index + 1}.`);
      messageIds.push(String(delivery.result.message_id));
      sentAssetCount += 1;
    }
    const openUrl = platformOpenUrl(post.platform);
    const label = platformLabel(post.platform);
    const canUseNativeCopy = post.caption.length > 0 && post.caption.length <= 256;
    const handoffText = ["2. Caption", post.caption || "No caption supplied."].join("\n");
    const chunks = splitTelegramText(handoffText);
    for (const [index, chunk] of chunks.entries()) {
      const showActions = index === chunks.length - 1;
      const actionRow = [
        ...(canUseNativeCopy ? [{ text: "Copy caption", copy_text: { text: post.caption } }] : []),
        ...(openUrl ? [{ text: `Open ${label}`, url: openUrl }] : []),
      ];
      const buttons = actionRow.length ? [actionRow] : [];
      const delivery = await executeComposioTool<TelegramResponse>({
        slug: "TELEGRAM_SEND_MESSAGE", connectedAccountId: telegram.connected_account_id, entityId,
        arguments: { chat_id: pairing.chat_id, text: chunk, disable_web_page_preview: true, ...(showActions && buttons.length ? { reply_markup: JSON.stringify({ inline_keyboard: buttons }) } : {}) },
      });
      if (!delivery.ok || !delivery.result?.message_id) throw new Error("Telegram did not confirm the caption message.");
      messageIds.push(String(delivery.result.message_id));
    }
    completeTelegramHandoff({ id: handoffId, creatorId, messageIds, sentAssetCount });
    return { handoffId, sentAssetCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram handoff failed.";
    failTelegramHandoff({ id: handoffId, creatorId, messageIds, sentAssetCount, error: message });
    throw new Error(sentAssetCount ? `Telegram handoff stopped after ${sentAssetCount}/${assets.length} assets: ${message}` : message);
  }
}

export async function sendApprovedCreatorReminder(creatorId: string, reminderId: number) {
  const reminder = getCreatorReminderForSending(creatorId,reminderId);
  if (!reminder || reminder.status !== "approved") throw new Error("Reminder needs human approval before sending.");
  const pairing = getTelegramCreatorPairing(creatorId);
  const telegram = getAgencyIntegration("telegram");
  if (!pairing || !telegram) throw new Error("Pair and connect the creator's Telegram chat first.");
  const url = platformOpenUrl(reminder.platform);
  try {
    const delivery = await executeComposioTool<TelegramResponse>({
      slug:"TELEGRAM_SEND_MESSAGE", connectedAccountId:telegram.connected_account_id,
      entityId:telegram.composio_user_id || "creator-os:agency:telegram",
      arguments:{
        chat_id:pairing.chat_id,text:reminder.message,
        ...(url ? {reply_markup:JSON.stringify({inline_keyboard:[[{text:`Open ${platformLabel(reminder.platform)}`,url}] ]})} : {}),
      },
    });
    if (!delivery.ok || !delivery.result?.message_id) throw new Error("Telegram did not confirm the reminder.");
    markCreatorReminderSent(creatorId,reminderId,String(delivery.result.message_id));
  } catch (error) {
    const message=error instanceof Error?error.message:"Telegram reminder failed.";
    failCreatorReminder(creatorId,reminderId,message);
    throw new Error(message);
  }
}

export async function sendAgencyMessageToCreator(creatorId: string, messageText: string) {
  const text = messageText.trim();
  if (!text || text.length > 4000) throw new Error("Message must be between 1 and 4,000 characters.");
  const pairing = getTelegramCreatorPairing(creatorId);
  const telegram = getAgencyIntegration("telegram");
  if (!pairing) throw new Error("Pair this creator's Telegram chat first.");
  if (!telegram) throw new Error("The agency Telegram bot is not connected.");
  const messageId = createTelegramCreatorMessage({ creatorId, chatId: pairing.chat_id, messageText: text });
  try {
    const delivery = await executeComposioTool<TelegramResponse>({
      slug: "TELEGRAM_SEND_MESSAGE",
      connectedAccountId: telegram.connected_account_id,
      entityId: telegram.composio_user_id || "creator-os:agency:telegram",
      arguments: { chat_id: pairing.chat_id, text, disable_web_page_preview: true },
    });
    if (!delivery.ok || !delivery.result?.message_id) throw new Error("Telegram did not confirm the message.");
    completeTelegramCreatorMessage({ id: messageId, creatorId, telegramMessageId: String(delivery.result.message_id) });
    return { messageId, telegramMessageId: String(delivery.result.message_id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram message failed.";
    failTelegramCreatorMessage({ id: messageId, creatorId, error: message });
    throw new Error(message);
  }
}
