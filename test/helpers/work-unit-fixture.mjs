import { scanProject } from '../../src/modules/repository/index.mjs';
import { scanProjectMemoryFacts } from '../../src/modules/memory/index.mjs';
import { sha256 } from '../../src/shared/index.mjs';
import { write } from './memory-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildMemoryArtifacts } from '../../src/modules/memory/index.mjs';
import { changedWorkUnitBehaviorPaths } from '../../src/modules/work-units/index.mjs';
import { runCompletion } from '../../src/modules/completion/index.mjs';

export function unitFixture(root, paths, { taskLevel = 'L2', reviewMode = 'quick-review' } = {}) {
  write(root, 'docs/feature.md', '# Feature requirements, implementation plan and acceptance tests\n');
  write(root, 'test/feature.test.mjs', '// Unit checks are supplied by the fixture verification command.\n');
  const cases = ['success', 'failure', 'abnormal', 'boundary', 'extreme', 'risk'].map((category) => ({ id: `case-${category}`, category, kind: 'unit', required: true, description: `${category} behavior`, testPath: 'test/feature.test.mjs' }));
  const facts = scanProjectMemoryFacts(scanProject(root));
  const entities = [...facts.apis, ...facts.methods].filter((entry) => paths.includes(entry.implementationPath ?? entry.path));
  return {
    schemaVersion: 1, id: 'feature', intent: 'Deliver one complete feature', taskLevel, reviewMode, status: 'memory-synced',
    requirements: { summary: 'Complete feature behavior', acceptanceCriteria: ['Success and failure are handled'] },
    design: taskLevel === 'L3' ? 'One feature across approved surfaces' : null,
    scope: [{ id: 'feature', paths }], risks: [], professionalBoundaries: [],
    roles: { selected: [], recommendations: [] }, plan: ['Implement the complete feature and its unit tests', 'Verify once and synchronize memory'],
    testCases: cases, coverage: entities.map((entry) => ({ entityId: entry.id, testCaseIds: ['case-success', 'case-failure'], gap: null })),
    qa: { additions: cases.slice(2).map((entry) => entry.id), applicability: cases.slice(2).map((entry) => ({ category: entry.category, status: 'applicable', reason: 'Feature input and risk checks apply' })), results: [] },
    verification: { command: 'npm run verify' },
    memory: { decision: 'update', reason: 'Synchronize changed module behavior', paths, updatedOwners: facts.modules.filter((module) => module.owns.some((relative) => paths.includes(relative))).map((module) => module.id) },
    references: [{ id: 'feature', path: 'docs/feature.md', sha256: sha256('# Feature requirements, implementation plan and acceptance tests\n') }],
    approvalPlanHash: '0'.repeat(64),
  };
}

export function qaMarkers(unit, changes = {}) {
  return unit.testCases.map((entry) => ({ schemaVersion: 1, workUnitId: unit.id, caseId: entry.id, status: changes[entry.id] ?? 'passed' }));
}

// Existing completion fixtures own their command and approvals. This helper
// supplies the new feature-level evidence without copying a unit per test.
export function prepareCompletionUnit(root, options = {}) {
  const paths = [...new Set([
    ['diff', '--cached', '--name-only', '--no-renames', 'HEAD'], ['diff', '--name-only', '--no-renames'], ['ls-files', '--others', '--exclude-standard'],
  ].flatMap((args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)))];
  const scan = scanProject(root);
  const changed = changedWorkUnitBehaviorPaths(root, scan, paths);
  if (!changed.length) return { options, finalize() {} };
  const preview = runCompletion(root, { ...options, verificationCommand: null });
  const pkg = fs.existsSync(path.join(root, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) : {};
  pkg.scripts ??= {};
  if (!Object.keys(pkg.scripts).length) pkg.scripts.verify = 'node --test test/aicg-qa.test.mjs';
  const command = options.verificationCommand === 'npm test' ? 'npm run test' : options.verificationCommand ?? `npm run ${pkg.scripts.test ? 'test' : pkg.scripts.verify ? 'verify' : Object.keys(pkg.scripts)[0]}`;
  const commandName = command.match(/^npm run ([A-Za-z0-9][A-Za-z0-9._:@/-]*)$/)?.[1];
  const unit = unitFixture(root, [...new Set([...changed, 'package.json'])], { taskLevel: options.taskLevel ?? preview.taskRoute.minimumLevel, reviewMode: options.reviewMode ?? preview.taskApproval.review.mode });
  unit.verification.command = command;
  write(root, 'test/aicg-qa.test.mjs', qaMarkers(unit).map((entry) => `console.log(${JSON.stringify(`AICG_QA_RESULT ${JSON.stringify(entry)}`)});`).join('\n'));
  if (commandName && typeof pkg.scripts[commandName] === 'string') {
    const body = pkg.scripts[commandName];
    if (/^node\s+--test(?:\s|$)/.test(body) && !body.includes('test/aicg-qa.test.mjs')) {
      pkg.scripts[commandName] = `${body} test/aicg-qa.test.mjs`;
    } else {
      const directNodeScript = body.match(/^node\s+([^\s;&|<>`]+)$/);
      if (directNodeScript) pkg.scripts[commandName] = `node --test ${directNodeScript[1]} test/aicg-qa.test.mjs`;
    }
  }
  write(root, 'package.json', JSON.stringify(pkg));
  // These fixture-owned files are configuration, static markup and an internal
  // verification client, not public APIs. Declare that exact reviewed inventory.
  const noPublicSurface = { 'package.json': 'Fixture npm command configuration has no public API or method.', 'index.html': 'Fixture static button markup has no exported API or method.', 'scripts/verify-http.test.mjs': 'Fixture HTTP verification client has no public exported method or server route.' };
  unit.manualCoverage = unit.scope[0].paths.filter((relative) => relative in noPublicSurface).map((relative) => ({ path: relative, sourceSha256: sha256(fs.readFileSync(path.join(root, relative))), evidenceLevel: 'operator-declared', reason: noPublicSurface[relative], referenceIds: ['feature'], noPublicSurface: true, entries: [] }));
  const current = scanProject(root), config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json')));
  const currentFacts = scanProjectMemoryFacts(current);
  unit.memory.updatedOwners = currentFacts.modules.filter((module) => module.owns.some((relative) => unit.memory.paths.includes(relative))).map((module) => module.id);
  const artifacts = buildMemoryArtifacts(config, current, currentFacts).artifacts;
  for (const artifact of artifacts) write(root, artifact.path, artifact.content);
  const relative = 'docs/ai/feature-work-unit.json';
  write(root, relative, JSON.stringify(unit));
  const enhanced = { ...options, taskLevel: unit.taskLevel, reviewMode: unit.reviewMode, workUnit: relative, verificationCommand: options.fromGitHook ? null : command };
  const stage = () => {
    const result = spawnSync('git', ['-C', root, 'add', relative, 'docs/feature.md', 'test/feature.test.mjs', 'test/aicg-qa.test.mjs', 'package.json', ...artifacts.map((entry) => entry.path)], { encoding: 'utf8' });
    if (result.status) throw new Error(result.stderr);
  };
  if (options.fromGitHook) {
    const recorded = runCompletion(root, { ...enhanced, fromGitHook: false, verificationCommand: command });
    if (!recorded.workUnit.recordedEvidence) throw new Error(JSON.stringify(recorded.workUnit));
    unit.verification.evidence = recorded.workUnit.recordedEvidence;
    unit.qa.results = recorded.workUnit.recordedResults;
    write(root, relative, JSON.stringify(unit)); stage();
  }
  return { options: enhanced, finalize(planHash) { unit.approvalPlanHash = planHash; write(root, relative, JSON.stringify(unit)); if (options.fromGitHook) stage(); } };
}
