import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const bridgeDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(bridgeDirectory, "../..");
const apiRoot = "https://backend.composio.dev/api/v3.1";

function digest(value) {
  return value == null || value === "" ? null : createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function suffix(value, length = 6) {
  return value == null ? null : String(value).slice(-length);
}

function readDotEnv(path) {
  const entries = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

async function jsonRequest(path, apiKey, init = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const localEnvironment = readDotEnv(resolve(repositoryRoot, ".env.local"));
const apiKey = localEnvironment.COMPOSIO_API_KEY;
if (!apiKey) throw new Error("The local Composio project key is unavailable.");

const database = new Database(resolve(repositoryRoot, ".creator-os/creator-os.sqlite"), { readonly: true });
const expected = database.prepare(`SELECT connected_account_id,composio_user_id,external_account_id,display_name
  FROM agency_integrations WHERE service='telegram' AND status='connected'`).get();
database.close();
if (!expected) throw new Error("The canonical Telegram service identity is unavailable.");

const accountsResult = await jsonRequest("/connected_accounts?toolkit_slugs=telegram&limit=100", apiKey);
const accounts = Array.isArray(accountsResult.body.items) ? accountsResult.body.items : [];
const matchingAccount = accounts.find((account) => account.id === expected.connected_account_id);

const authConfigsResult = await jsonRequest("/auth_configs?toolkit_slug=telegram&limit=100", apiKey);
const authConfigs = Array.isArray(authConfigsResult.body.items) ? authConfigsResult.body.items : [];
const matchingAuthConfig = authConfigs.find((config) => config.id === matchingAccount?.auth_config?.id);

const getMeResult = await jsonRequest("/tools/execute/TELEGRAM_GET_ME", apiKey, {
  method: "POST",
  body: JSON.stringify({
    connected_account_id: expected.connected_account_id,
    user_id: expected.composio_user_id,
    version: "latest",
    arguments: {},
  }),
});
const getMeData = getMeResult.body.data ?? getMeResult.body;
const bot = getMeData.result;
const expectedUsername = String(expected.display_name ?? "").replace(/^@/, "").toLowerCase();

const negativeResult = await jsonRequest("/tools/execute/TELEGRAM_GET_ME", apiKey, {
  method: "POST",
  body: JSON.stringify({
    connected_account_id: expected.connected_account_id,
    user_id: `thot-os:identity-negative:${randomUUID()}`,
    version: "latest",
    arguments: {},
  }),
});
const negativeMessage = String(negativeResult.body?.error?.message ?? negativeResult.body?.error ?? negativeResult.body?.message ?? "");

const logsResult = await jsonRequest("/logs/tool_execution", apiKey, {
  method: "POST",
  body: JSON.stringify({
    limit: 100,
    filters: [{ field: "toolkit_slug", operator: "==", value: "telegram" }],
    time_range: { from: Date.now() - 3 * 86_400_000, to: Date.now() },
  }),
});
const logs = Array.isArray(logsResult.body.logs) ? logsResult.body.logs : [];
const currentWorkerExecution = logs.find((entry) => entry.status === "success" && entry.metadata?.tool?.slug === "TELEGRAM_GET_UPDATES");

const receipt = {
  checked_at: new Date().toISOString(),
  project_scope: {
    api_key_hash: digest(apiKey),
    authenticated: accountsResult.response.ok && authConfigsResult.response.ok,
    telegram_auth_config_hash: digest(matchingAuthConfig?.id),
    telegram_auth_config_suffix: suffix(matchingAuthConfig?.id),
    telegram_auth_config_name_hash: digest(matchingAuthConfig?.name),
    telegram_auth_config_name_suffix: suffix(matchingAuthConfig?.name, 8),
  },
  connected_account: {
    total_telegram_accounts: accounts.length,
    id_hash: digest(matchingAccount?.id),
    id_suffix: suffix(matchingAccount?.id),
    user_hash: digest(matchingAccount?.user_id),
    user_suffix: suffix(matchingAccount?.user_id, 8),
    status: matchingAccount?.status ?? null,
    matches_canonical_account: matchingAccount?.id === expected.connected_account_id,
    belongs_to_canonical_user: matchingAccount?.user_id === expected.composio_user_id,
  },
  telegram_get_me: {
    http_status: getMeResult.response.status,
    authenticated: getMeResult.response.ok && getMeResult.body.successful !== false,
    is_bot: bot?.is_bot === true,
    bot_id_hash: digest(bot?.id),
    bot_id_suffix: suffix(bot?.id, 4),
    numeric_id_matches: String(bot?.id ?? "") === String(expected.external_account_id),
    username_hash: digest(String(bot?.username ?? "").toLowerCase()),
    username_suffix: suffix(bot?.username, 8),
    username_matches: String(bot?.username ?? "").toLowerCase() === expectedUsername,
  },
  negative_pair: {
    http_status: negativeResult.response.status,
    failed_closed: !negativeResult.response.ok || negativeResult.body.successful === false,
    ownership_error: /does not match|user id|connected account/i.test(negativeMessage),
    error_hash: digest(negativeMessage),
  },
  rolled_back_worker_observation: {
    execution_found: Boolean(currentWorkerExecution),
    connected_account_hash: digest(currentWorkerExecution?.metadata?.connected_account_id),
    user_hash: digest(currentWorkerExecution?.metadata?.user_id),
    exact_pair_matches: currentWorkerExecution?.metadata?.connected_account_id === expected.connected_account_id
      && currentWorkerExecution?.metadata?.user_id === expected.composio_user_id,
    tool: currentWorkerExecution?.metadata?.tool?.slug ?? null,
    status: currentWorkerExecution?.status ?? null,
  },
  telegram_side_effects: {
    get_updates_called_by_this_check: false,
    polling_called_by_this_check: false,
    messages_sent: false,
    posts_created: false,
    uploads_created: false,
  },
};

const passed = receipt.project_scope.authenticated
  && receipt.connected_account.status === "ACTIVE"
  && receipt.connected_account.matches_canonical_account
  && receipt.connected_account.belongs_to_canonical_user
  && receipt.telegram_get_me.authenticated
  && receipt.telegram_get_me.is_bot
  && receipt.telegram_get_me.numeric_id_matches
  && receipt.telegram_get_me.username_matches
  && receipt.negative_pair.failed_closed
  && receipt.negative_pair.ownership_error
  && receipt.rolled_back_worker_observation.exact_pair_matches;

console.log(JSON.stringify({ passed, ...receipt }, null, 2));
if (!passed) process.exitCode = 1;
