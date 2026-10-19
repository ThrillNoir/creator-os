import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
function compile(source, dependencies) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)((name) => { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`); }, exports);
  return exports;
}
const librarySource = await readFile(new URL('../src/lib/library.ts', import.meta.url), 'utf8');
const start = librarySource.indexOf('export async function getNativeImagePreviewRecoverySession(');
const end = librarySource.indexOf('\nexport ', start + 1);
test('reload recovery resolves only the current creator’s verified original session', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE assets(id TEXT,creator_id TEXT,media_r2_key TEXT,source_available INTEGER,preview_r2_key TEXT);
      CREATE TABLE asset_storage_objects(id TEXT,asset_id TEXT,creator_id TEXT,ingest_status TEXT,source_revision TEXT,object_key TEXT);
      CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT);
      CREATE TABLE asset_ingest_sessions(id TEXT,asset_id TEXT,creator_id TEXT,storage_object_id TEXT,ingest_kind TEXT,status TEXT,finalization_state TEXT,source_revision TEXT,object_key TEXT,updated_at TEXT);
      INSERT INTO assets VALUES('photo','own','private-original',1,NULL),('other','foreign','other-original',1,NULL);
      INSERT INTO asset_storage_objects VALUES('object','photo','own','verified','native:upload','private-original'),('other-object','other','foreign','verified','native:other','other-original');
      INSERT INTO asset_media_authorities VALUES('photo','own','r2_native'),('other','foreign','r2_native');
      INSERT INTO asset_ingest_sessions VALUES('session','photo','own','object','native_image','finalized','verified','native:upload','private-original',CURRENT_TIMESTAMP),('other-session','other','foreign','other-object','native_image','finalized','verified','native:other','other-original',CURRENT_TIMESTAMP);`);
    const code = ts.transpileModule(librarySource.slice(start, end).replace('export async', 'async'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const lookup = new Function('cloudflareEnv', `${code}; return getNativeImagePreviewRecoverySession;`)(() => ({ DB: { prepare(sql) { return { bind(...params) { return { async first() { return db.prepare(sql).get(...params) ?? null; } }; } }; } } }));
    assert.equal((await lookup('own', 'photo')).id, 'session');
    assert.equal(await lookup('own', 'other'), null);
    db.exec("UPDATE asset_ingest_sessions SET finalization_state='verifying' WHERE id='session'");
    assert.equal(await lookup('own', 'photo'), null);
    db.exec("UPDATE asset_ingest_sessions SET finalization_state='verified'; UPDATE assets SET media_r2_key='changed' WHERE id='photo'");
    assert.equal(await lookup('own', 'photo'), null);
    db.exec("UPDATE assets SET media_r2_key='private-original',preview_r2_key='ready-preview' WHERE id='photo'");
    assert.equal(await lookup('own', 'photo'), null);
  } finally { db.close(); }
});
const retrySource = await readFile(new URL('../src/components/native-image-preview-retry.tsx', import.meta.url), 'utf8');
const retryModule = compile(retrySource, { 'react': React, 'react/jsx-runtime': jsxRuntime, 'next/navigation': { useRouter: () => ({ refresh() {} }) } });
test('persisted retry calls finalization without reupload and refreshes retained originals', async () => {
  const calls = []; let refreshes = 0;
  const fetcher = async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true, status: 'finalized', replay: true, preview: 'failed' }); };
  assert.equal(await retryModule.retrySavedNativePreview('saved-session', fetcher, () => refreshes++), false);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/source-media/intents/saved-session/finalize');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.body, undefined); assert.equal(refreshes, 1);
  await assert.rejects(() => retryModule.retrySavedNativePreview('saved-session', async () => Response.json({ ok: false }, { status: 404 }), () => refreshes++));
  assert.equal(refreshes, 1);
  assert.equal(await retryModule.retrySavedNativePreview('saved-session', async () => Response.json({ ok: true, preview: 'ready' }), () => refreshes++), true);
});
const pageSource = await readFile(new URL('../src/app/library/[objectId]/page.tsx', import.meta.url), 'utf8');
for (const role of ['creator', 'viewer']) {
  test(`reloaded failed-preview detail ${role === 'viewer' ? 'hides mutation from viewers' : 'offers persistent retry'}`, async () => {
    let recoveryReads = 0; const passthrough = (props) => React.createElement('div', null, props.children);
    const page = compile(pageSource, {
      'react/jsx-runtime': jsxRuntime, 'next/navigation': { notFound() { throw new Error('notFound'); } },
      'next/headers': { headers: async () => new Headers({ host: 'app.example.test' }) },
      '@/lib/cloudflare': { cloudflareEnv: () => ({ CONTENT_DOWNLOAD_LINKS_ENABLED: '0', PORTFOLIO_AUTHORING_ENABLED: '0' }) },
      '@/lib/portfolio-authoring': { getPortfolioItem: async () => assert.fail('disabled portfolio must not read items') },
      '@/app/portfolio/actions': { togglePortfolioItemAction: () => assert.fail('disabled portfolio must not mutate items') },
      '@/components/content-link-form': { ContentLinkForm: () => null },
      '@/app/actions': { saveAssetAttributesAction() {} }, '@/components/app-shell': { AppShell: passthrough, PageHeader: () => null },
      '@/components/attribute-fields': { AttributeFields: () => null }, '@/components/creator-friend-fields': { CreatorFriendFields: () => null },
      '@/components/private-stream-player': { PrivateStreamPlayer: () => null },
      '@/components/verified-video-preview': { VerifiedVideoPreview: () => null },
      '@/components/video-poster-editor': { VideoPosterEditor: () => assert.fail('native image fixture must not render video poster editor') },
      '@/lib/verified-video-preview': { canPreviewVerifiedVideo: () => false },
      '@/components/native-image-preview-retry': { NativeImagePreviewRetry: ({ sessionId }) => React.createElement('button', { 'data-session': sessionId }, 'Retry private preview') },
      '@/lib/authorization': { roleCan: (value) => value !== 'viewer' }, '@/lib/identity': { requireCreatorContext: async () => ({ creator: { creator_id: 'own', role } }) },
      'next/link': (props) => React.createElement('a', props),
      '@/lib/library': {
        getAssetByObjectId: async () => ({ id: 'photo', basename: 'synthetic.png', media_state: 'preview_failed', preview_r2_key: null, video_state: null }),
        getAssetEvents: async () => [], getAttachedFriends: async () => [], getCreatorFriends: async () => [], objectIdFor: () => null,
        getNativeImagePreviewRecoverySession: async (creator, asset) => { recoveryReads++; assert.equal(creator, 'own'); assert.equal(asset, 'photo'); return { id: 'saved-session' }; },
      },
    }).default;
    const html = renderToStaticMarkup(await page({ params: Promise.resolve({ objectId: 'photo' }), searchParams: Promise.resolve({}) }));
    assert.match(html, /Private preview is unavailable/); assert.doesNotMatch(html, /<img/);
    if (role === 'viewer') { assert.doesNotMatch(html, /Retry private preview/); assert.equal(recoveryReads, 0); }
    else { assert.match(html, /Retry private preview/); assert.equal(recoveryReads, 1); }
  });
}
