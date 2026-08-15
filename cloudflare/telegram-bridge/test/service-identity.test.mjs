import assert from "node:assert/strict";
import test from "node:test";

import telegramBridge, { executeTelegramTool } from "../src/index.ts";

const correctIdentity = {
  COMPOSIO_API_KEY: "project-key-for-test",
  COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID: "connected-account-for-test",
  COMPOSIO_TELEGRAM_USER_ID: "service-user-for-test",
};

test("every Telegram tool uses the exact configured service user and connected account", async () => {
  const requests = [];
  const fetcher = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ successful: true, data: { ok: true, result: [] } });
  };

  await executeTelegramTool(correctIdentity, "TELEGRAM_GET_ME", {}, fetcher);
  await executeTelegramTool(correctIdentity, "TELEGRAM_GET_UPDATES", { timeout: 0 }, fetcher);

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.connected_account_id, correctIdentity.COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID);
    assert.equal(request.user_id, correctIdentity.COMPOSIO_TELEGRAM_USER_ID);
  }
});

test("a mismatched connected-account/user pair fails closed", async () => {
  const fetcher = async (_url, init) => {
    const request = JSON.parse(init.body);
    const matches = request.connected_account_id === correctIdentity.COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID
      && request.user_id === correctIdentity.COMPOSIO_TELEGRAM_USER_ID;
    if (!matches) {
      return Response.json({ successful: false, error: { message: "Connected account user mismatch." } }, { status: 400 });
    }
    return Response.json({ successful: true, data: { ok: true } });
  };

  await assert.rejects(
    executeTelegramTool(
      { ...correctIdentity, COMPOSIO_TELEGRAM_USER_ID: "wrong-service-user" },
      "TELEGRAM_GET_ME",
      {},
      fetcher,
    ),
    /Connected account user mismatch/,
  );
});

function bridgeDatabase(batchLog) {
  return {
    prepare(sql) {
      const statement = {
        sql,
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async first() {
          if (sql.includes("FROM service_credentials")) {
            return { id: "telegram-service-credential", service_name: "thot-os-web-telegram" };
          }
          if (sql.includes("FROM telegram_connector_state")) {
            return {
              creator_id: "adelaide",
              connection_id: "telegram-adelaide",
              chat_id: "private-chat",
              telegram_user_id: "creator-user",
              telegram_username: "creator",
              display_name: "Creator",
              expected_bot_username: "expected_bot",
              status: "connected",
              next_update_id: 0,
            };
          }
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      batchLog.push(...statements);
      return statements.map(() => ({ success: true }));
    },
  };
}

test("the local validate route uses the service pair and records a creator-scoped audit", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ successful: true, data: { ok: true, result: { id: 1234, username: "expected_bot", is_bot: true } } });
  };
  const batches = [];

  try {
    const response = await telegramBridge.fetch(
      new Request("http://local.test/validate", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(48)}` }, body: JSON.stringify({ creatorId: "adelaide" }) }),
      { ...correctIdentity, DB: bridgeDatabase(batches) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, username: "@expected_bot" });
    assert.equal(requests[0].connected_account_id, correctIdentity.COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID);
    assert.equal(requests[0].user_id, correctIdentity.COMPOSIO_TELEGRAM_USER_ID);
    const audit = batches.find((statement) => statement.sql.includes("INSERT INTO messaging_audit_events"));
    assert.ok(audit);
    assert.equal(audit.bindings[1], "adelaide");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the local validate route rejects a Composio ownership mismatch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { successful: false, error: { message: "Connected account user mismatch." } },
    { status: 400 },
  );
  const batches = [];

  try {
    const response = await telegramBridge.fetch(
      new Request("http://local.test/validate", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(48)}` }, body: JSON.stringify({ creatorId: "adelaide" }) }),
      { ...correctIdentity, DB: bridgeDatabase(batches) },
    );
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Connected account user mismatch/);
    assert.ok(batches.some((statement) => statement.sql.includes("status='failed'")));
    assert.ok(batches.some((statement) => statement.sql.includes("outbound_validated=0")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
