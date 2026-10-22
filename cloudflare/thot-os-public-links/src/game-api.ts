import type { GameSubmitResult } from "./game-leaderboard-do.ts";

const MAX_SUBMISSION_BYTES = 262_144;

function json(status: number, value: unknown) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function readSubmission(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared > MAX_SUBMISSION_BYTES || !request.body) throw new Error("Run is too large or empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SUBMISSION_BYTES) throw new Error("Run is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Send a valid JSON run."); }
}

export async function gameLeaderboardApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!env.GAME_LEADERBOARD) return json(503, { error: "Leaderboard unavailable." });
  const board = env.GAME_LEADERBOARD.getByName("over-there-global-v1");
  if (request.method === "GET") return json(200, await board.getEntries());
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json(415, { error: "Send JSON." });
  let submission: unknown;
  try { submission = await readSubmission(request); }
  catch (error) { return json(400, { error: error instanceof Error ? error.message : "Invalid run." }); }
  const result: GameSubmitResult = await board.submit(submission);
  return result.ok ? json(200, { scope: result.scope, entry: result.entry, entries: result.entries }) : json(result.status, { error: result.error });
}
