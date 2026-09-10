import path from 'node:path';
import { checkProject, printCheck } from '../../checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from '../../constants.mjs';
import { buildArtifacts, validateConfig } from '../../generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { scanProject } from '../../scanner.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { assertManagedArchitectureConfigTrusted, normalizeClientSupport } from '../shared.mjs';

export async function syncCommand(target, options) {
  const scan = scanProject(target);
  const config = validateConfig({
    ...normalizeClientSupport(readJson(path.join(scan.root, CONFIG_PATH)), { source: 'legacy-config' }),
    toolVersion: TOOL_VERSION,
    invocationMode: readJson(path.join(scan.root, CONFIG_PATH)).invocationMode ?? 'npm-exec-pinned',
  });
  assertManagedArchitectureConfigTrusted(scan.root, config);
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
  const result = applyArtifactPlan(scan.root, plan, {
    dryRun: options['dry-run'],
    migrateLinks: options['migrate-links'],
    transactional: !options['dry-run'],
    verify: options['dry-run'] ? undefined : () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: Boolean(options['dry-run']), changed: result.changed }, null, 2));
  if (!options['dry-run']) {
    printCheck(result.verification, false);
    if (!result.verification.ok) process.exitCode = 1;
  }
}
