import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const execFileAsync = promisify(execFile);
const sessionId = "00000000-0000-4000-8000-000000000001";

function harnessSetup() {
  return `
let hooks = [], cursor = 0, refreshes = 0;
const mockReact = {
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { current: initial };
    return hooks[index];
  },
  createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) }; }
};
const mockRequire = name => name === 'react' ? mockReact : name === 'next/navigation' ? { useRouter: () => ({ refresh: () => refreshes++ }) } : {};
const exported = {};
`;
}

function harnessRun(kind) {
  return `
function render() { cursor = 0; return exported.NativeMediaUploader(); }
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) { const found = find(child, predicate); if (found) return found; }
  return null;
}
function item() { return hooks[0]?.[0]; }
function waitForStatus(status, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (item()?.status === status) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for ' + status + '; current=' + item()?.status));
      setTimeout(poll, 10);
    };
    poll();
  });
}
(async () => {
  try {
    const tree = render();
    const file = new File(['synthetic browser regression bytes'], 'synthetic-regression.jpg', { type: 'image/jpeg' });
    find(tree, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [file] }, currentTarget: { value: 'fixture' } });
    const queued = render();
    find(queued, node => node.type === 'button' && node.props.className === 'primary').props.onClick();
    await waitForStatus(${JSON.stringify(kind === "retry" ? "attention" : kind === "baseline" ? "failed" : "complete")});
    if (${JSON.stringify(kind)} === 'retry') {
      const attention = render();
      const retry = find(attention, node => node.type === 'button' && node.props.className === 'secondary-action' && node.children.includes('Retry preview'));
      if (!retry) throw new Error('Preview retry button was not rendered');
      retry.props.onClick();
      await waitForStatus('complete');
    }
    document.body.textContent = JSON.stringify({ status: item()?.status, progress: item()?.progress, detail: item()?.detail, refreshes });
  } catch (error) {
    document.body.textContent = JSON.stringify({ harnessError: error?.stack ?? String(error) });
  }
})();
`;
}

function makePage(compiledModule, kind) {
  return `<!doctype html><meta charset="utf-8"><body>pending<script>${harnessSetup()}
(function(exports, require, React) {\n${compiledModule}\n})(exported, mockRequire, mockReact);\n${harnessRun(kind)}</script>`;
}

function readBodyResult(stdout) {
  const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error("Chrome did not return a body result");
  const text = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const result = JSON.parse(text);
  if (result.harnessError) throw new Error(`Browser harness failed: ${result.harnessError}`);
  return result;
}

export async function runNativeImageFetchBrowserRegression({ sourcePath, chromePath = process.env.THOT_CHROME_PATH ?? "/usr/bin/google-chrome" }) {
  const originalSource = await readFile(sourcePath, "utf8");
  const fixedMarker = "fetcher: (input, init) => fetch(input, init),";
  const historicalMarker = "fetcher: fetch,";
  if (!originalSource.includes(fixedMarker)) {
    throw new Error("Production uploader must retain the bound fetch wrapper before browser acceptance can pass");
  }
  const historicalSource = originalSource.replace(fixedMarker, historicalMarker);

  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pages = {
    baseline: makePage(compile(historicalSource), "baseline"),
    fixed: makePage(compile(originalSource), "fixed"),
    retry: makePage(compile(originalSource), "retry"),
  };
  const requests = [];
  let activeCase = "";
  let retryFinalizations = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method !== "GET") requests.push({ case: activeCase, method: request.method, path: request.url, bytes: Buffer.concat(chunks).length });
    const json = (status, data) => {
      const body = Buffer.from(JSON.stringify(data));
      response.writeHead(status, { "content-type": "application/json", "content-length": body.length, "cache-control": "no-store" });
      response.end(body);
    };
    if (request.method === "GET" && Object.hasOwn(pages, request.url.slice(1))) {
      activeCase = request.url.slice(1);
      retryFinalizations = 0;
      const page = Buffer.from(pages[activeCase]);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": page.length, "cache-control": "no-store" });
      response.end(page);
    } else if (request.method === "POST" && request.url === "/api/source-media/native/intents") {
      json(201, { ok: true, sessionId, assetId: "synthetic-asset", status: "created", partBytes: 1024 * 1024 });
    } else if (request.method === "PUT" && request.url === `/api/source-media/intents/${sessionId}/parts/1`) {
      json(200, { ok: true, partNumber: 1 });
    } else if (request.method === "POST" && request.url === `/api/source-media/intents/${sessionId}/finalize`) {
      retryFinalizations += 1;
      json(200, { ok: true, preview: activeCase === "retry" && retryFinalizations === 1 ? "failed" : "ready" });
    } else {
      json(404, { ok: false, error: "synthetic_route_not_found" });
    }
  });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });

  const results = {};
  try {
    for (const kind of Object.keys(pages)) {
      const profile = await mkdtemp(join(tmpdir(), "thot-native-image-browser-"));
      try {
        const url = `http://127.0.0.1:${server.address().port}/${kind}`;
        const args = [
          "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--no-first-run",
          "--disable-default-apps", "--disable-extensions", "--disable-component-update", "--disable-sync",
          "--metrics-recording-only", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          `--user-data-dir=${profile}`, "--virtual-time-budget=8000", "--dump-dom", url,
        ];
        let stdout;
        try {
          ({ stdout } = await execFileAsync(chromePath, args, { timeout: 25000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
        } catch (error) {
          const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
          if (error.code === "ENOENT") throw new Error(`Chrome executable not found at ${chromePath}; set THOT_CHROME_PATH to a local Chrome binary`);
          throw new Error(`Chrome failed for ${kind} (code ${error.code ?? "unknown"}): ${output.slice(-3000)}`);
        }
        results[kind] = readBodyResult(stdout);
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const caseRequests = (name) => requests.filter((item) => item.case === name).map(({ method, path }) => ({ method, path }));
  assert.equal(results.baseline.status, "failed", "the historical unbound fetch must reproduce the 95% finalization failure");
  assert.equal(results.baseline.progress, 95);
  assert.deepEqual(caseRequests("baseline").map(({ path }) => path), [
    "/api/source-media/native/intents",
    `/api/source-media/intents/${sessionId}/parts/1`,
  ], "historical uploader must stop after intent and part, before finalize");
  assert.equal(results.fixed.status, "complete", "the wrapped fetch must complete the private synthetic upload");
  assert.equal(results.fixed.progress, 100);
  assert.deepEqual(caseRequests("fixed").map(({ path }) => path), [
    "/api/source-media/native/intents",
    `/api/source-media/intents/${sessionId}/parts/1`,
    `/api/source-media/intents/${sessionId}/finalize`,
  ], "fixed uploader must request intent, part, and finalize");
  assert.equal(results.retry.status, "complete", "the shared preview retry must complete after the synthetic preview recovers");
  assert.equal(results.retry.progress, 100);
  assert.deepEqual(caseRequests("retry").map(({ path }) => path), [
    "/api/source-media/native/intents",
    `/api/source-media/intents/${sessionId}/parts/1`,
    `/api/source-media/intents/${sessionId}/finalize`,
    `/api/source-media/intents/${sessionId}/finalize`,
  ], "preview retry must reuse finalize without uploading another part");

  return {
    chromePath,
    outcomes: results,
    requests: Object.fromEntries(Object.keys(pages).map((kind) => [kind, caseRequests(kind)])),
    network: "localhost only; synthetic payloads; no credentials or private media",
  };
}
