import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MIGRATION_DISABLED_MESSAGE,
  closeStableSnapshot,
  gitSha,
  loadMapping,
  loadSafetyContract,
  migrationState,
  openReadOnlySnapshot,
  reconcileCreator,
  requireApprovedMapping,
  sha256,
  stableJson,
  validateTargetAuthority,
  verifyExpectedMigrations,
} from "./reconciliation-lib.mjs";
import { resolveAssetIdentity } from "./identity-resolver.mjs";
import { resolveConnectionEntry } from "./connection-evidence.mjs";
import { evaluateResolutionPolicy } from "./resolution-policy.mjs";

const connectionMappingPath = new URL("../../config/migration/connection-mappings.json", import.meta.url);

function fail(message) { throw new Error(message); }

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--creator", "--source-snapshot", "--target-snapshot", "--output"].includes(argument)) options[argument.slice(2).replaceAll("-", "_")] = argv[++index];
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--help") options.help = true;
    else fail(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return "Usage: node scripts/migration/automated-reconcile.mjs --environment staging --creator <creator-id|all> --source-snapshot <absolute SQLite path> --target-snapshot <absolute D1 parse SQLite path> --output <absolute JSON path>";
}

function requireOptions(options) {
  if (options.apply) fail(MIGRATION_DISABLED_MESSAGE);
  for (const required of ["environment", "creator", "source_snapshot", "target_snapshot", "output"]) if (!options[required]) fail(`Missing --${required.replaceAll("_", "-")}. ${usage()}`);
  if (!path.isAbsolute(options.output)) fail("--output must be an absolute path.");
}

function recordRef(creatorId, domain, value) {
  return sha256(`${creatorId}:${domain}:${value}`).slice(0, 24);
}

function sourceObjectAvailable(sourceDb, creatorId, relativePath, declaredAvailable) {
  if (!declaredAvailable) return false;
  const creator = sourceDb.prepare("SELECT media_source FROM creators WHERE id=?").get(creatorId);
  if (!creator?.media_source) return false;
  const root = path.resolve(creator.media_source);
  const candidate = path.resolve(root, relativePath);
  return candidate.startsWith(`${root}${path.sep}`) && existsSync(candidate);
}

function connectionSignals(sourceDb, targetDb, entry) {
  if (entry.creatorId !== "adelaide" || entry.kind !== "messaging_connection" || entry.platform !== "fansly") return [];
  const threadOverlap = sourceDb.prepare(`SELECT count(*) AS count FROM message_threads source
    JOIN messaging_connections connection ON connection.id=source.connection_id AND connection.creator_id=source.creator_id
    WHERE source.creator_id=? AND connection.platform=? AND source.external_thread_id<>''
      AND EXISTS (SELECT 1 FROM message_threads target WHERE target.creator_id=source.creator_id AND target.external_thread_id=source.external_thread_id)`).get(entry.creatorId, entry.platform).count;
  const messageOverlap = sourceDb.prepare(`SELECT count(*) AS count FROM messages source
    JOIN message_threads thread ON thread.id=source.thread_id AND thread.creator_id=source.creator_id
    JOIN messaging_connections connection ON connection.id=thread.connection_id AND connection.creator_id=source.creator_id
    WHERE source.creator_id=? AND connection.platform=? AND source.external_message_id<>''
      AND EXISTS (SELECT 1 FROM messages target WHERE target.creator_id=source.creator_id AND target.external_message_id=source.external_message_id)`).get(entry.creatorId, entry.platform).count;
  const signals = [];
  if (threadOverlap > 0) signals.push({ code: "EXACT_PROVIDER_THREAD_ID_OVERLAP", family: "provider_thread_id", strength: "STRONG", relation: "SUPPORTS", deterministic: true });
  if (messageOverlap > 0) signals.push({ code: "EXACT_PROVIDER_MESSAGE_ID_OVERLAP", family: "provider_message_id", strength: "STRONG", relation: "SUPPORTS", deterministic: true });
  return signals;
}

function resolveConnections(sourceDb, targetDb) {
  const mapping = JSON.parse(readFileSync(connectionMappingPath, "utf8"));
  return mapping.entries.map((entry) => {
    const extraSignals = connectionSignals(sourceDb, targetDb, entry);
    return { entry, resolution: resolveConnectionEntry(entry, extraSignals), automaticInvestigation: extraSignals.map((signal) => signal.code) };
  });
}

function assetInvestigations(sourceDb, targetDb, creatorId) {
  const sourceAssets = sourceDb.prepare("SELECT id,creator_id,relative_path,basename,extension,bytes,source_available FROM assets WHERE creator_id=? ORDER BY id").all(creatorId);
  const targetAssets = targetDb.prepare("SELECT id,creator_id,relative_path,basename,extension,bytes,source_available,dropbox_revision,preview_r2_key,media_r2_key FROM assets WHERE creator_id=? ORDER BY id").all(creatorId);
  const targetPaths = new Set(targetAssets.map((asset) => asset.relative_path));
  return sourceAssets.filter((asset) => !targetPaths.has(asset.relative_path)).map((asset) => {
    const sourceAvailable = sourceObjectAvailable(sourceDb, creatorId, asset.relative_path, asset.source_available);
    const identity = resolveAssetIdentity({ creatorId, source: { ...asset, source_available: sourceAvailable }, targetCandidates: targetAssets });
    return { ref: recordRef(creatorId, "assets", asset.id), identity, sourceObjectVerified: sourceAvailable && identity.assetStatus === "SOURCE_ONLY" };
  });
}

function futureCanonicalInventory(sourceDb, futureMapping) {
  const creatorId = futureMapping.sqliteCreatorId;
  const assets = sourceDb.prepare("SELECT id,relative_path,source_available FROM assets WHERE creator_id=? ORDER BY id").all(creatorId);
  const assetAvailability = assets.reduce((counts, asset) => {
    const available = sourceObjectAvailable(sourceDb, creatorId, asset.relative_path, asset.source_available);
    counts[available ? "SOURCE_OBJECT_PRESENT" : "SOURCE_MISSING"] += 1;
    return counts;
  }, { SOURCE_OBJECT_PRESENT: 0, SOURCE_MISSING: 0 });
  const count = (table) => {
    const columns = new Set(sourceDb.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    if (!columns.has("creator_id")) return 0;
    return sourceDb.prepare(`SELECT count(*) AS count FROM ${table} WHERE creator_id=?`).get(creatorId).count;
  };
  return {
    creatorId,
    classification: futureMapping.classification,
    targetStatus: "FUTURE_CANONICAL_NO_TARGET",
    activeMigrationCandidates: 0,
    categories: {
      futureCandidateSet: { assets: assetAvailability.SOURCE_OBJECT_PRESENT, classifications: count("asset_classifications") },
      archiveOnly: { audit: count("messaging_audit_events"), sourceMissingAssets: assetAvailability.SOURCE_MISSING },
      reconnect: { accounts: count("accounts"), providerOrServiceConnections: count("creator_service_connections"), messagingConnections: count("messaging_connections"), bridgeOrVaultState: count("local_bridge_connections") + count("vault_upload_jobs") },
      manualReview: { people: count("people"), publishing: count("post_packages") + count("publication_jobs"), threads: count("message_threads"), messages: count("messages") },
      excluded: { credentialsAndPairings: count("platform_connections") + count("local_bridge_pairings") }
    },
  };
}

function severity(classification) {
  return ({ CONFLICT: 0, AMBIGUOUS: 1, PROBABLE: 2, SOURCE_MISSING: 2, MANUAL_REVIEW: 3 })[classification] ?? 4;
}

export function groupedExceptions(items, snapshotScope) {
  const groups = new Map();
  for (const item of items.filter((item) => item.requiresHumanInput)) {
    const key = stableJson({ creatorId: item.creatorId, domain: item.domain, entityType: item.entityType, classification: item.classification, reasonCodes: [...item.reasonCodes].sort(), recommendedResolution: item.recommendedResolution, risk: item.risk });
    const group = groups.get(key) ?? { ...item, recordRefs: [] };
    group.recordRefs.push(...item.recordRefs);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const refs = [...new Set(group.recordRefs)].sort();
    return {
      exceptionId: `exc-${sha256(stableJson({ snapshotScope, key: { creatorId: group.creatorId, domain: group.domain, entityType: group.entityType, classification: group.classification, reasonCodes: group.reasonCodes }, refs })).slice(0, 20)}`,
      creator: group.creatorId,
      domain: group.domain,
      entity: group.entityType,
      classification: group.classification,
      confidence: group.confidence,
      evidence: [...new Set(group.evidence ?? [])].sort(),
      conflictingEvidence: [...new Set(group.conflictingEvidence ?? [])].sort(),
      risk: group.risk,
      recommendedResolution: group.recommendedResolution,
      requiresHumanInput: true,
      affectedRecordCount: refs.length,
      sampleRecordRefs: refs.slice(0, 3),
      recordRefsChecksum: sha256(refs.join(",")),
      automaticInvestigation: [...new Set(group.automaticInvestigation ?? [])].sort(),
    };
  }).sort((left, right) => severity(left.classification) - severity(right.classification) || left.creator.localeCompare(right.creator) || left.domain.localeCompare(right.domain) || left.exceptionId.localeCompare(right.exceptionId));
}

function operatorMarkdown(report) {
  const lines = ["# THOT OS automated reconciliation", "", "## Operator summary", "", `- Automatically resolved: ${report.metrics.automaticallyResolved}/${report.metrics.totalEntitiesAnalysed} (${report.metrics.automaticResolutionPercentage}%)`, `- Protected target data: ${report.metrics.targetAuthoritative}`, `- Archive-only: ${report.metrics.archiveOnly}`, `- Human decisions: ${report.metrics.requiresHumanIntervention}`, "", "## Human exceptions", ""];
  if (!report.exceptions.length) lines.push("No human decision is currently required.");
  for (const exception of report.exceptions) lines.push(`- **${exception.creator} / ${exception.domain}:** ${exception.recommendedResolution} (${exception.affectedRecordCount} grouped record${exception.affectedRecordCount === 1 ? "" : "s"}).`);
  lines.push("", "## Candidate discovery", "");
  if (!report.candidateDiscovery.length) lines.push("NO SAFE MIGRATION REQUIRED/AVAILABLE");
  for (const candidate of report.candidateDiscovery) lines.push(`- ${candidate.creator}/${candidate.domain}: ${candidate.status} — ${candidate.reasonCodes.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

export function automatedReconcile(options) {
  requireOptions(options);
  const safety = loadSafetyContract();
  const target = validateTargetAuthority({ environment: options.environment });
  const creatorMappings = loadMapping();
  const source = openReadOnlySnapshot(options.source_snapshot, "Source snapshot");
  const targetSnapshot = openReadOnlySnapshot(options.target_snapshot, "Target snapshot");
  try {
    target.migrations = migrationState(targetSnapshot.db);
    verifyExpectedMigrations(target.migrations, safety);
    target.sha256 = targetSnapshot.sha256;
    const requested = options.creator === "all" ? creatorMappings.mappings.map((mapping) => mapping.sqliteCreatorId) : [options.creator];
    const manifests = [];
    const exceptionItems = [];
    const candidateDiscovery = [];
    let totalEntitiesAnalysed = 0;
    let automaticallyResolved = 0;
    let targetAuthoritative = 0;
    let archiveOnly = 0;
    const byConfidence = { DETERMINISTIC: 0, HIGH_CONFIDENCE: 0, PROBABLE: 0, AMBIGUOUS: 0, CONFLICT: 0, NO_MATCH: 0 };
    for (const creatorId of requested) {
      const mapping = requireApprovedMapping(creatorMappings, creatorId);
      const domains = reconcileCreator({ sourceDb: source.db, targetDb: targetSnapshot.db, creatorId });
      for (const [domain, result] of Object.entries(domains)) {
        totalEntitiesAnalysed += result.records.length;
        for (const record of result.records) {
          if (["MATCH", "TARGET_ONLY"].includes(record.classification)) { automaticallyResolved += 1; byConfidence.DETERMINISTIC += 1; }
          if (record.classification === "TARGET_AUTHORITATIVE") { automaticallyResolved += 1; targetAuthoritative += 1; }
          if (record.classification === "ARCHIVE_ONLY") { automaticallyResolved += 1; archiveOnly += 1; }
          if (["CONFLICT", "AMBIGUOUS", "MANUAL_REVIEW"].includes(record.classification)) {
            byConfidence[record.classification === "MANUAL_REVIEW" ? "AMBIGUOUS" : record.classification] += 1;
            if (record.classification === "CONFLICT") exceptionItems.push({ creatorId, domain, entityType: domain, classification: record.classification, confidence: "CONFLICT", evidence: [], conflictingEvidence: [], reasonCodes: [record.reason ?? "MANUAL_REVIEW_REQUIRED"], risk: "medium", recommendedResolution: "Review the grouped evidence before any future manifest", requiresHumanInput: true, recordRefs: [record.ref], automaticInvestigation: [] });
          }
        }
      }
      manifests.push({ creatorId, mapping: { confidence: mapping.confidence, approval: mapping.approval }, domains: Object.fromEntries(Object.entries(domains).map(([domain, result]) => [domain, result.counts])) });
      for (const investigation of assetInvestigations(source.db, targetSnapshot.db, creatorId)) {
        const policy = evaluateResolutionPolicy({ resolution: { confidence: investigation.identity.confidence, autoResolutionEligible: investigation.identity.confidence === "HIGH_CONFIDENCE" }, domain: "assets", creatorMapping: mapping, sourceObjectVerified: investigation.sourceObjectVerified, transformationSupported: true, accountDependency: "RESOLVED" });
        candidateDiscovery.push({ creator: creatorId, domain: "assets", recordRef: investigation.ref, status: policy.eligibility === "AUTO_ELIGIBLE" ? "SAFE_CANDIDATE" : "NOT_SAFE", riskRank: policy.eligibility === "AUTO_ELIGIBLE" ? 1 : 9, dependencyCount: policy.blockers.length, verificationComplexity: investigation.identity.assetStatus === "SOURCE_ONLY" ? 1 : 3, affectedRecordCount: 1, assetStatus: investigation.identity.assetStatus, confidence: investigation.identity.confidence, reasonCodes: [...new Set([...investigation.identity.reasonCodes, ...policy.blockers])].sort() });
        if (investigation.identity.assetStatus !== "SAME_AS_TARGET") exceptionItems.push({ creatorId, domain: "assets", entityType: "asset", classification: investigation.identity.assetStatus === "SOURCE_MISSING" ? "SOURCE_MISSING" : "AMBIGUOUS", confidence: investigation.identity.confidence, evidence: investigation.identity.evidence, conflictingEvidence: investigation.identity.conflictingEvidence, reasonCodes: investigation.identity.reasonCodes, risk: "medium", recommendedResolution: "Verify the immutable source object and resolve the possible target duplicate", requiresHumanInput: true, recordRefs: [investigation.ref], automaticInvestigation: ["same_creator_filename_bytes_extension_scan", "source_filesystem_availability_check"] });
      }
    }
    const connections = resolveConnections(source.db, targetSnapshot.db);
    for (const item of connections) {
      totalEntitiesAnalysed += 1;
      byConfidence[item.resolution.confidence] += 1;
      const declaredResolved = item.entry.classification === "CONFIRMED";
      const automaticallyResolvedConnection = declaredResolved || item.resolution.autoResolutionEligible;
      if (automaticallyResolvedConnection) automaticallyResolved += 1;
      const hasCandidateToResolve = item.entry.targetRef || (item.entry.evidence ?? []).includes("one_target_platform_candidate");
      if (["PROBABLE", "CONFLICT"].includes(item.resolution.confidence) && hasCandidateToResolve && item.entry.classification !== "CONFIRMED") {
        const platform = item.entry.platform ?? item.entry.service;
        const redditConflict = item.entry.creatorId === "adelaide" && platform === "reddit" && item.resolution.confidence === "CONFLICT";
        const instagramProbable = item.entry.creatorId === "adelaide" && platform === "instagram" && item.resolution.confidence === "PROBABLE";
        exceptionItems.push({ creatorId: item.entry.creatorId, domain: redditConflict ? "reddit_identity" : instagramProbable ? "instagram_identity" : "connections", entityType: redditConflict ? "account_and_provider" : instagramProbable ? "account_and_messaging" : item.entry.kind, classification: item.resolution.confidence === "CONFLICT" ? "CONFLICT" : "PROBABLE", confidence: item.resolution.confidence, evidence: item.resolution.evidence, conflictingEvidence: item.resolution.conflictingEvidence, reasonCodes: redditConflict ? ["REDDIT_IDENTITY_CONFLICT"] : instagramProbable ? ["INSTAGRAM_ACCOUNT_CONTINUITY_UNPROVEN"] : item.resolution.reasonCodes, risk: item.resolution.confidence === "CONFLICT" ? "high" : "medium", recommendedResolution: item.resolution.confidence === "CONFLICT" ? "Choose the canonical account identity and reconnect if required" : "Obtain one immutable provider or account identifier before confirming", requiresHumanInput: true, recordRefs: [item.entry.sourceRef ?? item.entry.targetRef].filter(Boolean), automaticInvestigation: item.automaticInvestigation });
      }
    }
    const future = (creatorMappings.futureCanonicalMappings ?? []).filter((mapping) => options.creator === "all" || mapping.sqliteCreatorId === options.creator).map((mapping) => futureCanonicalInventory(source.db, mapping));
    for (const inventory of future) {
      totalEntitiesAnalysed += Object.values(inventory.categories).reduce((sum, category) => sum + Object.values(category).reduce((inner, count) => inner + count, 0), 0);
      archiveOnly += inventory.categories.archiveOnly.audit + inventory.categories.archiveOnly.sourceMissingAssets;
      exceptionItems.push({ creatorId: inventory.creatorId, domain: "creator_authority", entityType: "creator", classification: "AMBIGUOUS", confidence: "AMBIGUOUS", evidence: ["OWNER_DECLARED_FUTURE_CANONICAL_CREATOR"], conflictingEvidence: [], reasonCodes: ["FUTURE_CANONICAL_CREATOR_NOT_CREATED"], risk: "high", recommendedResolution: "Approve a dedicated canonical-creator creation phase before evaluating child records", requiresHumanInput: true, recordRefs: [recordRef(inventory.creatorId, "creator_authority", inventory.creatorId)], automaticInvestigation: ["future_canonical_source_inventory"] });
    }
    candidateDiscovery.sort((left, right) => left.riskRank - right.riskRank || left.dependencyCount - right.dependencyCount || left.verificationComplexity - right.verificationComplexity || left.affectedRecordCount - right.affectedRecordCount || left.creator.localeCompare(right.creator) || left.domain.localeCompare(right.domain) || left.recordRef.localeCompare(right.recordRef));
    const exceptions = groupedExceptions(exceptionItems, `${source.sha256}:${target.sha256}`);
    return {
      schemaVersion: 1,
      mode: "READ ONLY / DRY RUN",
      source: { snapshot: path.basename(source.path), checksum: source.sha256, integrity: source.integrity },
      target: { environment: target.environment, databaseName: target.databaseName, databaseId: target.databaseId, snapshotChecksum: target.sha256, migrationState: target.migrations },
      safety: { phase: safety.phase, applyEnabled: safety.applyEnabled, environment: target.environment, remoteMutation: false, existingD1UpdateDefault: "DENY" },
      manifests,
      connections: connections.map(({ entry, resolution, automaticInvestigation }) => ({ creator: entry.creatorId, entityType: entry.kind, platform: entry.platform ?? entry.service, declaredClassification: entry.classification, computedConfidence: resolution.confidence, resolution: resolution.autoResolutionEligible || entry.classification === "CONFIRMED" ? "AUTO_RESOLVED_NON_DESTRUCTIVE_MAPPING" : "PRESERVE_OR_ESCALATE", credentialDecision: entry.credentialDecision, evidence: resolution.evidence, conflictingEvidence: resolution.conflictingEvidence, automaticInvestigation })),
      futureCanonicalCreators: future,
      metrics: { totalEntitiesAnalysed, automaticallyResolved, automaticResolutionPercentage: totalEntitiesAnalysed ? Number(((automaticallyResolved / totalEntitiesAnalysed) * 100).toFixed(2)) : 0, deterministic: byConfidence.DETERMINISTIC, highConfidence: byConfidence.HIGH_CONFIDENCE, probable: byConfidence.PROBABLE, ambiguous: byConfidence.AMBIGUOUS, conflicts: byConfidence.CONFLICT, noMatch: byConfidence.NO_MATCH, targetAuthoritative, archiveOnly, requiresHumanIntervention: exceptions.length },
      exceptions,
      candidateDiscovery,
      operatorSummary: { automaticallyResolved, protectedTargetData: targetAuthoritative, archived: archiveOnly, humanDecisions: exceptions.length, safeCandidates: candidateDiscovery.filter((candidate) => candidate.status === "SAFE_CANDIDATE").length },
      tool: { gitSha: gitSha() },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    closeStableSnapshot(source, "Source snapshot");
    closeStableSnapshot(targetSnapshot, "Target snapshot");
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const report = automatedReconcile(options);
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(`${options.output}.md`, operatorMarkdown(report), "utf8");
  console.log(`SOURCE: ${report.source.snapshot}`);
  console.log(`TARGET: ${report.target.environment}/${report.target.databaseName}`);
  console.log(`MODE: ${report.mode}`);
  console.log(`REPORT: ${options.output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
