import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = path.resolve(import.meta.dirname, "../../..");
const migrations = path.join(root, "cloudflare/thot-os-app/migrations");
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");

async function databasePath(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await databasePath(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
  }
  return null;
}

function d1(db) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...params) { values = params; return this; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() {
          const result = db.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
  };
}

export async function replayDownloadSchema() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "thot-os-download-local-"));
  const state = path.join(directory, "state");
  const config = path.join(directory, "wrangler.jsonc");
  try {
    await writeFile(config, JSON.stringify({
      name: "thot-os-download-local",
      compatibility_date: "2026-08-08",
      d1_databases: [{ binding: "DB", database_name: "thot-os-download-local", database_id: "00000000-0000-4000-8000-000000000001", migrations_dir: migrations }],
    }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-download-local", "--local", "--persist-to", state, "--config", config], {
      cwd: directory, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024,
    });
    if (replay.status !== 0) throw new Error(`${replay.stdout}\n${replay.stderr}`);
    const file = await databasePath(state);
    if (!file) throw new Error("Wrangler did not persist the local D1 database.");
    const db = new Database(file);
    return { db, DB: d1(db), async dispose() { db.close(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
