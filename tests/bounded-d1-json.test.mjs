import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrationNamesFromRows, parseTrustedJson, parseWranglerJson, parseWranglerProcess, resultRows, writeNew } from "../scripts/bounded-d1-migrations.mjs";

const fixture = path.join("tests", "fixtures", "bounded-d1-migrations", "aborted-plan-literal-backslash-n.json");

test("captured aborted plan trailer reproduces the strict JSON failure and repaired writer produces valid evidence", () => {
  const captured = readFileSync(fixture, "utf8");
  assert.match(captured, /}\\n\s*$/);
  assert.throws(() => JSON.parse(captured), /Unexpected non-whitespace character/);
  assert.throws(() => parseTrustedJson(captured, "Approved plan"), /exactly one valid JSON document/);

  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-d1-json-"));
  const output = path.join(directory, "plan.json");
  writeNew(output, JSON.stringify({ schemaVersion: 1, mode: "PLAN" }));
  const written = readFileSync(output, "utf8");
  assert.equal(written.endsWith("\\n"), false);
  assert.deepEqual(parseTrustedJson(written, "Approved plan"), { schemaVersion: 1, mode: "PLAN" });
});

test("external Wrangler JSON accepts only one clean JSON document on stdout", () => {
  assert.deepEqual(parseWranglerJson({ stdout: " \n{\"uuid\":\"db-id\"}\n", stderr: "", operation: "D1 info" }), { uuid: "db-id" });
  for (const stdout of ["", "{", "warning\n{}", "{}\nwarning", "{}\n{}", "{\"uuid\":\"db\"}\n{\"uuid\":\"db2\"}", "\u001b[33m{}\u001b[0m", "{}\u0000"]) {
    assert.throws(() => parseWranglerJson({ stdout, stderr: "", operation: "D1 info" }), /empty JSON stdout|invalid or ambiguous JSON stdout/);
  }
  assert.throws(() => parseWranglerJson({ stdout: "{}", stderr: "Wrangler warning", operation: "D1 info" }), /unexpected stderr/);
});

test("external process status and schema must be unambiguous before D1 data is trusted", () => {
  assert.throws(() => parseWranglerProcess({ status: 1, signal: null, error: null, stdout: "[]", stderr: "", operation: "D1 query" }), /failed before JSON validation/);
  assert.throws(() => parseWranglerProcess({ status: null, signal: "SIGTERM", error: null, stdout: "[]", stderr: "", operation: "D1 query" }), /failed before JSON validation/);
  assert.throws(() => parseWranglerProcess({ status: 0, signal: null, error: new Error("spawn failed"), stdout: "[]", stderr: "", operation: "D1 query" }), /failed before JSON validation/);

  const accepted = [{ success: true, results: [{ id: 1, name: "0001_first.sql", applied_at: "2026-08-16T00:00:00Z" }] }];
  assert.equal(resultRows(accepted).length, 1);
  assert.deepEqual(migrationNamesFromRows(resultRows(accepted)), ["0001_first.sql"]);
  for (const response of [[], [{ success: false, results: [] }], [{ success: true, results: [] }, { success: true, results: [] }], { results: [] }, [{ success: true, results: {} }]]) {
    assert.throws(() => resultRows(response), /unexpected or ambiguous result schema/);
  }
  for (const rows of [[{ id: 0, name: "0001.sql", applied_at: "now" }], [{ id: 2, name: "0002.sql", applied_at: "now" }, { id: 1, name: "0001.sql", applied_at: "now" }], [{ id: 1, name: "", applied_at: "now" }], [{ id: 1, name: "0001.sql", applied_at: "" }]]) {
    assert.throws(() => migrationNamesFromRows(rows), /Remote d1_migrations response is malformed/);
  }
});

test("trusted JSON rejects corruption while a valid backup-shaped file remains strict", () => {
  assert.throws(() => parseTrustedJson('{"mode":"PLAN"}\n{"mode":"PLAN"}', "Approved plan"), /exactly one valid JSON document/);
  assert.throws(() => parseTrustedJson('{"mode":', "Backup receipt"), /exactly one valid JSON document/);
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-d1-json-"));
  const valid = path.join(directory, "receipt.json");
  writeFileSync(valid, '{"mode":"READ ONLY REMOTE EXPORT"}\n');
  assert.deepEqual(parseTrustedJson(readFileSync(valid, "utf8"), "Backup receipt"), { mode: "READ ONLY REMOTE EXPORT" });
});
