import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { fanslyJourney } from '../src/lib/fansly-journey.ts';
import { vaultJobNextAction, vaultJobStatusCopy } from '../src/lib/vault-job-status.ts';
import { agencyRevoked, creatorNotCheckedIn, creatorReady, uncertainJob, verifiedJob } from './fixtures/fansly-journey.mjs';

const componentSource = await readFile(new URL('../src/components/fansly-journey-summary.tsx', import.meta.url), 'utf8');
const componentCode = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const componentExports = {};
new Function('require', 'exports', componentCode)((name) => {
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name === '@/lib/fansly-journey') return { fanslyJourney };
  throw new Error(`Unexpected import: ${name}`);
}, componentExports);
const render = (fixture) => renderToStaticMarkup(jsxRuntime.jsx(componentExports.FanslyJourneySummary, { ...fixture }));

test('two creators and profiles remain distinct in the rendered task context', () => {
  const a = render(creatorReady);
  const b = render(creatorNotCheckedIn);
  assert.match(a, /Creator A Fansly.*Profile A/);
  assert.doesNotMatch(a, /Creator B|Profile B/);
  assert.match(b, /Creator B Fansly.*Profile B/);
  assert.doesNotMatch(b, /Creator A|Profile A/);
});

test('paired without a check-in remains a waiting step, not a current-online claim', () => {
  const state = fanslyJourney(creatorNotCheckedIn);
  assert.equal(state.steps.find((step) => step.label === 'Bridge pairing')?.state, 'done');
  assert.equal(state.steps.find((step) => step.label === 'Check-in record')?.state, 'waiting');
  assert.match(state.nextAction, /no check-in is recorded/);
  assert.match(render(creatorNotCheckedIn), /No verified check-in recorded/);
});

test('revoked profile blocks the journey and gives an agency replacement step', () => {
  const state = fanslyJourney(agencyRevoked);
  assert.equal(state.steps.find((step) => step.label === 'Assigned Chrome profile')?.state, 'blocked');
  assert.equal(state.steps.find((step) => step.label === 'Bridge pairing')?.state, 'waiting');
  assert.match(state.nextAction, /Assign a valid Chrome profile/);
  assert.match(render(agencyRevoked), /Profile B was revoked/);
});

test('creator and agency have different next actions when pairing is incomplete', () => {
  const partial = { ...creatorReady, pairingVerified: false };
  assert.match(fanslyJourney(partial).nextAction, /Ask an agency administrator/);
  assert.match(fanslyJourney({ ...partial, role: 'agency' }).nextAction, /Check the existing pairing tab/);
  assert.match(fanslyJourney({ ...partial, role: 'staff' }).nextAction, /Ask an agency administrator/);
  assert.doesNotMatch(fanslyJourney({ ...partial, role: 'staff' }).nextAction, /^Pair the assigned profile/);
});

test('verified and uncertain jobs give distinct safe guidance', () => {
  assert.match(vaultJobStatusCopy(verifiedJob.status, verifiedJob.receipt), /saved vault record/);
  assert.match(vaultJobNextAction(verifiedJob.status, verifiedJob.receipt, true), /Inspection mode/);
  assert.match(vaultJobStatusCopy(uncertainJob.status, uncertainJob.receipt), /held for reconciliation/);
  assert.match(vaultJobNextAction(uncertainJob.status, uncertainJob.receipt, true), /before any retry/);
});
