import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, MANAGED_END, MANAGED_START, MANIFEST_PATH, MANIFEST_SCHEMA_VERSION } from './constants.mjs';
import { buildArtifacts, validateConfig } from './generator.mjs';
import { capabilityEvidenceIssues } from './capability-harvest.mjs';
import { extractManagedBlock, loadManifest, renderManagedBlock } from './managed-files.mjs';
import { isSafeRelative, readJson, readText, sha256 } from './utils.mjs';

function linkInPath(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return path.relative(root, current).replaceAll('\\', '/');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  return null;
}

export function checkProject(scan) {
  const errors = [];
  const warnings = [];
  let config;
  let manifest;

  try {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  } catch (error) {
    errors.push(`${CONFIG_PATH}: ${error.message}`);
  }
  try {
    manifest = loadManifest(scan.root);
    if (!manifest) errors.push(`${MANIFEST_PATH}: missing manifest`);
    else if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push(`${MANIFEST_PATH}: unsupported schemaVersion`);
  } catch (error) {
    errors.push(error.message);
  }

  if (config && manifest) {
    let expected = [];
    try {
      expected = buildArtifacts(config, scan);
    } catch (error) {
      errors.push(`Cannot resolve expected artifacts: ${error.message}`);
    }
    const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
    if (!Array.isArray(manifest.files)) errors.push(`${MANIFEST_PATH}: files must be an array`);
    const managedExpected = expected.filter((artifact) => artifact.ownership !== 'seed');
    const seedExpected = expected.filter((artifact) => artifact.ownership === 'seed');
    const expectedPaths = new Set(managedExpected.map((artifact) => artifact.path));
    const manifestPaths = new Set(manifestFiles.filter((entry) => entry && typeof entry.path === 'string').map((entry) => entry.path));
    for (const relative of expectedPaths) {
      if (!manifestPaths.has(relative)) errors.push(`${MANIFEST_PATH}: missing managed entry for ${relative}`);
    }
    for (const artifact of seedExpected) {
      const link = linkInPath(scan.root, artifact.path);
      if (link) errors.push(`${artifact.path}: canonical path traverses link ${link}`);
      else {
        try {
          if (!fs.statSync(path.join(scan.root, artifact.path)).isFile()) errors.push(`${artifact.path}: canonical seed is not a regular file`);
        } catch (error) {
          errors.push(`${artifact.path}: ${error.code === 'ENOENT' ? 'missing canonical file' : error.message}`);
        }
      }
    }
    for (const artifact of managedExpected) {
      const entry = manifestFiles.find((candidate) => candidate?.path === artifact.path);
      if (!entry) continue;
      const expectedHash = artifact.ownership === 'managed-block' ? sha256(renderManagedBlock(artifact.content)) : sha256(artifact.content);
      if (entry.sha256 !== expectedHash) errors.push(`${artifact.path}: manifest source is stale; run aicg sync .`);
    }
    for (const entry of manifestFiles) {
      if (!entry || typeof entry.path !== 'string') {
        errors.push(`${MANIFEST_PATH}: every managed entry must contain a string path`);
        continue;
      }
      if (!['full', 'managed-block'].includes(entry.ownership)) {
        errors.push(`${entry.path}: manifest contains unsupported ownership ${entry.ownership}`);
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
        errors.push(`${entry.path}: manifest contains an invalid SHA-256`);
        continue;
      }
      if (!isSafeRelative(entry.path)) {
        errors.push(`${entry.path}: manifest path is not a safe repository-relative path`);
        continue;
      }
      const link = linkInPath(scan.root, entry.path);
      if (link) {
        errors.push(`${entry.path}: managed path traverses link ${link}`);
        continue;
      }
      const absolute = path.join(scan.root, entry.path);
      let content;
      try {
        content = readText(absolute);
      } catch (error) {
        errors.push(`${entry.path}: ${error.code === 'ENOENT' ? 'missing managed file' : error.message}`);
        continue;
      }
      try {
        const actual = entry.ownership === 'managed-block' ? sha256(extractManagedBlock(content) ?? '') : sha256(content);
        if (actual !== entry.sha256) errors.push(`${entry.path}: managed content drifted; run aicg sync .`);
      } catch (error) {
        errors.push(`${entry.path}: ${error.message}`);
      }
    }
    for (const relative of manifestPaths) {
      if (!expectedPaths.has(relative)) warnings.push(`${relative}: managed by an earlier configuration and no longer selected`);
    }

    const agentsContent = readText(path.join(scan.root, 'AGENTS.md'), '');
    if (!agentsContent.includes(MANAGED_START) || !agentsContent.includes(MANAGED_END)) {
      errors.push('AGENTS.md: shared managed entrypoint is not reachable');
    }
    if (config.clients.includes('claude-code')) {
      const claude = readText(path.join(scan.root, 'CLAUDE.md'), '');
      if (!claude.includes('@AGENTS.md')) errors.push('CLAUDE.md: native @AGENTS.md import is missing');
    }
    if (config.clients.includes('cursor') && !manifestPaths.has('.cursor/rules/ai-code-governance.mdc')) {
      errors.push('.cursor/rules/ai-code-governance.mdc: selected Cursor adapter is missing');
    }

    const reviewItems = config.capabilityEvolution?.lastHarvest?.reviewItems ?? [];
    for (const issue of capabilityEvidenceIssues(scan, config.projectCapabilities ?? [])) {
      const reviewed = reviewItems.some((item) => item.id === issue.id && item.status === 'required' && item.code === issue.code && item.observedFingerprint === issue.observedFingerprint);
      if (reviewed) warnings.push(`capability ${issue.id}: ${issue.reason}; owner review is required before promotion or reuse enforcement`);
      else errors.push(`capability ${issue.id}: ${issue.reason}; run aicg harvest . and record the required review`);
    }
    for (const item of reviewItems) {
      warnings.push(`capability ${item.id}: ${item.reason} Owner ${item.owner} review is due ${item.dueDate}.`);
    }
  }

  const pass = errors.length === 0;
  return {
    ok: pass,
    errors,
    warnings,
    evidence: {
      present: pass ? 'pass' : 'fail',
      reachable: pass ? 'pass' : 'fail',
      enforced: pass ? 'pass' : 'fail',
      realClientVerified: 'unverified',
    },
    boundaries: [
      'aicg check proves structure, ownership, hashes, and configured entrypoint reachability.',
      'Real agent loading, project behavior, hooks, and operating-system execution require separate replay evidence.',
    ],
  };
}

export function printCheck(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`governance_check=${result.ok ? 'pass' : 'fail'}`);
  console.log(`present=${result.evidence.present} reachable=${result.evidence.reachable} enforced=${result.evidence.enforced} real-client-verified=${result.evidence.realClientVerified}`);
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  for (const error of result.errors) console.error(`FAIL: ${error}`);
  for (const boundary of result.boundaries) console.log(`BOUNDARY: ${boundary}`);
}
