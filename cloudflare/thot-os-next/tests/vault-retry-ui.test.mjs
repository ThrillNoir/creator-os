import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { canRetryVaultJob, vaultJobStatusCopy } from '../src/lib/vault-job-status.ts';

const source = await readFile(new URL('../src/app/operations/page.tsx', import.meta.url), 'utf8');
const start = source.indexOf('async function VaultWorkspace(');
const end = source.indexOf('\nexport default', start);
const code = ts.transpileModule(source.slice(start, end).replace('async function VaultWorkspace', 'export async function VaultWorkspace'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jobs = [
  { id:'safe', status:'failed', receipt:'{"outcome":"failed"}', basename:'Synthetic safe failure', bytes:1 },
  { id:'uncertain', status:'failed', receipt:'{"outcome":"uncertain"}', basename:'Synthetic uncertain failure', bytes:1 },
  { id:'malformed', status:'failed', receipt:'{', basename:'Synthetic malformed receipt', bytes:1 },
];
let pairing = null;
const dependencies = {
  getVaultOperations: async () => ({ accounts: [{platform: "fansly", handle: "@synthetic"}], assets: [{id:"own-asset",basename:"Synthetic asset",extension:"jpg",safety:"paid-ready"}], jobs, pairing }),
  vaultSections: [['queue','Upload queue'],['create','Send to vault']],
  Link: ({children,...props}) => React.createElement('a',props,children),
  Image: () => null, formatDate: () => 'Synthetic date', statusClass: () => '',
  retryFanslyVaultJobAction: '/synthetic-retry', createFanslyVaultJobsAction: '/synthetic-approve', createOwnFanslyVaultJobAction: '/synthetic-own',
  objectIdFor: () => null, canRetryVaultJob, vaultJobStatusCopy,
};
const exports = {};
new Function('require','exports',...Object.keys(dependencies),code)((name)=> { if(name==='react/jsx-runtime')return jsxRuntime;throw new Error(name); },exports,...Object.values(dependencies));
async function render(canApprove,section='queue') {
  return renderToStaticMarkup(await exports.VaultWorkspace({ creatorId:'own',section,canManageIdentity:false,canApprove }));
}
test('only a certain failed receipt offers staff retry; uncertainty and malformed evidence remain held', async () => {
  const html=await render(true);
  assert.equal((html.match(/>Retry<\/button>/g)??[]).length,1);
  assert.match(html,/value="safe"/);
  assert.doesNotMatch(html,/value="uncertain"|value="malformed"/);
  assert.match(html,/held for reconciliation/);
});
test('creator and viewer workspaces explain agency approval without exposing retry or approve controls', async () => {
  for(const section of ['queue','create']) {
    const html=await render(false,section);
    assert.match(html,/Agency approval required/);
    assert.doesNotMatch(html,/>Retry<\/button>|Approve selected for Fansly|>Send content<\/a>/);
  }
  assert.match(await render(true,'create'),/Approve selected for Fansly/);
});

test('creator can send one asset without staff approval, retry, or pairing controls', async () => {
  const html = renderToStaticMarkup(await exports.VaultWorkspace({creatorId:'own',section:'create',canManageIdentity:false,canApprove:false,isCreator:true}));
  assert.match(html,/action="\/synthetic-own"/);
  assert.match(html,/Send one asset to my vault/);
  assert.match(html,/Inspection mode does not upload automatically/);
  assert.match(html,/type="radio"[^>]*name="assetId"/);
  assert.doesNotMatch(html,/type="checkbox" name="assetId"/);
  assert.match(html,/Ask your agency operator/);
  assert.doesNotMatch(html,/Agency approval required|Approve selected for Fansly|installationId|synthetic-retry/);
});

test('verified creator gets native vault handoff without browser pairing controls', async () => {
  pairing={profile_status:'paired',last_seen_at:'2026-01-01',verified_at:'2026-01-01'};
  try {
    const html=renderToStaticMarkup(await exports.VaultWorkspace({creatorId:'own',section:'queue',canManageIdentity:false,canApprove:false,isCreator:true}));
    assert.match(html,/href="https:\/\/fansly.com\/creator\/vault"/);
    assert.doesNotMatch(html,/installationId|Pair bridge|synthetic-retry|Review bridge credential/);
  } finally { pairing=null; }
});

test('verified creator queued-success explains popup arming and one overlay click', async () => {
  pairing={profile_status:'paired',last_seen_at:'2026-01-01',verified_at:'2026-01-01'};
  try {
    const html=renderToStaticMarkup(await exports.VaultWorkspace({creatorId:'own',section:'queue',saved:'vault_queued',canManageIdentity:false,canApprove:false,isCreator:true}));
    assert.match(html,/Your asset is queued for Fansly/);
    assert.match(html,/In the extension popup, choose Arm one manual vault upload, then click Attempt one private vault upload in the vault overlay once/);
    assert.doesNotMatch(html,/press Upload approved content/);
  } finally { pairing=null; }
});
test('unverified creator queued-success directs operator setup without promising a vault link', async () => {
  const html=renderToStaticMarkup(await exports.VaultWorkspace({creatorId:'own',section:'queue',saved:'vault_queued',canManageIdentity:false,canApprove:false,isCreator:true}));
  assert.match(html,/Ask your agency operator to set up your assigned browser before completing the upload/);
  assert.doesNotMatch(html,/Open your signed vault below|href="https:\/\/fansly.com\/creator\/vault"/);
});
