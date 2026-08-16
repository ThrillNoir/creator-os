import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const migrationPattern = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/i;

export const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
function containsByteValue(value, seen = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) => containsByteValue(entry, seen));
}
export const hashCanonicalJson = (value) => {
  if (containsByteValue(value)) throw new Error("Canonical JSON hashing does not accept byte values.");
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
};
export const hashText = (value) => {
  if (typeof value !== "string") throw new Error("Text hashing requires a string.");
  return createHash("sha256").update(value, "utf8").digest("hex");
};
export const hashBytes = (value) => {
  if (!(Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value))) throw new Error("Byte hashing requires a Buffer, ArrayBuffer, or typed array.");
  const bytes = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return createHash("sha256").update(bytes).digest("hex");
};
export const hashFileBytes = (filePath) => hashBytes(readFileSync(filePath));

export function planDigest(plan) {
  const copy = { ...plan };
  delete copy.planSha256;
  delete copy.confirmation;
  return hashCanonicalJson(copy);
}

export function migrationNumber(value) {
  const match = String(value ?? "").match(/^(\d{4})(?:_|$)/);
  if (!match) throw new Error("Migration boundary must be a four-digit migration number or filename.");
  return Number(match[1]);
}

export function assertInventory(migrations) {
  const seen = new Set();
  for (const migration of migrations) {
    if (!migrationPattern.test(migration.name) || !Number.isInteger(migration.number)) throw new Error("Migration inventory contains an invalid filename.");
    if (seen.has(migration.number)) throw new Error(`Duplicate migration number ${String(migration.number).padStart(4, "0")}.`);
    seen.add(migration.number);
  }
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].number !== migrations[index - 1].number + 1) throw new Error(`Migration gap between ${migrations[index - 1].name} and ${migrations[index].name}.`);
  }
  return migrations;
}

export function inventoryFromDirectory(directory, readdir) {
  const names = readdir(directory);
  for (const name of names) {
    if (!migrationPattern.test(name)) throw new Error(`Unexpected file in migration directory: ${name}.`);
  }
  const migrations = names.filter((name) => name.endsWith(".sql")).map((name) => {
    const match = name.match(migrationPattern);
    if (!match) throw new Error(`Unexpected SQL migration filename: ${name}.`);
    const file = path.join(directory, name);
    return { number: Number(match[1]), name, sha256: hashText(readFileSync(file, "utf8")) };
  }).sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));
  return assertInventory(migrations);
}

function exact(left, right) { return stableJson(left) === stableJson(right); }

export function targetFor({ environment, registry, policy }) {
  if (environment !== "staging" || !policy.allowedEnvironments?.includes(environment)) throw new Error("Bounded D1 migration execution is restricted to the explicit staging allow-list.");
  if (registry?.environments?.production?.provisioned || registry?.environments?.production?.deployable) throw new Error("Production must remain unprovisioned for bounded staging migrations.");
  const target = registry?.environments?.staging;
  const entries = Object.entries(target?.resources?.d1 ?? {});
  if (!target?.provisioned || !target?.deployable || entries.length !== 1) throw new Error("Staging D1 target is ambiguous.");
  const [databaseName, database] = entries[0];
  if (!database?.id || !database?.migrationsDir) throw new Error("Staging D1 registry identity is incomplete.");
  return { environment, accountId: target.accountId, databaseName, databaseId: database.id, migrationsDir: database.migrationsDir };
}

export function buildBoundedPlan({ environment, from, through, inventory, remoteApplied, registry, policy, git, releaseId }) {
  const target = targetFor({ environment, registry, policy });
  if (!/^[a-z0-9][a-z0-9._-]{2,95}$/i.test(releaseId ?? "")) throw new Error("A safe release identifier is required.");
  assertInventory(inventory);
  const fromNumber = migrationNumber(from);
  const throughNumber = migrationNumber(through);
  if (fromNumber > throughNumber) throw new Error("Migration range is reversed.");
  const start = inventory.findIndex((migration) => migration.number === fromNumber);
  const end = inventory.findIndex((migration) => migration.number === throughNumber);
  if (start === -1 || end === -1) throw new Error("Requested migration boundary does not exist in the repository inventory.");
  const expectedPreState = inventory.slice(0, start).map((migration) => migration.name);
  if (!exact(remoteApplied, expectedPreState)) throw new Error("Remote migration state does not exactly match the requested range start; create a new reviewed plan.");
  const selected = inventory.slice(start, end + 1);
  const excludedPending = inventory.slice(end + 1).map(({ number, name, sha256: digest }) => ({ number, name, sha256: digest }));
  const plan = {
    schemaVersion: 1,
    mode: "PLAN",
    releaseId,
    environment,
    target,
    git,
    requestedRange: { from: selected[0].name, through: selected.at(-1).name },
    preMigrationState: remoteApplied,
    execution: selected.map(({ number, name, sha256: digest }) => ({ number, name, sha256: digest })),
    excludedPending,
    postMigrationState: [...remoteApplied, ...selected.map((migration) => migration.name)],
    remoteMutation: false,
  };
  plan.planSha256 = planDigest(plan);
  plan.confirmation = `bounded:${plan.planSha256.slice(0, 16)}`;
  return plan;
}

export function validateBackup({ receipt, receiptPath, target, expectedMigrationState, maxAgeMinutes, now = new Date() }) {
  if (!receiptPath || !path.isAbsolute(receiptPath) || !existsSync(receiptPath)) throw new Error("A readable absolute backup receipt is required.");
  const backup = receipt?.target;
  if (receipt?.mode !== "READ ONLY REMOTE EXPORT" || !backup || backup.environment !== target.environment || backup.databaseName !== target.databaseName || backup.databaseId !== target.databaseId || !exact(backup.migrations, expectedMigrationState) || !/^[a-f0-9]{64}$/i.test(receipt.sqlChecksum ?? "")) throw new Error("Backup receipt does not match the bounded migration target.");
  const exportedAt = new Date(receipt.exportedAt);
  if (Number.isNaN(exportedAt.valueOf()) || now.valueOf() - exportedAt.valueOf() > maxAgeMinutes * 60_000 || exportedAt > now) throw new Error("Backup receipt is stale or invalid.");
  const exportPath = receiptPath.replace(/\.receipt\.json$/, "");
  if (!existsSync(exportPath) || statSync(exportPath).size === 0 || hashFileBytes(exportPath) !== receipt.sqlChecksum) throw new Error("Backup export is missing or its checksum does not match the receipt.");
  return { receiptPath, exportedAt: exportedAt.toISOString(), sqlChecksum: receipt.sqlChecksum, receiptHash: hashCanonicalJson(receipt) };
}

export function assertApplyGates({ plan, currentPlan, remoteApplied, git, clean, backup, confirmation }) {
  if (plan?.mode !== "PLAN" || plan?.environment !== "staging" || planDigest(plan) !== plan.planSha256) throw new Error("Approved bounded migration plan digest is invalid.");
  if (confirmation !== plan.confirmation) throw new Error("Apply requires the exact bounded plan confirmation string.");
  if (!clean || plan.git?.clean !== true || !git || plan.git?.sha !== git.sha || plan.git?.branch !== git.branch) throw new Error("Apply requires the exact clean Git identity used for the reviewed plan.");
  if (!backup?.receiptHash) throw new Error("Apply requires validated backup evidence.");
  if (!exact(plan.execution, currentPlan.execution) || !exact(plan.preMigrationState, remoteApplied) || !exact(plan.target, currentPlan.target)) throw new Error("Migration inventory, target, or remote state drifted since planning.");
  return true;
}

export function migrationSql({ directory, migration }) {
  const content = readFileSync(path.join(directory, migration.name), "utf8");
  if (hashText(content) !== migration.sha256) throw new Error(`Migration digest changed for ${migration.name}.`);
  return `${content}\nINSERT INTO "d1_migrations" (name) VALUES ('${migration.name.replaceAll("'", "''")}');\n`;
}

export async function executeBoundedPlan({ plan, directory, executeOne, getApplied, receiptBase }) {
  const applied = [];
  let failed = null;
  for (const migration of plan.execution) {
    try {
      await executeOne({ migration, sql: migrationSql({ directory, migration }) });
      const state = await getApplied();
      const expected = [...plan.preMigrationState, ...applied, migration.name];
      if (!exact(state, expected)) throw new Error("Canonical D1 bookkeeping did not advance by exactly one planned migration.");
      applied.push(migration.name);
    } catch (error) {
      failed = { migration: migration.name, error: error instanceof Error ? error.message : String(error) };
      break;
    }
  }
  let postMigrationState = null;
  let postStateError = null;
  try {
    postMigrationState = await getApplied();
  } catch (error) {
    postStateError = error instanceof Error ? error.message : String(error);
    if (!failed) failed = { migration: null, error: "Post-migration state could not be read; manual recovery review is required." };
  }
  return {
    ...receiptBase,
    mode: "APPLY",
    planSha256: plan.planSha256,
    requestedRange: plan.requestedRange,
    applied,
    failed,
    excludedPending: plan.excludedPending.map((migration) => migration.name),
    postMigrationState,
    postStateError,
    result: failed ? "FAILED" : "APPLIED",
    remoteMutation: applied.length > 0,
    productionTouched: false,
  };
}
