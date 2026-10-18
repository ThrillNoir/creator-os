import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { fanslyJourney } from '../../src/lib/fansly-journey.ts';
import { vaultJobNextAction, vaultJobStatusCopy } from '../../src/lib/vault-job-status.ts';
import { agencyRevoked, creatorNotCheckedIn, creatorReady, uncertainJob, verifiedJob } from './fansly-journey.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../..');
const outputDir = process.argv[2];
if (!outputDir) throw new Error('Pass a local output directory for synthetic fixture HTML.');
await mkdir(outputDir, { recursive: true });

const source = await readFile(path.join(app, 'src/components/fansly-journey-summary.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const componentExports = {};
new Function('require', 'exports', code)((name) => {
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name === '@/lib/fansly-journey') return { fanslyJourney };
  throw new Error(`Unexpected import: ${name}`);
}, componentExports);

const theme = await readFile(path.join(app, 'src/app/boldkit-theme.css'), 'utf8');
const css = (await readFile(path.join(app, 'src/app/globals.css'), 'utf8')).replace(/^@import .*;\s*$/gm, '');
const scenarios = [
  ['creator-ready', creatorReady, verifiedJob],
  ['creator-no-checkin', creatorNotCheckedIn, uncertainJob],
  ['agency-revoked', agencyRevoked, uncertainJob],
];

for (const [name, context, job] of scenarios) {
  const summary = renderToStaticMarkup(jsxRuntime.jsx(componentExports.FanslyJourneySummary, { ...context }));
  const outcome = vaultJobStatusCopy(job.status, job.receipt);
  const nextAction = vaultJobNextAction(job.status, job.receipt, context.role === 'creator');
  const html = `<!doctype html><html class="dark" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>THOT OS Fansly synthetic preview — ${name}</title><style>${theme}\n${css}</style></head><body><main class="workspace" style="max-width:1180px;margin:auto"><header class="top"><div><span class="eyebrow">SYNTHETIC OFFLINE FIXTURE</span><h1>Fansly Operations</h1><p>Representative UI only. No login, provider call or live creator data.</p></div></header><nav class="ops-subnav" aria-label="Vault operations"><a class="active" aria-current="page" href="#queue">Upload queue</a><a href="#prepare">Prepare upload</a></nav>${summary}<section class="panel fansly-latest-result" aria-labelledby="fansly-latest-title"><div><span class="eyebrow">LAST RECORDED UPLOAD</span><h2 id="fansly-latest-title">${job.basename}</h2><p>${outcome}</p><p>${nextAction}</p><small>Current extension mode is visible only in the Chrome popup; this receipt does not confirm that mode.</small></div><a class="secondary-action" href="#queue">View this job</a></section><section class="panel" id="queue" style="padding:18px"><h2>Fansly upload queue</h2><p>${context.role === 'creator' ? 'Your own workspace and permitted upload status.' : 'Agency review of this creator’s upload status.'}</p></section></main></body></html>`;
  await writeFile(path.join(outputDir, `fansly-${name}.html`), html);
}
