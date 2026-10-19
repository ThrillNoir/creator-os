// Local-only interactive fixture. Start with: node --experimental-strip-types tests/portfolio-preview.mjs
import http from "node:http";
import { spawnSync } from "node:child_process";
import { createAdultGateway } from "../src/index.ts";
import { PortfolioFixture } from "./portfolio-fixture.mjs";

const port = Number(process.env.PORTFOLIO_PREVIEW_PORT || 8790);
const origin = `http://127.0.0.1:${port}`;
const secret = "local-fixture-only-secret";
const fixture = new PortfolioFixture();
const profile = {
  schemaVersion: 4,
  publishedVersionId: "local-adelaide-v1",
  creator: { slug: "adelaide", displayName: "Adelaide Suede", bio: "A locally simulated That Hub page. All portfolio media is synthetic.", safeProfileUrl: "https://www.thathuboverthere.com/adelaide" },
  links: [], media: [],
  appearance: { themeKey: "thot-noir", buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#112c24", primaryColor: "#8bd49a", textColor: "#f2fff5", cardColor: "#1b4437", radiusScale: "compact" },
};
const env = { ADULT_PROFILES: { get: async () => profile }, ADULT_EVENTS: { writeDataPoint: () => {} }, AGE_SESSION_SECRET: secret };
const worker = createAdultGateway(async (slug, version) => fixture.projection(slug, version));

for (const [id, section, genre, order] of [["studio-portrait", "Photos", "Portraits", 1], ["after-hours", "Clips", "Performance", 2], ["quiet-morning", "Behind the scenes", "Everyday", 3]]) {
  fixture.update("adelaide", id, { selected: true, section, genre, order });
  fixture.publish("adelaide", id);
}

const video = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x400:rate=12:duration=3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "33", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 1024 * 1024 });
if (video.status !== 0 || !video.stdout?.length) throw new Error("Local synthetic video generation failed; ffmpeg is required for this preview.");

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function base64url(value) { return Buffer.from(value).toString("base64url"); }

async function localCookie() {
  const payload = base64url(JSON.stringify({ slug: "adelaide", versionId: profile.publishedVersionId, expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `__Host-thot-age=${payload}.${signature}`;
}

async function workerCookie(req) {
  return (req.headers.cookie || "").split(";").some((part) => part.trim() === "portfolio-fixture-entry=1") ? await localCookie() : "";
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

async function requestBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function svg(id) {
  const item = fixture.items.get(id);
  const hue = id === "studio-portrait" ? "#a47b8f" : id === "quiet-morning" ? "#7faea0" : "#8162a2";
  const title = escapeHtml(item.title);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" role="img" aria-label="Synthetic ${title} artwork"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#1b4437"/><stop offset="1" stop-color="${hue}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><circle cx="290" cy="130" r="150" fill="#fff" opacity=".09"/><path d="M0 430 Q180 230 400 390 V500 H0" fill="#102b25" opacity=".45"/><text x="35" y="418" fill="#fff" font-family="sans-serif" font-size="15" letter-spacing="3">SYNTHETIC PREVIEW</text><text x="35" y="455" fill="#fff" font-family="Georgia,serif" font-size="30">${title}</text></svg>`;
}

function managerPage(message = "") {
  const rows = [...fixture.items.values()].map((item) => `<article><img src="data:image/svg+xml;base64,${Buffer.from(svg(item.id)).toString("base64")}" alt="Synthetic ${escapeHtml(item.title)} preview"><div><h2>${escapeHtml(item.title)}</h2><p>${item.kind} · ${item.published ? "Published in local fixture" : item.selected ? "Selected draft" : "Not selected"}</p><form method="post" action="/creator/portfolio/update"><input type="hidden" name="id" value="${item.id}"><label><input type="checkbox" name="selected" value="yes" ${item.selected ? "checked" : ""}> Select</label><label>Section<select name="section">${["Photos", "Clips", "Behind the scenes"].map((value) => `<option${item.section === value ? " selected" : ""}>${value}</option>`).join("")}</select></label><label>Genre<select name="genre">${["Portraits", "Performance", "Everyday"].map((value) => `<option${item.genre === value ? " selected" : ""}>${value}</option>`).join("")}</select></label><label>Order<input name="order" type="number" min="0" max="99" value="${item.order}"></label><button>Save selection</button></form><div class="actions"><form method="post" action="/creator/portfolio/publish"><input type="hidden" name="id" value="${item.id}"><button ${item.selected && !item.published ? "" : "disabled"}>Publish</button></form><form method="post" action="/creator/portfolio/withdraw"><input type="hidden" name="id" value="${item.id}"><button ${item.published ? "" : "disabled"}>Withdraw</button></form></div></div></article>`).join("");
  const requests = fixture.requests.map((request) => `<li>${escapeHtml(request.requestType)} · ${escapeHtml(request.message)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local portfolio manager</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#f2fff5;background:#112c24;margin:0}main{width:min(100% - 2rem,60rem);margin:auto;padding:2rem 0}a{color:#8bd49a}article{display:grid;grid-template-columns:8rem 1fr;gap:1rem;border:1px solid #ffffff35;border-radius:.8rem;padding:1rem;margin:1rem 0;background:#1b4437}article img{width:100%;border-radius:.5rem}h1{font:700 2.4rem/1.1 Georgia,serif}h2{margin:0}article p{margin:.25rem 0 1rem}article form{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end}label{display:grid;gap:.2rem;font-size:.8rem}label:first-child{display:flex;align-items:center}select,input[type=number]{font:inherit;padding:.5rem;border-radius:.4rem;border:0}button{font:inherit;font-weight:700;padding:.6rem .8rem;border:0;border-radius:.4rem;background:#8bd49a;color:#112c24;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.actions{display:flex;gap:.6rem;margin-top:.6rem}.notice{padding:.75rem;border-radius:.4rem;background:#245d46}@media(max-width:35rem){article{grid-template-columns:1fr}article img{height:11rem;object-fit:cover}}:focus-visible{outline:3px solid #f5a7c4;outline-offset:3px}</style></head><body><main><p>LOCAL FIXTURE · NO LIVE PUBLICATION</p><h1>Portfolio manager</h1><p>Select a synthetic item, set its section and order, preview the public result, then publish or withdraw it explicitly.</p><p><a href="/adelaide?section=Photos">Preview age-gated That Hub page ↗</a> · <a href="https://www.thathuboverthere.com/adelaide">Live That Hub profile ↗</a></p>${message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : ""}${rows}<h2>Local enquiries</h2><ul>${requests || "<li>None yet</li>"}</ul></main></body></html>`;
}

function preparedContactPage(result) {
  const channel = result.contactMethod === "telegram" ? "Telegram" : "email";
  const action = result.href
    ? `<a class="action" href="${escapeHtml(result.href)}" rel="noreferrer noopener">Open ${channel} with this message ↗</a>`
    : `<p role="status">This local fixture has no creator-approved ${channel} destination. The prepared message has not been sent.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prepared full-length message</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#fffaf7;color:#241f28;margin:0}main{max-width:40rem;margin:2rem auto;padding:1.5rem;border:3px solid #241f28;box-shadow:8px 8px #241f28}h1{line-height:1.1}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:2px solid #241f28;padding:1rem;font:inherit}.action{display:inline-block;padding:.8rem 1rem;border:2px solid #241f28;background:#ffb0cc;color:#241f28;font-weight:800;text-decoration:none}a{color:#523368}:focus-visible{outline:3px solid #241f28;outline-offset:4px}</style></head><body><main><small>LOCAL FIXTURE · NO MESSAGE SENT</small><h1>Your message is ready</h1><p>For the ${escapeHtml(result.previewId)} preview. Review it before opening ${channel}; you send it from your own app.</p><pre>${escapeHtml(result.message)}</pre>${action}<p><a href="/adelaide?section=Clips">Back to previews</a></p></main></body></html>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", origin);
  if (url.pathname === "/" && req.method === "GET") return respond(res, 200, `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>That Hub local portfolio</title><body style="font:18px/1.5 system-ui;background:#112c24;color:#f2fff5;padding:2rem"><h1>That Hub portfolio · local fixture</h1><p>This preview uses synthetic media and a simulated age session. The live Adelaide profile is <a style="color:#8bd49a" href="https://www.thathuboverthere.com/adelaide">here</a>.</p><p><a style="color:#8bd49a" href="/local-enter">View protected portfolio</a> · <a style="color:#8bd49a" href="/creator/portfolio">Creator manager</a></p></body></html>`, { "content-type": "text/html; charset=utf-8" });
  if (url.pathname === "/local-enter" && req.method === "GET") return respond(res, 303, "", { location: "/adelaide", "set-cookie": "portfolio-fixture-entry=1; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax" });
  if (url.pathname === "/creator/portfolio" && req.method === "GET") return respond(res, 200, managerPage(url.searchParams.get("notice") || ""), { "content-type": "text/html; charset=utf-8" });
  if (url.pathname.startsWith("/creator/portfolio/") && req.method === "POST") {
    if (req.headers.origin !== origin) return respond(res, 403, "Forbidden");
    const form = await requestBody(req);
    if (!form) return respond(res, 413, "Too large");
    const id = form.get("id");
    let changed = false;
    if (url.pathname === "/creator/portfolio/update") changed = fixture.update("adelaide", id, { selected: form.get("selected") === "yes", section: form.get("section"), genre: form.get("genre"), order: Number(form.get("order")) });
    if (url.pathname === "/creator/portfolio/publish") changed = fixture.publish("adelaide", id);
    if (url.pathname === "/creator/portfolio/withdraw") changed = fixture.withdraw("adelaide", id);
    return respond(res, 303, "", { location: `/creator/portfolio?notice=${changed ? "Saved" : "Invalid+change"}` });
  }
  if (url.pathname === "/adelaide/portfolio/request" && req.method === "POST") {
    if (req.headers.origin !== origin) return respond(res, 403, "Forbidden");
    const authorized = await worker.fetch(new Request(`${origin}/adelaide`, { headers: { cookie: await workerCookie(req) } }), env);
    if (authorized.status !== 200) return respond(res, 404, "Not found");
    const form = await requestBody(req);
    const okay = form && fixture.submitRequest("adelaide", { requestType: form.get("requestType"), message: form.get("message"), email: form.get("email"), acknowledge: form.get("acknowledge") });
    return okay ? respond(res, 303, "", { location: "/adelaide?request=sent" }) : respond(res, 400, "Invalid request");
  }
  if (url.pathname === "/adelaide/portfolio/full-length/request" && req.method === "POST") {
    if (req.headers.origin !== origin) return respond(res, 403, "Forbidden");
    const authorized = await worker.fetch(new Request(`${origin}/adelaide`, { headers: { cookie: await workerCookie(req) } }), env);
    if (authorized.status !== 200) return respond(res, 404, "Not found");
    const form = await requestBody(req);
    const prepared = form && fixture.prepareFullLengthContact("adelaide", {
      previewId: form.get("previewId"), name: form.get("name"), contactMethod: form.get("contactMethod"), message: form.get("message"),
    });
    return prepared
      ? respond(res, 200, preparedContactPage(prepared), { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" })
      : respond(res, 400, "Invalid request");
  }
  const asset = /^\/portfolio-fixture\/adelaide\/([a-z0-9-]+)\.(svg|mp4)$/.exec(url.pathname);
  if (asset && req.method === "GET") {
    const item = fixture.items.get(asset[1]);
    const authorized = await worker.fetch(new Request(`${origin}/adelaide`, { headers: { cookie: await workerCookie(req) } }), env);
    if (!item?.published || authorized.status !== 200 || (asset[2] === "mp4" && item.kind !== "video")) return respond(res, 404, "Not found");
    if (asset[2] === "svg") return respond(res, 200, svg(item.id), { "content-type": "image/svg+xml" });
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), video.stdout.length - 1) : video.stdout.length - 1;
      if (start > end || start >= video.stdout.length) return respond(res, 416, "", { "content-range": `bytes */${video.stdout.length}` });
      return respond(res, 206, video.stdout.subarray(start, end + 1), { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${video.stdout.length}`, "content-length": String(end - start + 1) });
    }
    return respond(res, 200, video.stdout, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": String(video.stdout.length) });
  }
  if (req.method !== "GET") return respond(res, 405, "Method not allowed");
  const response = await worker.fetch(new Request(`${origin}${url.pathname}${url.search}`, { headers: { cookie: await workerCookie(req) } }), env);
  respond(res, response.status, await response.text(), { "content-type": response.headers.get("content-type") || "text/plain", "content-security-policy": response.headers.get("content-security-policy") || "default-src 'none'" });
}).listen(port, "127.0.0.1", () => console.log(`Local That Hub portfolio fixture: ${origin}/`));
