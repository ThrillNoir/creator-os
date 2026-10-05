import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import ts from 'typescript';
import { ownPng } from './helpers/local-media-journey-fixture.mjs';
const source = await readFile(new URL('../src/lib/native-media.ts', import.meta.url), 'utf8');
const exports = {};
new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((name) => {
  if (name === 'server-only' || name === './source-media') return {};
  throw new Error(name);
}, exports);

test('a real local R2/Images binding creates and decodes the private native preview', { timeout: 20000 }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-06-01',
    script: "export default {fetch(){return new Response('synthetic local fixture')}}",
    r2Buckets: ['SOURCES', 'PREVIEWS'], images: { binding: 'IMAGES' },
    outboundService: () => new Response('External providers are disabled in this fixture', { status: 403 }),
  }));
  try {
    const sources = await mf.getR2Bucket('SOURCES');
    const previews = await mf.getR2Bucket('PREVIEWS');
    const images = await mf.getImagesBinding('IMAGES');
    const stored = await sources.put('synthetic-original', ownPng, { httpMetadata: { contentType: 'image/png' } });
    const result = await exports.createNativeImagePreview({ libraryMedia: sources, previews, images, creatorId: 'fixture-creator', assetId: 'fixture-photo', objectKey: 'synthetic-original', expectedEtag: stored.etag, sourceSha256: createHash('sha256').update(ownPng).digest('hex') });
    assert.equal(result.width, 64); assert.equal(result.height, 64);
    const derivative = await previews.get(result.objectKey);
    assert.equal(derivative.httpMetadata.contentType, 'image/jpeg');
    assert.equal(derivative.httpMetadata.cacheControl, 'private, no-store');
    const decoded = await images.info(derivative.body);
    assert.equal(decoded.format, 'image/jpeg'); assert.equal(decoded.width, 64);
    const retained = await sources.get('synthetic-original');
    assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), ownPng);
    await assert.rejects(() => exports.createNativeImagePreview({ libraryMedia: sources, previews, images, creatorId: 'fixture-creator', assetId: 'fixture-photo', objectKey: 'synthetic-original', expectedEtag: 'changed-etag', sourceSha256: 'a'.repeat(64) }), /source_object_changed_during_preview/);
  } finally { await mf.dispose(); }
});
