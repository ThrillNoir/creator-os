export type IntegrationState = "CONNECTED" | "NEEDS_RECONNECT" | "NOT_CONNECTED" | "ERROR" | "DISABLED" | "UNKNOWN";

export type IntegrationHealthInput = {
  connection_status: string;
  publishing_authority: string;
  warning_level: string;
  provider_status: string | null;
  provider_error: string | null;
};

export function integrationState(account: IntegrationHealthInput): IntegrationState {
  if (account.publishing_authority === "blocked" && account.warning_level === "blocked") return "ERROR";
  if (account.provider_status === "failed" || account.provider_error) return "ERROR";
  if (account.connection_status === "needs_reconnection" || account.provider_status === "expired") return "NEEDS_RECONNECT";
  if (account.connection_status === "connected" && (!account.provider_status || account.provider_status === "active")) return "CONNECTED";
  if (account.connection_status === "not_connected") return "NOT_CONNECTED";
  return "UNKNOWN";
}
