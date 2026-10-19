const BASE = "/dashboard/ama";
const securityHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const encoder = new TextEncoder();
let cachedJwks;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function bytes(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}

function jsonPart(value) {
  return JSON.parse(new TextDecoder().decode(bytes(value)));
}

async function accessEmail(request, env, fetchJwks) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_AUD || !env.ACCESS_JWKS_URL || !env.ACCESS_ISSUER) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = jsonPart(parts[0]);
    const claims = jsonPart(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
      ![claims.aud].flat().includes(env.ACCESS_AUD) || claims.iss !== env.ACCESS_ISSUER ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now)) ||
      typeof claims.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) return null;
    if (!cachedJwks || cachedJwks.url !== env.ACCESS_JWKS_URL || cachedJwks.expires <= Date.now()) {
      const response = await fetchJwks(env.ACCESS_JWKS_URL);
      if (!response.ok) return null;
      const body = await response.json();
      cachedJwks = { url: env.ACCESS_JWKS_URL, expires: Date.now() + 300_000, keys: body.keys };
    }
    let jwk = cachedJwks.keys?.find((key) => key.kid === header.kid);
    if (!jwk) {
      const response = await fetchJwks(env.ACCESS_JWKS_URL);
      if (!response.ok) return null;
      const body = await response.json();
      cachedJwks = { url: env.ACCESS_JWKS_URL, expires: Date.now() + 300_000, keys: body.keys };
      jwk = cachedJwks.keys?.find((key) => key.kid === header.kid);
    }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) return null;
    return claims.email.toLowerCase();
  } catch {
    return null;
  }
}

async function creatorContext(request, env, fetchJwks) {
  const email = await accessEmail(request, env, fetchJwks);
  if (!email) return null;
  const rows = (await env.DB.prepare(`
    SELECT m.creator_id, m.role, c.name
    FROM creator_memberships m
    JOIN creators c ON c.id=m.creator_id
    JOIN users u ON lower(u.email)=lower(m.user_email)
    WHERE lower(m.user_email)=? AND m.status='active' AND u.status='active' AND c.status='active'
  `).bind(email).all()).results;
  // Creator and viewer identities are deliberately fixed to one workspace.
  if (rows.length !== 1 || !["creator", "viewer"].includes(rows[0].role)) return null;
  return { ...rows[0], email };
}

function response(body, status = 200, contentType = "text/html; charset=utf-8", extra = {}) {
  return new Response(body, { status, headers: { ...securityHeaders, "Content-Type": contentType, ...extra } });
}

async function boundedForm(request, limit = 16_384) {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { await reader.cancel().catch(() => undefined); return null; }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: bytes }).formData().catch(() => null);
}

function shell(title, context, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · AMA</title><link rel="stylesheet" href="${BASE}/styles.css"></head><body><main class="shell"><header class="mast"><a class="brand" href="${BASE}">THAT HUB OVER THERE <span>/ AMA</span></a><div class="identity">${escapeHtml(context.name)} <span>${context.role === "viewer" ? "View only" : "Creator"}</span></div></header>${body}</main></body></html>`;
}

async function listPage(env, context, url) {
  const queue = ["answered", "published"].includes(url.searchParams.get("queue")) ? url.searchParams.get("queue") : "new";
  const requestedPage = url.searchParams.get("page") ?? "1";
  const page = /^[1-9]\d{0,3}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const filter = queue === "new" ? "NOT EXISTS (SELECT 1 FROM ama_answer_revisions r WHERE r.creator_id=q.creator_id AND r.question_id=q.id)"
    : queue === "answered" ? "EXISTS (SELECT 1 FROM ama_answer_revisions r WHERE r.creator_id=q.creator_id AND r.question_id=q.id) AND COALESCE((SELECT p.action FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id ORDER BY p.sequence DESC LIMIT 1),'withdraw')='withdraw'"
      : "(SELECT p.action FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id ORDER BY p.sequence DESC LIMIT 1)='publish'";
  const rows = (await env.DB.prepare(`
    SELECT q.id, q.question_text, q.received_at,
      (SELECT MAX(r.revision) FROM ama_answer_revisions r
       WHERE r.creator_id=q.creator_id AND r.question_id=q.id) AS latest_revision,
      (SELECT p.action FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id ORDER BY p.sequence DESC LIMIT 1) AS latest_action,
      (SELECT MAX(p.sequence) FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id) AS latest_sequence
    FROM ama_questions q WHERE q.creator_id=?
    AND ${filter}
    ORDER BY q.received_at DESC, q.id DESC LIMIT 51 OFFSET ?
  `).bind(context.creator_id, (page - 1) * 50).all()).results;
  const shown = rows.slice(0, 50);
  const items = shown.map((q) => `<li><a class="question" href="${BASE}/${encodeURIComponent(q.id)}"><span class="question-text">${escapeHtml(q.question_text)}</span><span class="question-meta">${escapeHtml(q.received_at)} · ${q.latest_action === "publish" ? "Public card live" : q.latest_revision ? "Private answer saved" : "Needs answer"}</span></a></li>`).join("");
  const pages = `<nav class="pages" aria-label="Inbox pages">${page > 1 ? `<a href="${BASE}?queue=${queue}&page=${page - 1}">← Newer</a>` : ""}<span>Page ${page}</span>${rows.length > 50 ? `<a href="${BASE}?queue=${queue}&page=${page + 1}">Older →</a>` : ""}</nav>`;
  const body = `<section class="intro"><p class="eyebrow">THAT HUB · CREATOR INBOX</p><h1>Questions, in your hands.</h1><p>Read, answer and preview in private. Only your explicit publish action makes a card public.</p></section><nav class="tabs" aria-label="Question queues"><a ${queue === "new" ? 'aria-current="page"' : ""} href="${BASE}?queue=new">New</a><a ${queue === "answered" ? 'aria-current="page"' : ""} href="${BASE}?queue=answered">Answered</a><a ${queue === "published" ? 'aria-current="page"' : ""} href="${BASE}?queue=published">Published</a></nav><section class="inbox"><h2>${queue === "new" ? "New questions" : queue === "answered" ? "Private answers and withdrawals" : "Published cards and pending updates"}</h2>${items ? `<ul>${items}</ul>` : `<p class="empty">${queue === "new" ? "No new questions yet." : queue === "answered" ? "No saved answers yet." : "No published answers yet."}</p>`}${pages}</section>`;
  return response(shell("Inbox", context, body));
}

async function detailPage(env, context, questionId, saved = false) {
  const question = await env.DB.prepare("SELECT id, question_text, received_at FROM ama_questions WHERE id=? AND creator_id=?").bind(questionId, context.creator_id).first();
  if (!question) return response("Not found", 404, "text/plain; charset=utf-8");
  const draft = await env.DB.prepare("SELECT answer_text, revision, created_at FROM ama_answer_revisions WHERE question_id=? AND creator_id=? ORDER BY revision DESC LIMIT 1").bind(questionId, context.creator_id).first();
  const latest = await env.DB.prepare("SELECT sequence,action FROM ama_publications WHERE question_id=? AND creator_id=? ORDER BY sequence DESC LIMIT 1").bind(questionId, context.creator_id).first();
  const form = context.role === "creator" ? `<form method="post" action="${BASE}/${encodeURIComponent(question.id)}/draft"><input type="hidden" name="expected_revision" value="${draft?.revision ?? 0}"><label for="answer">Your answer</label><textarea id="answer" name="answer" maxlength="5000" required>${escapeHtml(draft?.answer_text ?? "")}</textarea><p class="hint">Save your answer, then preview the finished card before publishing.</p><button type="submit">Save private draft</button></form>${draft ? `<a class="preview-link" href="${BASE}/${encodeURIComponent(question.id)}/preview">Preview finished card →</a>` : ""}${latest?.action === "publish" ? `<form class="withdraw" method="post" action="${BASE}/${encodeURIComponent(question.id)}/withdraw"><input type="hidden" name="expected_sequence" value="${latest.sequence}"><label class="ack"><input type="checkbox" name="confirm" value="withdraw" required><span>Remove this card from the public AMA page.</span></label><button type="submit">Withdraw public card</button></form>` : ""}` : '<div class="notice">View only · You can browse this inbox, but your role cannot answer.</div>';
  const body = `<a class="back" href="${BASE}?queue=${latest?.action === "publish" ? "published" : draft ? "answered" : "new"}">← Back to inbox</a><article class="detail"><p class="eyebrow">ANONYMOUS QUESTION · ${escapeHtml(question.received_at)}</p><h1>${escapeHtml(question.question_text)}</h1>${latest?.action === "publish" ? '<p class="success" role="status">Live on your public AMA page.</p>' : ""}${saved ? '<p class="success" role="status">Draft saved · private.</p>' : ""}${draft ? `<p class="saved">Private answer · revision ${draft.revision} · ${escapeHtml(draft.created_at)}</p>` : ""}${form}</article>`;
  return response(shell("Question", context, body));
}

async function activeProfile(env, creatorId) {
  return env.DB.prepare(`SELECT p.slug, p.published_version_id AS version_id FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.creator_id=? AND p.status='active' AND v.status='published' AND v.approved_by IS NOT NULL`).bind(creatorId).first();
}

async function previewPage(env, context, questionId) {
  if (context.role !== "creator") return response("Not found", 404, "text/plain; charset=utf-8");
  const question = await env.DB.prepare("SELECT id,question_text FROM ama_questions WHERE id=? AND creator_id=?").bind(questionId, context.creator_id).first();
  const draft = await env.DB.prepare("SELECT id,answer_text,revision FROM ama_answer_revisions WHERE question_id=? AND creator_id=? ORDER BY revision DESC LIMIT 1").bind(questionId, context.creator_id).first();
  if (!question || !draft) return response("Not found", 404, "text/plain; charset=utf-8");
  const profile = await activeProfile(env, context.creator_id);
  const latest = await env.DB.prepare("SELECT sequence FROM ama_publications WHERE creator_id=? AND question_id=? ORDER BY sequence DESC LIMIT 1").bind(context.creator_id, questionId).first();
  const card = `<article class="preview-card" aria-label="Private preview of question and answer"><div class="card-top">THAT HUB · QUESTIONS <span>PREVIEW</span></div><div class="card-body"><p class="card-label">QUESTION</p><h2>${escapeHtml(question.question_text)}</h2><div class="card-answer"><p class="card-label">${escapeHtml(context.name.toUpperCase())} ANSWERS</p><p>${escapeHtml(draft.answer_text)}</p></div></div></article>`;
  const publish = profile ? `<form method="post" action="${BASE}/${encodeURIComponent(question.id)}/publish"><input type="hidden" name="revision_id" value="${escapeHtml(draft.id)}"><input type="hidden" name="expected_sequence" value="${latest?.sequence ?? 0}"><label class="ack"><input type="checkbox" name="sfw_ack" value="yes" required><span>This question and answer are suitable for the public, SFW That Hub page.</span></label><button type="submit">Publish answer</button></form>` : '<p class="notice">A published public profile is required before this card can go live.</p>';
  const body = `<a class="back" href="${BASE}/${encodeURIComponent(question.id)}">← Edit answer</a><section class="preview-layout"><div><p class="eyebrow">PRIVATE PREVIEW · REVISION ${draft.revision}</p><h1>See the card before it goes live.</h1><p>Publishing will show both the question and your answer on your public AMA page.</p>${publish}</div>${card}</section>`;
  return response(shell("Preview card", context, body));
}

async function publicationProjection(env, context, profile) {
  const rows = (await env.DB.prepare(`SELECT q.id, q.question_text, r.answer_text, p.published_at FROM ama_publications p
    JOIN ama_questions q ON q.id=p.question_id AND q.creator_id=p.creator_id
    JOIN ama_answer_revisions r ON r.id=p.revision_id AND r.question_id=p.question_id AND r.creator_id=p.creator_id
    WHERE p.creator_id=? AND p.profile_version_id=? AND p.action='publish' AND p.safety='sfw' AND p.sequence=(SELECT MAX(p2.sequence) FROM ama_publications p2 WHERE p2.creator_id=p.creator_id AND p2.question_id=p.question_id)
    ORDER BY p.sequence DESC LIMIT 50`).bind(context.creator_id, profile.version_id).all()).results;
  return { schemaVersion: 1, creatorSlug: profile.slug, publishedProfileVersionId: profile.version_id,
    cards: rows.map((row) => ({ id: row.id, question: row.question_text, answer: row.answer_text, publishedAt: row.published_at, safety: "sfw" })) };
}

// The public read is derived from D1 on every request. Sequence selects one
// current action per question; no KV writer can later restore a withdrawn card.
async function publicProjectionBySlug(env, slug) {
  const profile = await env.DB.prepare(`SELECT p.creator_id,p.slug,p.published_version_id AS version_id
    FROM creator_public_profiles p JOIN creator_public_profile_versions v
      ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    WHERE p.slug=? AND p.status='active' AND c.status='active'
      AND v.status='published' AND v.approved_by IS NOT NULL`).bind(slug).first();
  if (!profile) return response("Not found", 404, "text/plain; charset=utf-8");
  const projection = await publicationProjection(env, { creator_id: profile.creator_id }, profile);
  return response(JSON.stringify(projection), 200, "application/json; charset=utf-8");
}

async function defaultVerifyChallenge(token, env) {
  if (!env.TURNSTILE_SECRET) return false;
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
  });
  if (!result.ok) return false;
  return (await result.json()).success === true;
}

async function intakeQuestion(request, env, slug, verifyChallenge) {
  if (!env.PUBLIC_ORIGIN || request.headers.get("origin") !== env.PUBLIC_ORIGIN) return response("Forbidden", 403, "text/plain; charset=utf-8");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return response("Unsupported media type", 415, "text/plain; charset=utf-8");
  if (!env.TURNSTILE_SECRET) return response("Question intake unavailable", 503, "text/plain; charset=utf-8");
  const form = await boundedForm(request, 8192);
  if (!form) return response("Invalid question", 400, "text/plain; charset=utf-8");
  const question = form.get("question");
  const challenge = form.get("cf-turnstile-response");
  if (typeof question !== "string" || !question.trim() || question.length > 800 ||
    form.get("acknowledge") !== "yes" || form.get("website") !== "" ||
    typeof challenge !== "string" || !challenge || challenge.length > 2048) return response("Invalid question", 400, "text/plain; charset=utf-8");
  const profile = await env.DB.prepare(`SELECT p.creator_id FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    WHERE p.slug=? AND p.status='active' AND c.status='active' AND v.status='published' AND v.approved_by IS NOT NULL`).bind(slug).first();
  if (!profile) return response("Not found", 404, "text/plain; charset=utf-8");
  let verified = false;
  try { verified = await verifyChallenge(challenge, env); } catch { /* Fail closed. */ }
  if (!verified) return response("Verification failed. Refresh and try again.", 403, "text/plain; charset=utf-8");
  const result = await env.DB.prepare(`INSERT INTO ama_questions(id,creator_id,question_text,source)
    SELECT ?,p.creator_id,?,'public' FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    WHERE p.slug=? AND p.creator_id=? AND p.status='active' AND c.status='active' AND v.status='published' AND v.approved_by IS NOT NULL`)
    .bind(crypto.randomUUID(), question.trim(), slug, profile.creator_id).run();
  if (result.meta.changes !== 1) return response("Question intake unavailable", 409, "text/plain; charset=utf-8");
  return response(JSON.stringify({ ok: true }), 201, "application/json; charset=utf-8");
}

function expectedSequence(form) {
  const raw = form.get("expected_sequence");
  return typeof raw === "string" && /^(0|[1-9]\d{0,14})$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

async function publishAnswer(request, env, context, questionId) {
  if (context.role !== "creator") return response("Not found", 404, "text/plain; charset=utf-8");
  if (request.headers.get("origin") !== new URL(request.url).origin) return response("Forbidden", 403, "text/plain; charset=utf-8");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return response("Unsupported media type", 415, "text/plain; charset=utf-8");
  const form = await boundedForm(request);
  if (!form) return response("Invalid answer", 400, "text/plain; charset=utf-8");
  const revisionId = form.get("revision_id");
  const sequence = expectedSequence(form);
  if (typeof revisionId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(revisionId) || form.get("sfw_ack") !== "yes" || sequence === null) return response("Invalid publication", 400, "text/plain; charset=utf-8");
  const profile = await activeProfile(env, context.creator_id);
  if (!profile || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(profile.slug) || !/^[a-zA-Z0-9_-]{1,120}$/.test(profile.version_id)) return response("Public profile unavailable", 409, "text/plain; charset=utf-8");
  const result = await env.DB.prepare(`INSERT INTO ama_publications(id,creator_id,question_id,revision_id,profile_version_id,actor_email,action,safety)
    SELECT ?,q.creator_id,q.id,r.id,?,?,'publish','sfw'
    FROM ama_questions q JOIN ama_answer_revisions r ON r.question_id=q.id AND r.creator_id=q.creator_id
    WHERE q.id=? AND q.creator_id=? AND r.id=?
      AND r.revision=(SELECT MAX(r2.revision) FROM ama_answer_revisions r2 WHERE r2.question_id=q.id AND r2.creator_id=q.creator_id)
      AND COALESCE((SELECT MAX(p.sequence) FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id),0)=?
      AND NOT EXISTS (SELECT 1 FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id
        AND p.sequence=? AND p.action='publish' AND p.revision_id=r.id)`)
    .bind(crypto.randomUUID(), profile.version_id, context.email, questionId, context.creator_id, revisionId, sequence, sequence).run();
  if (result.meta.changes !== 1) return response("Answer or publication changed. Reload the preview.", 409, "text/plain; charset=utf-8");
  return response(null, 303, "text/plain; charset=utf-8", { Location: `${BASE}?queue=published` });
}

async function withdrawAnswer(request, env, context, questionId) {
  if (context.role !== "creator") return response("Not found", 404, "text/plain; charset=utf-8");
  if (request.headers.get("origin") !== new URL(request.url).origin) return response("Forbidden", 403, "text/plain; charset=utf-8");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return response("Unsupported media type", 415, "text/plain; charset=utf-8");
  const form = await boundedForm(request);
  const sequence = form && expectedSequence(form);
  if (!form || form.get("confirm") !== "withdraw" || sequence === null) return response("Invalid withdrawal", 400, "text/plain; charset=utf-8");
  const profile = await activeProfile(env, context.creator_id);
  if (!profile) return response("Public profile unavailable", 409, "text/plain; charset=utf-8");
  const result = await env.DB.prepare(`INSERT INTO ama_publications(id,creator_id,question_id,revision_id,profile_version_id,actor_email,action,safety)
    SELECT ?,q.creator_id,q.id,NULL,?,?,'withdraw',NULL FROM ama_questions q
    WHERE q.id=? AND q.creator_id=?
      AND (SELECT MAX(p.sequence) FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id)=?
      AND (SELECT p.action FROM ama_publications p WHERE p.creator_id=q.creator_id AND p.question_id=q.id ORDER BY p.sequence DESC LIMIT 1)='publish'`)
    .bind(crypto.randomUUID(), profile.version_id, context.email, questionId, context.creator_id, sequence).run();
  if (result.meta.changes !== 1) return response("Card changed. Reload the question.", 409, "text/plain; charset=utf-8");
  return response(null, 303, "text/plain; charset=utf-8", { Location: `${BASE}?queue=answered` });
}

async function saveDraft(request, env, context, questionId) {
  if (context.role !== "creator") return response("Not found", 404, "text/plain; charset=utf-8");
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return response("Forbidden", 403, "text/plain; charset=utf-8");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return response("Unsupported media type", 415, "text/plain; charset=utf-8");
  const form = await boundedForm(request);
  if (!form) return response("Invalid publication", 400, "text/plain; charset=utf-8");
  const answer = form.get("answer");
  const expected = form.get("expected_revision");
  if (typeof answer !== "string" || !answer.trim() || answer.length > 5000 || typeof expected !== "string" || !/^(0|[1-9]\d*)$/.test(expected)) return response("Invalid answer", 400, "text/plain; charset=utf-8");
  const id = crypto.randomUUID();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO ama_answer_revisions(id,question_id,creator_id,revision,answer_text,author_email)
      SELECT ?,q.id,q.creator_id,COALESCE((SELECT MAX(r.revision) FROM ama_answer_revisions r WHERE r.question_id=q.id AND r.creator_id=q.creator_id),0)+1,?,?
      FROM ama_questions q WHERE q.id=? AND q.creator_id=?
      AND COALESCE((SELECT MAX(r.revision) FROM ama_answer_revisions r WHERE r.question_id=q.id AND r.creator_id=q.creator_id),0)=?
    `).bind(id, answer.trim(), context.email, questionId, context.creator_id, Number(expected)).run();
    if (result.meta.changes !== 1) return response("Question not found or answer changed. Reload and try again.", 409, "text/plain; charset=utf-8");
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) return response("Answer changed. Reload and try again.", 409, "text/plain; charset=utf-8");
    throw error;
  }
  return response(null, 303, "text/plain; charset=utf-8", { Location: `${BASE}/${encodeURIComponent(questionId)}?saved=1` });
}

export function createAmaWorker({ fetchJwks = fetch, verifyChallenge = defaultVerifyChallenge } = {}) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    // These routes are for the public Worker's service binding only. The
    // release must keep worker.dev off and route external traffic solely to
    // the Access-protected /dashboard/ama prefix.
    if (url.origin === "https://ama.internal" && env.DB) {
      const publicMatch = /^\/internal\/ama\/public\/([a-z0-9][a-z0-9-]{0,79})$/.exec(url.pathname);
      if (publicMatch && request.method === "GET") return publicProjectionBySlug(env, publicMatch[1]);
      const intakeMatch = /^\/internal\/ama\/intake\/([a-z0-9][a-z0-9-]{0,79})$/.exec(url.pathname);
      if (intakeMatch && request.method === "POST") return intakeQuestion(request, env, intakeMatch[1], verifyChallenge);
    }
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return response("Not found", 404, "text/plain; charset=utf-8");
    if (!env.DB) return response("Unavailable", 503, "text/plain; charset=utf-8");
    const context = await creatorContext(request, env, fetchJwks);
    if (!context) return response("Not found", 404, "text/plain; charset=utf-8");
    if (url.pathname === `${BASE}/styles.css` && request.method === "GET") return response(CSS + CARD_CSS, 200, "text/css; charset=utf-8");
    if (url.pathname === BASE && request.method === "GET") return listPage(env, context, url);
    const draftMatch = /^\/dashboard\/ama\/([a-zA-Z0-9_-]{1,120})\/draft$/.exec(url.pathname);
    if (draftMatch && request.method === "POST") return saveDraft(request, env, context, draftMatch[1]);
    const previewMatch = /^\/dashboard\/ama\/([a-zA-Z0-9_-]{1,120})\/preview$/.exec(url.pathname);
    if (previewMatch && request.method === "GET") return previewPage(env, context, previewMatch[1]);
    const publishMatch = /^\/dashboard\/ama\/([a-zA-Z0-9_-]{1,120})\/publish$/.exec(url.pathname);
    if (publishMatch && request.method === "POST") return publishAnswer(request, env, context, publishMatch[1]);
    const withdrawMatch = /^\/dashboard\/ama\/([a-zA-Z0-9_-]{1,120})\/withdraw$/.exec(url.pathname);
    if (withdrawMatch && request.method === "POST") return withdrawAnswer(request, env, context, withdrawMatch[1]);
    const detailMatch = /^\/dashboard\/ama\/([a-zA-Z0-9_-]{1,120})$/.exec(url.pathname);
    if (detailMatch && request.method === "GET") return detailPage(env, context, detailMatch[1], url.searchParams.get("saved") === "1");
    return response("Not found", 404, "text/plain; charset=utf-8");
  } };
}

const CSS = `:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#241f28;background:#f8f5f4}*{box-sizing:border-box}body{margin:0}.shell{max-width:1100px;margin:auto;padding:0 24px 64px}.mast{display:flex;justify-content:space-between;gap:24px;align-items:center;border-bottom:1px solid #dfd6d9;padding:24px 0}.brand{font-size:13px;font-weight:850;letter-spacing:.07em;color:#241f28;text-decoration:none}.brand span{color:#bd5180}.identity{font-size:14px;font-weight:700}.identity span{display:block;color:#786c74;font-size:12px;text-align:right}.intro{padding:64px 0 38px}.eyebrow{font-size:12px;font-weight:850;letter-spacing:.13em;color:#ab3f72}.intro h1,.detail h1{font-size:clamp(34px,5vw,64px);line-height:1.08;letter-spacing:-.055em;margin:12px 0}.intro>p:last-child{color:#625760}.tabs{display:flex;gap:8px;border-bottom:1px solid #dfd6d9}.tabs a{padding:14px 20px;color:#594d56;text-decoration:none;font-weight:750}.tabs a[aria-current]{color:#a92d69;border-bottom:3px solid #b42e70}.inbox,.detail{background:#fff;border:1px solid #e7dfe2;box-shadow:0 14px 36px #3a1f3210;border-radius:16px;padding:28px;margin-top:24px}.inbox h2{margin:0 0 20px;font-size:22px}.inbox ul{list-style:none;padding:0;margin:0}.inbox li+li{border-top:1px solid #eee8e9}.question{display:block;padding:20px 0;color:inherit;text-decoration:none}.question:hover .question-text{text-decoration:underline}.question-text{display:block;font-size:18px;font-weight:680;line-height:1.4}.question-meta{display:block;color:#7b6f77;font-size:13px;margin-top:9px}.pages{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px;color:#7b6f77;font-size:13px}.pages a{color:#a92d69;font-weight:750;text-decoration:none}.empty,.hint,.notice{color:#6c6068}.notice{background:#f8f1f4;border-radius:9px;padding:14px}.back{display:inline-block;margin-top:28px;color:#a92d69;font-weight:750;text-decoration:none}.detail{max-width:760px;padding:clamp(24px,4vw,48px)}.detail h1{font-size:clamp(30px,4vw,48px);overflow-wrap:anywhere}.detail form{margin-top:40px}.detail label{display:block;font-weight:800;margin-bottom:12px}.detail textarea{display:block;width:100%;min-height:180px;resize:vertical;border:1px solid #bfb2ba;border-radius:10px;padding:16px;font:inherit;line-height:1.5}.detail button{border:0;background:#b42e70;color:#fff;border-radius:9px;padding:14px 22px;font:inherit;font-weight:800;cursor:pointer}.detail button:hover{background:#892055}.saved{color:#6c6068}.success{padding:14px;border-radius:8px;background:#e5f4ed;color:#17613f;font-weight:750}:focus-visible{outline:3px solid #b42e70;outline-offset:3px}@media(max-width:600px){.shell{padding:0 16px 40px}.mast{align-items:flex-start}.brand{max-width:180px;line-height:1.5}.identity{font-size:12px}.intro{padding:40px 0 28px}.inbox{padding:20px}.question-text{font-size:16px}}`;

const CARD_CSS = `
.preview-link{display:inline-flex;margin:1rem 0 0;color:#a92d69;font-weight:800;text-underline-offset:.2rem}
.preview-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:start;gap:clamp(1.5rem,5vw,4rem);padding-top:3rem}
.preview-layout h1{font-size:clamp(2.2rem,4.6vw,4rem);line-height:1.06;letter-spacing:-.045em;margin:1rem 0}.preview-layout>div>p{line-height:1.6;color:#635865}
.preview-layout form{margin-top:2rem;border-top:1px solid #d7cbd3;padding-top:1.5rem}.ack{display:flex;gap:.7rem;align-items:start;line-height:1.45;font-weight:650}.ack input{accent-color:#9c2761;flex:0 0 auto;margin:.3rem 0 0}.preview-layout button{margin-top:1.25rem;border:0;border-radius:.7rem;background:#a92d69;color:#fff;padding:.85rem 1.4rem;font:inherit;font-weight:800;cursor:pointer}
.preview-card{color:#201c2d;background:#fffaf2;border:2px solid #201c2d;border-radius:1.15rem;box-shadow:8px 8px 0 #201c2d;overflow:hidden;overflow-wrap:anywhere}.preview-card .card-top{display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid #201c2d;padding:1rem 1.25rem;font-size:.72rem;letter-spacing:.1em;font-weight:850}.preview-card .card-top span{color:#9c2761}.preview-card .card-body{padding:clamp(1.4rem,3vw,2.4rem)}.preview-card .card-label{font-size:.72rem;font-weight:850;letter-spacing:.13em;color:#615b6c;margin:0 0 .7rem}.preview-card h2{font:700 clamp(1.5rem,2.8vw,2.1rem)/1.2 Georgia,serif;letter-spacing:-.025em;white-space:pre-line;margin:0}.preview-card .card-answer{border-top:2px solid #201c2d;margin-top:2rem;padding-top:1.5rem}.preview-card .card-answer>p:last-child{white-space:pre-line;line-height:1.65;margin:0}
@media(max-width:750px){.preview-layout{grid-template-columns:1fr;padding-top:2rem}.preview-card{grid-row:1;box-shadow:5px 5px 0 #201c2d}.preview-layout>div{grid-row:2}}
`;

export default createAmaWorker();
