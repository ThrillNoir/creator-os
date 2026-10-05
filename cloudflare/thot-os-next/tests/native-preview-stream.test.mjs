import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/native-media.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)((name) => {
  if (name === 'server-only') return {};
  if (name === './source-media') return {};
  throw new Error(name);
}, exports);
const stream = (bytes) => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
test('native preview consumes a proxied conditional R2 body exactly once', async () => {
  const original = Uint8Array.of(1,2,3); const derivative = Uint8Array.of(4,5,6);
  let reads = 0; const puts = [];
  const sourceObject = new Proxy({}, {
    has(_target, key) { if (key === 'body') { reads++; return true; } return false; },
    get(_target, key) {
      if (key === 'body') { assert.equal(reads++, 0, 'body is obtained once'); return stream(original); }
      if (key === 'arrayBuffer') return () => { throw new Error('Body has already been used'); };
    },
  });
  const transformer = {
    transform() { return this; },
    async output() { return { image: () => stream(derivative) }; },
  };
  const result = await exports.createNativeImagePreview({
    libraryMedia: { async get(key, options) { assert.equal(key, 'private-original'); assert.deepEqual(options, { onlyIf: { etagMatches: 'original-etag' } }); return sourceObject; } },
    images: { input() { return transformer; }, async info(body) { assert.deepEqual(new Uint8Array(await new Response(body).arrayBuffer()), derivative); return { format: 'image/jpeg', width: 64, height: 64 }; } },
    previews: { async put(key, bytes, options) { puts.push({ key, bytes, options }); } },
    creatorId: 'own', assetId: 'photo', objectKey: 'private-original', expectedEtag: 'original-etag', sourceSha256: 'a'.repeat(64),
  });
  assert.equal(reads, 1); assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].bytes, derivative); assert.deepEqual(original, Uint8Array.of(1,2,3));
  assert.equal(puts[0].options.httpMetadata.cacheControl, 'private, no-store');
  assert.match(result.objectKey, /^creators\/own\/assets\/[a-f0-9]{64}\/previews\/[a-f0-9]{64}\.jpg$/);
});
test('failed conditional reads never create a preview from an unmatched original', async () => {
  let imageCalls = 0;
  await assert.rejects(() => exports.createNativeImagePreview({
    libraryMedia: { async get() { return { etag: 'changed' }; } },
    images: { input() { imageCalls++; } }, previews: { put() { throw Error('unexpected'); } },
    creatorId:'own', assetId:'photo', objectKey:'private-original',expectedEtag:'original-etag',sourceSha256:'a'.repeat(64),
  }), /source_object_changed_during_preview/);
  assert.equal(imageCalls, 0);
});
