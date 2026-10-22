import { DurableObject } from "cloudflare:workers";
import { replayScore } from "../assets/assets/game/src/leaderboard.js";

const MAX_SUBMISSIONS_PER_MINUTE = 120;

type GameScore = ReturnType<typeof replayScore>;
type GameEntry = GameScore & { id: string; submittedAt: string };
type ScoreRow = {
  id: string;
  name: string;
  handle: string;
  ticks: number;
  time: number;
  distance: number;
  stumbles: number;
  moves: number;
  submitted_at: string;
};

export type GameBoardResult = { scope: "global"; entries: GameEntry[] };
export type GameSubmitResult =
  | (GameBoardResult & { ok: true; entry: GameEntry })
  | { ok: false; status: 400 | 429; error: string };

export class GameLeaderboard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // SQLite initialization is synchronous; no request can observe a partial schema.
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        handle TEXT NOT NULL,
        ticks INTEGER NOT NULL,
        time REAL NOT NULL,
        distance INTEGER NOT NULL,
        stumbles INTEGER NOT NULL,
        moves INTEGER NOT NULL,
        submitted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submission_window (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        minute INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
  }

  getEntries(): GameBoardResult {
    const rows = this.ctx.storage.sql.exec<ScoreRow>(
      "SELECT * FROM scores ORDER BY ticks DESC, distance DESC, submitted_at ASC, id ASC LIMIT 10",
    ).toArray();
    return {
      scope: "global",
      entries: rows.map((row) => ({
        id: row.id, name: row.name, handle: row.handle, ticks: row.ticks,
        time: row.time, distance: row.distance, stumbles: row.stumbles,
        moves: row.moves, submittedAt: row.submitted_at,
      })),
    };
  }

  submit(submission: unknown): GameSubmitResult {
    // The shared board is one coordination unit. Count attempts before replaying
    // potentially expensive input; do not store visitor identifiers or IPs.
    const minute = Math.floor(Date.now() / 60_000);
    const allowed = this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql.exec<{ minute: number; count: number }>(
        "SELECT minute, count FROM submission_window WHERE id = 1",
      ).toArray()[0];
      if (current?.minute === minute && current.count >= MAX_SUBMISSIONS_PER_MINUTE) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO submission_window (id, minute, count) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET minute = excluded.minute, count = CASE WHEN minute = excluded.minute THEN count + 1 ELSE 1 END",
        minute,
      );
      return true;
    });
    if (!allowed) return { ok: false, status: 429, error: "The leaderboard is busy. Try again shortly." };

    let score: GameScore;
    try {
      score = replayScore(submission);
    } catch (error) {
      return { ok: false, status: 400, error: error instanceof Error ? error.message : "Invalid run." };
    }
    const entry: GameEntry = { ...score, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO scores (id, name, handle, ticks, time, distance, stumbles, moves, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        entry.id, entry.name, entry.handle, entry.ticks, entry.time,
        entry.distance, entry.stumbles, entry.moves, entry.submittedAt,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM scores WHERE id NOT IN (SELECT id FROM scores ORDER BY ticks DESC, distance DESC, submitted_at ASC, id ASC LIMIT 10)",
      );
    });
    return { ok: true, entry, ...this.getEntries() };
  }
}
