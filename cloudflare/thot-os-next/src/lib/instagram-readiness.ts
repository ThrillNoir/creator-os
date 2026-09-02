export type InstagramReadinessConnection = {
  status: string;
  write_enabled: number;
  outbound_validated: number;
  last_error: string | null;
};

export function instagramSendingBlocker(connection: InstagramReadinessConnection | undefined, replyWindowOpen: boolean, paused: boolean): string | null {
  if (paused) return "Messaging is paused for this creator.";
  if (!connection) return "The selected Instagram account is not connected to this conversation.";
  if (connection.status === "restricted") return connection.last_error || "Instagram messaging is restricted for this account. Do not retry until independently authorised.";
  if (connection.status !== "connected") return connection.last_error || "The selected Instagram account is not connected.";
  if (!connection.write_enabled) return "Instagram sending authority is disabled for this account.";
  if (!connection.outbound_validated) return "Validate the recipient for this Instagram conversation before sending.";
  if (!replyWindowOpen) return "The Instagram reply window is closed. Ask the person to send a new message, then refresh.";
  return null;
}
