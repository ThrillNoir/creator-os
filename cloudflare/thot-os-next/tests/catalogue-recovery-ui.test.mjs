import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function compile(source, dependencies, formData = FormData) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', 'FormData', code)((name) => { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`); }, exports, formData);
  return exports;
}
const batchSource = await readFile(new URL('../src/components/library-batch-form.tsx', import.meta.url), 'utf8');
function selection(count, duplicate = false) {
  const data = new FormData();
  for (let index = 0; index < count; index++) data.append('assetId', `asset-${index}`);
  if (duplicate) data.append('assetId', 'asset-0');
  data.set('notes', 'Unsaved classification remains available');
  return data;
}
function batchFixture(data) {
  const updates = [];
  const module = compile(batchSource, { 'react': { useState: (value) => [value, (next) => updates.push(next)] }, 'react/jsx-runtime': jsxRuntime, 'react-dom': { useFormStatus: () => ({ pending: false }) } }, class { constructor(form) { return form.data; } });
  const action = async () => { throw new Error('Server action must not be invoked by validation'); };
  const element = module.LibraryBatchForm({ action, children: 'Existing inputs' });
  let prevented = false;
  const event = { currentTarget: { data }, preventDefault() { prevented = true; } };
  return { module, updates, element, event, prevented: () => prevented };
}
test('empty and oversized selections stay in the form with actionable inline errors', () => {
  for (const count of [0, 51]) {
    const fixture = batchFixture(selection(count));
    fixture.element.props.onSubmit(fixture.event);
    assert.equal(fixture.prevented(), true);
    assert.match(fixture.updates.at(-1), count ? /no more than 50/ : /at least one asset/);
    assert.equal(fixture.event.currentTarget.data.get('notes'), 'Unsaved classification remains available');
    assert.equal(fixture.event.currentTarget.data.getAll('assetId').length, count);
  }
});
test('valid and duplicate selections retain the original server action and clear old feedback', () => {
  const fixture = batchFixture(selection(50, true));
  fixture.element.props.onSubmit(fixture.event);
  assert.equal(fixture.prevented(), false);
  fixture.element.props.onChange(fixture.event);
  assert.deepEqual(fixture.updates, [50, null]);
  assert.equal(typeof fixture.element.props.action, 'function');
});
test('batch submission disables repeated clicks while the server action is pending', () => {
  const module = compile(batchSource, { 'react': React, 'react/jsx-runtime': jsxRuntime, 'react-dom': { useFormStatus: () => ({ pending: true }) } });
  const button = module.LibraryBatchSubmit();
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.children, 'Saving selected assets…');
});
const errorSource = await readFile(new URL('../src/app/error.tsx', import.meta.url), 'utf8');
test('production error recovery remains in the affected section and does not promise an unchanged outcome', () => {
  for (const path of ['/money', '/growth', '/operations', '/library', '/messages/thread', '/adult-profile']) {
    const module = compile(errorSource, { 'react/jsx-runtime': jsxRuntime, 'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }, 'next/navigation': { usePathname: () => path } });
    const html = renderToStaticMarkup(module.default({ error: new Error('private DB detail'), reset() {} }));
    assert.match(html, /confirm the result/);
    assert.match(html, /check its current state before repeating/);
    assert.doesNotMatch(html, /previous data is safe/);
    assert.match(html, new RegExp(`href="${path.startsWith('/messages') ? '/messages' : path}"`));
  }
});
