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
const dependencies = {
  getVaultOperations: async () => ({ accounts: [], assets: [], jobs, pairing: null }),
  vaultSections: [['queue','Upload queue'],['create','Send to vault']],
  Link: ({children,...props}) => React.createElement('a',props,children),
  Image: () => null, formatDate: () => 'Synthetic date', statusClass: () => '',
  retryFanslyVaultJobAction: '/synthetic-retry', createFanslyVaultJobsAction: '/synthetic-approve',
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
