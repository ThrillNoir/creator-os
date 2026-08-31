import { requireCreatorContext } from "@/lib/identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { isSameOriginRequest } from "@/lib/audit-identity";
import { buildPrompt, fallback, ONBOARDING_AI_MODEL, validateInput, validateOutput } from "@/lib/onboarding-ai";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ ok: false, error: "Same-origin request required." }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return Response.json({ ok: false, error: "JSON request required." }, { status: 415, headers: { "cache-control": "no-store" } });
  const identity = await requireCreatorContext("mutate");
  let input;
  try { const body = await request.text(); if (body.length > 20_000) throw new Error("Onboarding AI request is too large."); input = validateInput(JSON.parse(body)); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid request." }, { status: 400, headers: { "cache-control": "no-store" } }); }
  const env = cloudflareEnv() as CloudflareEnv & { AI?: Ai };
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM creator_access_audit_events WHERE creator_id=? AND event_type='onboarding_ai_run' AND created_at >= datetime('now','-5 minutes')").bind(identity.creator.creator_id).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 10) return Response.json({ ok: false, error: "Please wait before trying another onboarding suggestion." }, { status: 429 });
  let result = fallback(input);
  if (env.AI) {
    try {
      const generated = await Promise.race([env.AI.run(ONBOARDING_AI_MODEL, { prompt: buildPrompt(input), response_format: { type: "json_object" }, max_tokens: 300, temperature: 0.2, seed: 7 }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timeout")), 8000))]);
      const text = typeof generated === "string" ? generated : (generated as { response?: string }).response;
      result = validateOutput(JSON.parse(text ?? ""), input);
    } catch { result = fallback(input, ["ai_unavailable_or_invalid"]); }
  }
  await env.DB.prepare("INSERT INTO creator_access_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), identity.creator.creator_id, identity.email, identity.creator.role, "onboarding_ai_run", input.questionId, JSON.stringify({ model: ONBOARDING_AI_MODEL, fallback: result.safetyFlags.includes("ai_unavailable_or_invalid"), answerLength: input.answer.length })).run();
  return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
