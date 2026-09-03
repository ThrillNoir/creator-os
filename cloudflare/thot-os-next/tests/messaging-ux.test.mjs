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
  const [page, reply] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/components/message-quick-reply.tsx"),
  ]);
  assert.match(page, /key=\{`instagram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`telegram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`fansly:\$\{thread\.id\}`\}/);
  assert.match(reply, /useRef\(""\)/);
  assert.match(reply, /value=\{body\}/);
  assert.match(reply, /requestIdRef\.current \|\| crypto\.randomUUID\(\)/);
});
