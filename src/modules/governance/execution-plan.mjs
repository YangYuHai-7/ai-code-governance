import path from 'node:path';
import fs from 'node:fs';
import { CONFIG_PATH, MANIFEST_PATH, TOOL_VERSION } from '../../constants.mjs';
import { assertNoLinkAncestor, repositoryFingerprint, sameSnapshot, snapshotPath } from '../../preconditions.mjs';
import { buildDecisionLedger, classifyProject, scanInputFingerprint, scanProject } from '../repository/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { walkFilesDetailed } from '../../adapters/filesystem/index.mjs';

function executionFingerprint(root, intent, scan = null) {
  if (intent !== 'governance.prune') return scanInputFingerprint(scan ?? scanProject(root));
  // Bind root and directory state as well as files, but exclude volatile Git metadata.
  const snapshot = walkFilesDetailed(root, { maxDepth: Infinity, ignored: ['.git'], includeDirectories: true });
  if (!snapshot.budget.complete) throw usageError('Cannot completely scan repository inputs for pruning.');
  const entries = [...snapshot.directories, ...snapshot.files].map((entry) => ({ path: entry.relative, snapshot: snapshotPath(entry.absolute) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableJson({ root: fs.realpathSync(root), entries }));
}

function operationAction(operation, before) {
  if (!operation.changed) return 'keep';
  if (operation.remove) {
    if (operation.migration) return 'migrate';
    return operation.deleteWhenEmpty ? 'remove-owned' : 'update-managed-block';
  }
  if (before.kind === 'missing') return 'create';
  return ['managed-block', 'gitignore-block'].includes(operation.ownership) ? 'update-managed-block' : 'replace-owned';
}

function actionOperation(root, operation) {
  const relative = normalizeRelative(operation.path);
  const before = snapshotPath(path.join(root, relative));
  const desired = typeof operation.desired === 'string' ? operation.desired : null;
  return {
    action: operationAction(operation, before),
    path: relative,
    ownership: operation.ownership ?? null,
    kind: operation.kind ?? null,
    source: operation.source ?? null,
    classification: operation.classification ?? null,
    candidateAction: operation.action ?? null,
    newPath: operation.migration?.to ?? null,
    recordedSha256: operation.sha256 ?? null,
    references: operation.referenced === true,
    ...(operation.migration ? { migration: operation.migration } : {}),
    candidate: operation.candidate === true,
    before,
    afterSha256: operation.remove && operation.deleteWhenEmpty ? null : (desired === null ? null : sha256(desired)),
  };
}

function manifestOperation(root, artifactPlan) {
  const before = snapshotPath(path.join(root, MANIFEST_PATH));
  const changed = artifactPlan.manifest.changed;
  return {
    action: changed ? (before.kind === 'missing' ? 'create' : 'replace-owned') : 'keep',
    path: MANIFEST_PATH,
    ownership: 'full',
    kind: 'manifest',
    source: 'aicg',
    before,
    afterSha256: sha256(artifactPlan.manifest.content),
  };
}

function executionOperations(root, artifactPlan) {
  if (!artifactPlan) return [];
  return [
    ...artifactPlan.operations.map((operation) => actionOperation(root, operation)),
    manifestOperation(root, artifactPlan),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function planDigest(value) {
  return sha256(stableJson(value));
}

export function buildExecutionPlan({ intent, scan, artifactPlan = null, config = null }) {
  const root = scan.root;
  const operations = executionOperations(root, artifactPlan);
  const linksToMigrate = artifactPlan
    ? artifactPlan.links.map((link) => ({ path: normalizeRelative(path.relative(root, link)), before: snapshotPath(link) })).sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const mutableOperations = operations.filter((operation) => operation.action !== 'keep');
  const requiredPermissions = [];
  if (mutableOperations.length > 0) requiredPermissions.push('write-governance');
  if (linksToMigrate.length > 0) requiredPermissions.push('migrate-links');

  const base = {
    schemaVersion: 1,
    intent: intent.id,
    handler: intent.handler,
    mode: intent.mode,
    targetRoot: root,
    toolVersion: TOOL_VERSION,
    configSha256: config ? sha256(stableJson(config)) : null,
    configFile: snapshotPath(path.join(root, CONFIG_PATH)),
    manifestFile: snapshotPath(path.join(root, MANIFEST_PATH)),
    repositoryFingerprint: executionFingerprint(root, intent.id, scan),
    projectAssessment: classifyProject(scan),
    decisionLedger: buildDecisionLedger(scan, config),
    operations,
    candidates: artifactPlan?.candidates ?? [],
    conflicts: artifactPlan?.conflicts ?? [],
    manualCleanupCandidates: artifactPlan?.manualCleanupCandidates ?? [],
    linksToMigrate,
    requiredPermissions,
    ...(artifactPlan?.adaptiveGovernance ? { adaptiveGovernance: artifactPlan.adaptiveGovernance, contextCost: artifactPlan.contextCost } : {}),
    verification: intent.mode === 'write' ? 'governance.validate' : intent.id,
    unverifiedBoundaries: intent.mode === 'write'
      ? ['A structural check does not prove real agent loading or project behavior.']
      : [],
  };
  return { ...base, planHash: planDigest(base) };
}

export function assertPlanFresh(plan) {
  if (!plan || plan.schemaVersion !== 1 || typeof plan.targetRoot !== 'string' || typeof plan.planHash !== 'string') {
    throw usageError('Execution plan has an invalid schema.');
  }
  const root = plan.targetRoot;
  try {
    if (executionFingerprint(root, plan.intent) !== plan.repositoryFingerprint) {
      throw usageError('Execution plan is stale because repository inputs changed; generate a new plan.');
    }
  } catch (error) {
    if (error.code === 'AICG_USAGE') throw error;
    throw usageError(`Execution plan target root changed; generate a new plan. (${error.message})`);
  }
  for (const operation of plan.operations ?? []) {
    if (operation.candidate === true && operation.remove !== true) continue;
    try {
      assertNoLinkAncestor(root, operation.path);
    } catch (error) {
      throw usageError(`Execution plan is stale because ${error.message}; generate a new plan.`);
    }
    const actual = snapshotPath(path.join(root, operation.path));
    if (!sameSnapshot(actual, operation.before)) {
      throw usageError(`Execution plan is stale because ${operation.path} changed; generate a new plan.`);
    }
  }
  for (const link of plan.linksToMigrate ?? []) {
    const actual = snapshotPath(path.join(root, link.path));
    if (!sameSnapshot(actual, link.before)) {
      throw usageError(`Execution plan is stale because link ${link.path} changed; generate a new plan.`);
    }
  }
  if (!sameSnapshot(snapshotPath(path.join(root, CONFIG_PATH)), plan.configFile)) {
    throw usageError('Execution plan is stale because the governance config changed; generate a new plan.');
  }
  if (!sameSnapshot(snapshotPath(path.join(root, MANIFEST_PATH)), plan.manifestFile)) {
    throw usageError('Execution plan is stale because the governance manifest changed; generate a new plan.');
  }
  const { planHash, ...base } = plan;
  if (planHash !== planDigest(base)) throw usageError('Execution plan digest is invalid.');
  return true;
}

export function assertArtifactPlanMatches(plan, root, artifactPlan) {
  const operations = executionOperations(root, artifactPlan);
  const linksToMigrate = artifactPlan.links
    .map((link) => ({ path: normalizeRelative(path.relative(root, link)), before: snapshotPath(link) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (stableJson(operations) !== stableJson(plan.operations) || stableJson(linksToMigrate) !== stableJson(plan.linksToMigrate)) {
    throw usageError('Execution plan no longer matches the approved artifact plan; generate a new plan.');
  }
  if (stableJson(artifactPlan.conflicts) !== stableJson(plan.conflicts)) {
    throw usageError('Execution plan conflicts changed; generate a new plan.');
  }
  return true;
}
