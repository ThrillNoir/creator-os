import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("messages UX keeps scope visible, settings permission-aware, and actions contextual", async () => {
  const [page, actions, css] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/app/actions.ts"),
    source("src/app/globals.css"),
  ]);
  assert.match(page, /Workspace messaging totals/);
  assert.match(page, /Viewing \{connectionLabel\(selectedInstagram\)\}/);
  assert.match(page, /canApproveMessaging/);
  assert.match(page, /MessageRefreshButton/);
  assert.match(page, /open=\{canApproveMessaging/);
  assert.match(actions, /function messagesRedirect/);
  assert.match(actions, /redirect\(messagesRedirect\(formData, "authority"\)\)/);
  assert.match(css, /\.message-workspace \{ display: grid; grid-template-columns: minmax\(220px/);
  assert.match(css, /\.thread-list-actions \{ display: flex; flex-wrap: wrap/);
});

test("quick reply state is controlled and keyed by thread at the page boundary", async () => {
  const [page, reply, actions] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/components/message-quick-reply.tsx"),
    source("src/app/actions.ts"),
  ]);
  assert.match(page, /key=\{`instagram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`telegram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`fansly:\$\{thread\.id\}`\}/);
  assert.match(reply, /useRef\(""\)/);
  assert.match(reply, /value=\{body\}/);
  assert.match(reply, /requestIdRef\.current \|\| crypto\.randomUUID\(\)/);
  assert.match(reply, /event\.preventDefault\(\)/);
  assert.match(reply, /formData\.set\("inline", "1"\)/);
  assert.match(reply, /setBody\(""\)/);
  assert.match(reply, /router\.refresh\(\)/);
  assert.match(reply, /role="alert"/);
  assert.match(actions, /inlineMessageRequest/);
  assert.match(actions, /satisfies InlineMessageResult/);
  assert.match(actions, /saved: "fansly_reply_queued"/);
});

test("messaging review keeps audit collapsed and avoids unimplemented automatic-send language", async () => {
  const page = await source("src/app/messages/page.tsx");
  assert.doesNotMatch(page, /attentionEvent/);
  assert.doesNotMatch(page, /Automatic sending/);
  assert.match(page, /Operate — validated connection/);
  assert.match(page, /<details className="panel message-audit">/);
});
