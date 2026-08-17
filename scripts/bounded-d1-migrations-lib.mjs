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
  if (migrations.length > 0 && migrations[0].number !== 1) throw new Error("Migration inventory must begin at 0001.");
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

function canonicalHistory(history, label) {
  if (!Array.isArray(history)) throw new Error(`${label} must be an ordered migration array.`);
  const seen = new Set();
  return history.map((name, index) => {
    if (typeof name !== "string" || !migrationPattern.test(name)) throw new Error(`${label} contains an invalid migration filename.`);
    const number = Number(name.slice(0, 4));
    if (seen.has(number)) throw new Error(`${label} contains a duplicate migration number.`);
    if (number !== index + 1) throw new Error(`${label} must be contiguous and ordered from 0001.`);
    seen.add(number);
    return name;
  });
}

/**
 * Canonical D1 history is an ordered, contiguous filename sequence. Comparing
 * the whole sequence—not just its final number—rejects gaps, duplicate names,
 * renamed files, and unexpected earlier migrations.
 */
export function assertExactMigrationHistory(observed, expected, label = "Migration history") {
  const reviewed = canonicalHistory(expected, `Reviewed ${label}`);
  const actual = canonicalHistory(observed, label);
  if (!exact(actual, reviewed)) throw new Error(`${label} does not exactly match the reviewed migration history.`);
  return actual;
}

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
  try {
    assertExactMigrationHistory(remoteApplied, expectedPreState, "Structured D1 migration history");
  } catch {
    throw new Error("Remote migration state does not exactly match the requested range start; create a new reviewed plan.");
  }
  const selected = inventory.slice(start, end + 1);
  const excludedPending = inventory.slice(end + 1).map(({ number, name, sha256: digest }) => ({ number, name, sha256: digest }));
  const plan = {
    schemaVersion: 2,
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
    remoteMutation: "NONE",
  };
  plan.planSha256 = planDigest(plan);
  plan.confirmation = `bounded:${plan.planSha256.slice(0, 16)}`;
  return plan;
}

/**
 * Validate the immutable release expectations embedded in an approved bounded
 * plan before allowing an export to become backup evidence. This is local-only
 * validation; the apply path separately rebuilds the plan with structured D1
 * state immediately before any mutation.
 */
export function validateReleaseExportPlan({ plan, target, inventory }) {
  if (plan?.schemaVersion !== 2 || plan.mode !== "PLAN" || plan.environment !== "staging" || planDigest(plan) !== plan.planSha256) throw new Error("Approved bounded migration plan digest is invalid.");
  if (!target || ["environment", "accountId", "databaseName", "databaseId"].some((field) => plan.target?.[field] !== target[field])) throw new Error("Approved bounded migration plan does not match the staging D1 identity.");
  assertInventory(inventory);
  const from = migrationNumber(plan.requestedRange?.from);
  const through = migrationNumber(plan.requestedRange?.through);
  const start = inventory.findIndex((migration) => migration.number === from);
  const end = inventory.findIndex((migration) => migration.number === through);
  if (start === -1 || end === -1 || start > end) throw new Error("Approved bounded migration plan has invalid range boundaries.");
  const expectedPreState = inventory.slice(0, start).map((migration) => migration.name);
  const expectedExecution = inventory.slice(start, end + 1).map(({ number, name, sha256: digest }) => ({ number, name, sha256: digest }));
  const expectedExcluded = inventory.slice(end + 1).map(({ number, name, sha256: digest }) => ({ number, name, sha256: digest }));
  assertExactMigrationHistory(plan.preMigrationState, expectedPreState, "Reviewed plan pre-migration history");
  if (plan.requestedRange.from !== expectedExecution[0].name || plan.requestedRange.through !== expectedExecution.at(-1).name || !exact(plan.execution, expectedExecution) || !exact(plan.excludedPending, expectedExcluded) || !exact(plan.postMigrationState, [...expectedPreState, ...expectedExecution.map((migration) => migration.name)])) {
    throw new Error("Approved bounded migration plan does not match the reviewed repository migration inventory.");
  }
  return { preMigrationState: expectedPreState, planSha256: plan.planSha256 };
}

export function validateBackup({ receipt, receiptPath, plan, target, maxAgeMinutes, now = new Date() }) {
  if (!receiptPath || !path.isAbsolute(receiptPath) || !existsSync(receiptPath)) throw new Error("A readable absolute backup receipt is required.");
  if (plan?.mode !== "PLAN" || plan.environment !== "staging" || planDigest(plan) !== plan.planSha256 || !target || ["environment", "accountId", "databaseName", "databaseId"].some((field) => plan.target?.[field] !== target[field])) throw new Error("Backup validation requires the exact approved bounded migration plan.");
  const expectedMigrationState = assertExactMigrationHistory(plan.preMigrationState, plan.preMigrationState, "Reviewed plan pre-migration history");
  const backup = receipt?.target;
  const preStateSha256 = hashCanonicalJson(expectedMigrationState);
  if (receipt?.schemaVersion !== 2 || receipt?.mode !== "READ ONLY REMOTE EXPORT" || !backup || backup.environment !== target.environment || backup.accountId !== target.accountId || backup.databaseName !== target.databaseName || backup.databaseId !== target.databaseId || receipt.planSha256 !== plan.planSha256 || receipt.preMigrationStateSha256 !== preStateSha256 || !/^[a-f0-9]{64}$/i.test(receipt.sqlChecksum ?? "")) throw new Error("Backup receipt does not match the approved bounded migration plan and target.");
  assertExactMigrationHistory(backup.migrations, expectedMigrationState, "Export receipt migration history");
  const exportedAt = new Date(receipt.exportedAt);
  if (Number.isNaN(exportedAt.valueOf()) || now.valueOf() - exportedAt.valueOf() > maxAgeMinutes * 60_000 || exportedAt > now) throw new Error("Backup receipt is stale or invalid.");
  const exportPath = receiptPath.replace(/\.receipt\.json$/, "");
  if (!existsSync(exportPath) || statSync(exportPath).size === 0 || hashFileBytes(exportPath) !== receipt.sqlChecksum) throw new Error("Backup export is missing or its checksum does not match the receipt.");
  return { receiptPath, exportedAt: exportedAt.toISOString(), sqlChecksum: receipt.sqlChecksum, planSha256: plan.planSha256, receiptHash: hashCanonicalJson(receipt) };
}

export function assertApplyGates({ plan, currentPlan, remoteApplied, git, clean, backup, confirmation }) {
  if (plan?.mode !== "PLAN" || plan?.environment !== "staging" || planDigest(plan) !== plan.planSha256) throw new Error("Approved bounded migration plan digest is invalid.");
  if (confirmation !== plan.confirmation) throw new Error("Apply requires the exact bounded plan confirmation string.");
  if (!clean || plan.git?.clean !== true || !git || plan.git?.sha !== git.sha || plan.git?.branch !== git.branch) throw new Error("Apply requires the exact clean Git identity used for the reviewed plan.");
  if (!backup?.receiptHash || backup.planSha256 !== plan.planSha256) throw new Error("Apply requires backup evidence bound to the exact approved plan.");
  assertExactMigrationHistory(remoteApplied, plan.preMigrationState, "Structured D1 migration history");
  if (!exact(plan.execution, currentPlan.execution) || !exact(plan.preMigrationState, remoteApplied) || !exact(plan.target, currentPlan.target)) throw new Error("Migration inventory, target, or remote state drifted since planning.");
  return true;
}

export function migrationSql({ directory, migration }) {
  const content = readFileSync(path.join(directory, migration.name), "utf8");
  if (hashText(content) !== migration.sha256) throw new Error(`Migration digest changed for ${migration.name}.`);
  return `${content}\nINSERT INTO "d1_migrations" (name) VALUES ('${migration.name.replaceAll("'", "''")}');\n`;
}

export const MUTATION_OUTCOMES = Object.freeze({
  NONE: "NONE",
  POSSIBLE: "POSSIBLE",
  CONFIRMED: "CONFIRMED",
  CONFIRMED_NO_CHANGE: "CONFIRMED_NO_CHANGE",
});

function diagnosticClass(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/json|stdout|stderr|parse|ambiguous/i.test(message)) return "LOCAL_RESULT_UNAVAILABLE";
  if (/timeout|abort|signal|network|transport|fetch/i.test(message)) return "TRANSPORT_OR_TIMEOUT";
  if (/auth|token|credential|authorization/i.test(message)) return "AUTHENTICATION_OR_AUTHORIZATION";
  return fallback;
}

function noEffectsResult(value) {
  return value && typeof value === "object" && value.status === "NO_EFFECTS";
}

function remoteMutationState({ remotelyConfirmed, outcomeUnknown, confirmedNoChange }) {
  if (outcomeUnknown.length > 0) return MUTATION_OUTCOMES.POSSIBLE;
  if (remotelyConfirmed.length > 0) return MUTATION_OUTCOMES.CONFIRMED;
  if (confirmedNoChange.length > 0) return MUTATION_OUTCOMES.CONFIRMED_NO_CHANGE;
  return MUTATION_OUTCOMES.NONE;
}

/**
 * Execute an already-reviewed bounded plan one migration at a time.
 *
 * `markSubmitted` is deliberately controlled by the mutation adapter. Once
 * called, a local exception is never interpreted as proof that D1 did not
 * change: canonical D1 history must reconcile the attempt before execution
 * may advance to another migration.
 */
export async function executeBoundedPlan({ plan, directory, executeOne, getApplied, verifyNoEffects, receiptBase }) {
  const attempted = [];
  const locallyConfirmed = [];
  const remotelyConfirmed = [];
  const confirmedNoChange = [];
  const outcomeUnknown = [];
  const localCommandErrors = [];
  const attempts = [];
  let expectedState = [...plan.preMigrationState];
  let failed = null;
  let postMigrationState = null;
  let postStateError = null;

  for (const migration of plan.execution) {
    let submitted = false;
    let localConfirmed = false;
    let localError = null;
    let localDiagnostic = null;
    const markSubmitted = () => {
      if (!submitted) {
        submitted = true;
        attempted.push(migration.name);
      }
    };

    try {
      await executeOne({ migration, sql: migrationSql({ directory, migration }), markSubmitted });
      localConfirmed = submitted;
      if (!submitted) localError = new Error("Mutation adapter returned without recording the submission point of no return.");
    } catch (error) {
      localError = error;
    }
    if (localConfirmed) locallyConfirmed.push(migration.name);
    if (localError) {
      localDiagnostic = diagnosticClass(localError, "LOCAL_COMMAND_FAILURE");
      localCommandErrors.push({ migration: migration.name, diagnostic: localDiagnostic });
    }

    let state;
    try {
      state = await getApplied();
      if (!Array.isArray(state)) throw new Error("Structured reconciliation returned a non-array migration history.");
      state = [...state];
      postMigrationState = [...state];
      postStateError = null;
    } catch (error) {
      postStateError = diagnosticClass(error, "STRUCTURED_RECONCILIATION_UNAVAILABLE");
      if (submitted) {
        outcomeUnknown.push(migration.name);
        attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "UNKNOWN", diagnostic: postStateError });
      } else {
        failed = { migration: migration.name, diagnostic: localDiagnostic ?? postStateError };
        attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "NONE", diagnostic: failed.diagnostic });
      }
      break;
    }

    const expectedAfter = [...expectedState, migration.name];
    if (exact(state, expectedAfter) && submitted) {
      remotelyConfirmed.push(migration.name);
      attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "CONFIRMED", diagnostic: localDiagnostic });
      expectedState = [...state];
      continue;
    }

    if (exact(state, expectedState) && !submitted) {
      failed = { migration: migration.name, diagnostic: localDiagnostic ?? "MUTATION_NOT_SUBMITTED" };
      attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "NONE", diagnostic: failed.diagnostic });
      break;
    }

    if (exact(state, expectedState) && submitted) {
      let noEffects = null;
      if (typeof verifyNoEffects === "function") {
        try {
          noEffects = await verifyNoEffects({ migration, preMigrationState: expectedState, postMigrationState: state });
        } catch (error) {
          noEffects = { status: "INDETERMINATE", diagnostic: diagnosticClass(error, "SCHEMA_RECONCILIATION_UNAVAILABLE") };
        }
      }
      if (noEffectsResult(noEffects)) {
        confirmedNoChange.push(migration.name);
        failed = { migration: migration.name, diagnostic: localDiagnostic ?? "REMOTE_CONFIRMED_NO_CHANGE" };
        attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "CONFIRMED_NO_CHANGE", diagnostic: failed.diagnostic });
      } else {
        outcomeUnknown.push(migration.name);
        attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: "UNKNOWN", diagnostic: noEffects?.diagnostic ?? "SCHEMA_EFFECTS_NOT_INDEPENDENTLY_VERIFIED" });
      }
      break;
    }

    const diagnostic = submitted ? "CANONICAL_HISTORY_DIVERGED" : "CANONICAL_HISTORY_CHANGED_WITHOUT_SUBMISSION_MARKER";
    if (submitted) outcomeUnknown.push(migration.name);
    else failed = { migration: migration.name, diagnostic };
    attempts.push({ migration: migration.name, submitted, localConfirmed, remoteOutcome: submitted ? "UNKNOWN" : "NONE", diagnostic });
    break;
  }

  const remoteMutation = remoteMutationState({ remotelyConfirmed, outcomeUnknown, confirmedNoChange });
  return {
    ...receiptBase,
    schemaVersion: 2,
    mode: "APPLY",
    planSha256: plan.planSha256,
    requestedRange: plan.requestedRange,
    attempted,
    locallyConfirmed,
    remotelyConfirmed,
    confirmedNoChange,
    outcomeUnknown,
    localCommandErrors,
    attempts,
    failed,
    excludedPending: plan.excludedPending.map((migration) => migration.name),
    postMigrationState,
    postStateError,
    result: remotelyConfirmed.length === plan.execution.length ? "APPLIED" : outcomeUnknown.length > 0 ? "STOPPED_UNCERTAIN" : "FAILED",
    remoteMutation,
    productionTouched: false,
  };
}
