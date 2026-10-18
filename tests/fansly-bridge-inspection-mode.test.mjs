import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/local-bridge-extension/background.js', import.meta.url), 'utf8');
const fanslyThread = 'https://fansly.com/messages/fixture-thread';
const pairedBridge = { platform: 'fansly', token: 'synthetic-token', installationId: 'synthetic-installation', creatorId: 'creator-1', accountId: 'account-1', profileId: 'profile-1' };

function startExtension(initialStorage = {}, responseFor = () => { throw new Error('Unexpected bridge request'); }, options = {}) {
  const storage = { ...initialStorage };
  const calls = { fetch: [], tabQueries: [], tabCreates: [], tabUpdates: [], scripts: [], downloads: [], alarms: [] };
  const listeners = { updated: [], message: [], alarm: [] };
  const onUpdated = { addListener: (fn) => listeners.updated.push(fn), removeListener: (fn) => {
    const index = listeners.updated.indexOf(fn);
    if (index >= 0) listeners.updated.splice(index, 1);
  } };
  const local = {
    async get(keys) {
      const requested = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(requested.filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]]));
    },
    async set(values) { Object.assign(storage, values); },
    async remove(key) { delete storage[key]; },
  };
  const chrome = {
    storage: { local },
    tabs: {
      onUpdated,
      async query(query) { calls.tabQueries.push(query); return []; },
      async create(input) { calls.tabCreates.push(input); return { id: 12, url: input.url }; },
      async update(id, input) { calls.tabUpdates.push({ id, input }); return { id, url: input.url }; },
      async remove() {},
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    alarms: { create: (...args) => calls.alarms.push(args), onAlarm: { addListener: (fn) => listeners.alarm.push(fn) } },
    scripting: { async executeScript(input) { calls.scripts.push(input); return options.executeScript?.(input) ?? [{ result: { sent: true, composerCount: 1, sendControlCount: 1, composerCleared: true, outgoingBubbleAdded: true } }]; } },
    downloads: { async download(input) { calls.downloads.push(input); return 1; } },
    debugger: { async attach() { throw new Error('Unexpected debugger use'); } },
  };
  const context = {
    chrome, crypto: webcrypto, URL, URLSearchParams, Response,
    setTimeout, clearTimeout,
    console: { error() {} },
    fetch: async (url, init) => { calls.fetch.push({ url: String(url), init }); return responseFor(String(url), init); },
  };
  vm.runInNewContext(`${source}\nglobalThis.__testHooks = { getBridgeMode, runFanslyJobs, processOutbox, processVaultQueue, syncTab, collectNextPendingThread, processFanslyMessageOutbox };`, context);
  return { storage, calls, listeners, hooks: context.__testHooks };
}

test('fresh profile remains in inspection mode after synthetic pairing and cannot send, upload or traverse', async () => {
  const browser = startExtension({}, (url) => {
    if (url.endsWith('/status')) return Response.json({ creator_id: 'creator-1', account_id: 'account-1', profile_id: 'profile-1' });
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await browser.hooks.getBridgeMode(), 'inspection');
  const pairUrl = 'https://thot-os-vault-bridge-staging.thot-os.workers.dev/pair#creator_os_bridge_pair=synthetic-token&platform=fansly&next=https%3A%2F%2Ffansly.com%2Fcreator%2Fvault';
  await browser.listeners.updated[0](5, { url: pairUrl }, { url: pairUrl });
  assert.equal(browser.storage.creatorOsBridgeMode, 'inspection');
  assert.equal(browser.storage.creatorOsBridge.token, 'synthetic-token');
  assert.equal(await browser.hooks.getBridgeMode(), 'inspection');

  const requestsAfterPairing = browser.calls.fetch.length;
  await browser.hooks.runFanslyJobs();
  assert.equal(await browser.hooks.syncTab(5, fanslyThread), false);
  assert.equal((await browser.hooks.processFanslyMessageOutbox()).state, 'inspection_mode');
  await browser.hooks.collectNextPendingThread();
  await browser.hooks.processOutbox(5, fanslyThread, browser.storage.creatorOsBridge);
  assert.equal((await browser.hooks.processVaultQueue(5, 'https://fansly.com/creator/vault')).state, 'inspection_mode');
  for (const onAlarm of browser.listeners.alarm) onAlarm({ name: 'thot-os-fansly-sync' });
  for (const onUpdated of browser.listeners.updated) onUpdated(5, { status: 'complete' }, { url: fanslyThread });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(browser.calls.fetch.length, requestsAfterPairing, 'no outbox claim or inbox collection after pairing');
  assert.equal(browser.calls.tabCreates.length, 0, 'no autonomous conversation traversal');
  assert.equal(browser.calls.tabQueries.length, 0);
  assert.equal(browser.calls.scripts.length, 0, 'no native send or upload script');
  assert.equal(browser.calls.downloads.length, 0);
  assert.equal(browser.calls.alarms.length, 0, 'new inspection profile does not schedule work');
});

test('explicit inspection mode blocks an already paired profile even when a draft would be available', async () => {
  const browser = startExtension({ creatorOsBridgeMode: 'inspection', creatorOsBridge: pairedBridge });
  assert.equal(await browser.hooks.getBridgeMode(), 'inspection');
  await browser.hooks.runFanslyJobs();
  await browser.hooks.processOutbox(5, fanslyThread, pairedBridge);
  assert.equal((await browser.hooks.processVaultQueue(5, 'https://fansly.com/creator/vault')).state, 'inspection_mode');
  assert.deepEqual(browser.calls.fetch, [], 'server outbox is not consulted or claimed');
  assert.equal(browser.calls.scripts.length, 0);
  assert.equal(browser.calls.downloads.length, 0);
});

test('previously paired profile without a mode keeps its active outbox path', async () => {
  const browser = startExtension({ creatorOsBridge: pairedBridge }, (url, init = {}) => {
    if (url.includes('/messages/outbox/next')) return Response.json({ ok: true, job: null });
    if (url.includes('/messages/pending-threads')) return Response.json({ ok: true, thread: null });
    if (url.includes('/messages/outbox?')) return Response.json({ ok: true, job: { id: 'draft-1', body: 'synthetic fixture only', claimToken: 'claim-1' } });
    if (url.endsWith('/messages/outbox') && init.method === 'POST') return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await browser.hooks.getBridgeMode(), 'active');
  await browser.hooks.runFanslyJobs();
  await browser.hooks.processOutbox(5, fanslyThread, pairedBridge);
  assert.equal(browser.storage.creatorOsBridgeMode, 'active');
  assert.equal(browser.calls.scripts.length, 1, 'normal path still reaches the mocked native send');
  assert.ok(browser.calls.fetch.some((call) => call.url.includes('/messages/outbox/next')));
  assert.ok(browser.calls.fetch.some((call) => call.url.endsWith('/messages/outbox') && call.init.method === 'POST'));
});

test('switching to inspection while a vault claim is pending prevents media download and native attachment', async () => {
  let claimRequested, resolveClaim, receipt;
  const pendingClaim = new Promise((resolve) => { resolveClaim = resolve; });
  const claimStarted = new Promise((resolve) => { claimRequested = resolve; });
  const browser = startExtension({ creatorOsBridgeMode: 'active' }, (url, init = {}) => {
    if (url.endsWith('/jobs/claim')) { claimRequested(); return pendingClaim; }
    if (url.endsWith('/jobs/job-1/receipt') && init.method === 'POST') {
      receipt = JSON.parse(init.body);
      return Response.json({ ok: true, status: 'failed' });
    }
    throw new Error(`Unexpected bridge request: ${url}`);
  }, {
    executeScript(input) {
      if (input.func?.name === 'prepareFanslyVault') return [{ result: { ready: true } }];
      throw new Error(`Unexpected browser script: ${input.func?.name}`);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  browser.storage.creatorOsBridge = pairedBridge;
  const processing = browser.hooks.processVaultQueue(5, 'https://fansly.com/creator/vault');
  await claimStarted;
  browser.storage.creatorOsBridgeMode = 'inspection';
  resolveClaim(Response.json({ ok: true, job: { id: 'job-1', basename: 'synthetic.jpg', mediaUrl: 'https://bridge.example/media' } }));
  const result = await processing;

  assert.equal(result.state, 'inspection_mode');
  assert.equal(browser.calls.scripts.length, 1, 'only the pre-claim readiness check ran');
  assert.equal(browser.calls.downloads.length, 0, 'no media was downloaded');
  assert.deepEqual(browser.calls.fetch.map((call) => new URL(call.url).pathname), ['/jobs/claim', '/jobs/job-1/receipt']);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.receipt.uploadStarted, false);
  assert.equal(receipt.receipt.outcome, 'failed', 'pre-attachment abort must not be marked as an uncertain upload');
});

const sendBackgroundMessage = (browser, type) => new Promise((resolve) => {
  for (const listener of browser.listeners.message) listener({ type }, {}, resolve);
});

test('one-shot vault arm leaves every automatic message path disabled and consumes one empty manual attempt', async () => {
  const browser = startExtension({ creatorOsBridgeMode: 'inspection', creatorOsBridge: pairedBridge }, (url) => {
    if (url.endsWith('/jobs/claim')) return Response.json({ ok: true, job: null });
    throw new Error(`Unexpected bridge request: ${url}`);
  }, { executeScript(input) {
    if (input.func?.name === 'prepareFanslyVault') return [{ result: { ready: true } }];
    throw new Error(`Unexpected script: ${input.func?.name}`);
  } });
  assert.equal((await sendBackgroundMessage(browser, 'creator-os-vault-once-arm')).mode, 'vault_once');
  assert.equal(await browser.hooks.getBridgeMode(), 'vault_once');
  await browser.hooks.runFanslyJobs();
  await browser.hooks.collectNextPendingThread();
  await browser.hooks.processOutbox(5, fanslyThread, pairedBridge);
  assert.equal(await browser.hooks.syncTab(5, fanslyThread), false);
  assert.equal((await browser.hooks.processFanslyMessageOutbox()).state, 'inspection_mode');
  for (const onAlarm of browser.listeners.alarm) onAlarm({ name: 'thot-os-fansly-sync' });
  for (const onUpdated of browser.listeners.updated) onUpdated(5, { status: 'complete' }, { url: fanslyThread });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(browser.calls.fetch.length, 0, 'arming does not contact the bridge or collect messages');
  assert.equal(browser.calls.tabCreates.length, 0);
  assert.equal(browser.calls.alarms.length, 0);
  const result = await browser.hooks.processVaultQueue(5, 'https://fansly.com/creator/vault');
  assert.equal(result.state, 'empty');
  assert.deepEqual(browser.calls.fetch.map((call) => new URL(call.url).pathname), ['/jobs/claim']);
  assert.equal(browser.calls.downloads.length, 0);
  assert.equal(await browser.hooks.getBridgeMode(), 'inspection');
  assert.equal((await browser.hooks.processVaultQueue(5, 'https://fansly.com/creator/vault')).state, 'inspection_mode');
});

test('one-shot arm expires and a consumed arm cannot resume after a worker restart', async () => {
  const expired = startExtension({ creatorOsBridgeMode: 'vault_once', creatorOsVaultOnceArmedAt: Date.now()-11*60*1000, creatorOsVaultOnceConsumed: false, creatorOsBridge: pairedBridge });
  assert.equal(await expired.hooks.getBridgeMode(), 'inspection');
  const interrupted = startExtension({ creatorOsBridgeMode: 'vault_once', creatorOsVaultOnceArmedAt: Date.now(), creatorOsVaultOnceConsumed: true, creatorOsBridge: pairedBridge });
  assert.equal(await interrupted.hooks.getBridgeMode(), 'inspection');
  assert.equal(interrupted.calls.fetch.length, 0);
});
