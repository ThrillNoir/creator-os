import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";

test("0056 stores hash-only, creator-scoped, replaceable invitations", async () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE creators (id TEXT PRIMARY KEY); CREATE TABLE users (email TEXT PRIMARY KEY COLLATE NOCASE);");
    db.exec(await readFile(new URL("../../thot-os-app/migrations/0056_creator_invitations.sql", import.meta.url), "utf8"));
    db.exec("INSERT INTO creators VALUES ('creator-a'); INSERT INTO users VALUES ('admin@example.com');");
    const insert = db.prepare("INSERT INTO creator_invitations (id,creator_id,invited_email,token_hash,expires_at,created_by) VALUES (?,?,?,?,?,?)");
    insert.run("one", "creator-a", "Creator@Example.com", "a".repeat(64), "2099-01-01", "admin@example.com");
    assert.deepEqual(db.prepare("PRAGMA table_info(creator_invitations)").all().map((column) => column.name).includes("token"), false);
    assert.throws(() => insert.run("two", "creator-a", "creator@example.com", "b".repeat(64), "2099-01-01", "admin@example.com"), /UNIQUE constraint failed/);
    db.prepare("UPDATE creator_invitations SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='one'").run();
    insert.run("two", "creator-a", "creator@example.com", "b".repeat(64), "2099-01-01", "admin@example.com");
    assert.throws(() => insert.run("three", "missing", "third@example.com", "c".repeat(64), "2099-01-01", "admin@example.com"), /FOREIGN KEY constraint failed/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
});
