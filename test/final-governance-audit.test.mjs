import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, buildArtifacts } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/modules/repository/index.mjs';
import { runCompletion } from '../src/modules/completion/index.mjs';
import { buildMemoryArtifacts, memoryIssues, readMemoryFile, scanProjectMemoryFacts } from '../src/modules/memory/index.mjs';
import { checkWorkUnit } from '../src/modules/work-units/index.mjs';
import { buildProjectConventionArtifacts, projectConventionIssues } from '../src/modules/standards/index.mjs';
import { adaptiveDecisionEvidenceHash } from '../src/modules/skills/index.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { baseline, memoryFixture, write } from './helpers/memory-fixture.mjs';
import { unitFixture } from './helpers/work-unit-fixture.mjs';

function writeArtifacts(root, artifacts) {
  for (const artifact of artifacts) write(root, artifact.path, artifact.content);
}

test('final audit: trusted formatting-only production changes use L1 and single review', (t) => {
  const root = memoryFixture(t);
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  baseline(root);
  write(root, 'src/server/service.mjs', 'export function listWidgets( ) {\n  return [];\n}\n');

  const result = runCompletion(root, { taskLevel: 'L1', reviewMode: 'single' });
  assert.equal(result.taskRoute.minimumLevel, 'L1');
  assert.equal(result.taskRoute.status, 'verified');
  assert.equal(result.taskApproval.review.minimumMode, 'single');
  assert.equal(result.taskApproval.ok, true, JSON.stringify(result.taskApproval));
  assert.equal(result.workUnit.status, 'not-required');
});

test('final audit: all stable exported callable forms receive canonical coverage without treating constants as callable', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/server/callables.mjs', [
    'export const arrow = () => 1;',
    'export const expression = function () { return 2; };',
    'export const ordinary = 3;',
    'export default () => 4;',
    'export class Handler { field = () => 5; }',
    '',
  ].join('\n'));
  const facts = scanProjectMemoryFacts(scanProject(root));
  const callables = facts.methods.filter((entry) => entry.path === 'src/server/callables.mjs');
  assert.deepEqual(new Set(callables.map((entry) => entry.exportedAs)), new Set(['arrow', 'expression', 'default', 'Handler', 'Handler.field']));
  assert.equal(callables.some((entry) => entry.symbol === 'ordinary' || entry.exportedAs === 'ordinary'), false);
  assert.equal(new Set(callables.map((entry) => entry.id)).size, callables.length);
});

test('final audit: unknown production formats receive raw Memory ownership, gaps and add/modify freshness', (t) => {
  const root = memoryFixture(t);
  const samples = [
    ['src/native/service.c', Buffer.from('int public_api(void) { return 1; }\n')],
    ['src/config/runtime.json', Buffer.from('{"enabled":true}\n')],
    ['src/engine/service.unknown', Buffer.from([0x00, 0xff, 0x01, 0x7f])],
  ];
  for (const [relative, bytes] of samples) write(root, relative, bytes);
  let scan = scanProject(root);
  const facts = scanProjectMemoryFacts(scan);
  for (const [relative, bytes] of samples) {
    assert.ok(facts.modules.some((entry) => entry.owns.includes(relative)), `missing owner for ${relative}`);
    assert.equal(facts.sources.find((entry) => entry.path === relative)?.sha256, sha256(bytes));
    assert.ok(facts.gaps.some((entry) => entry.path === relative), `missing semantic gap for ${relative}`);
  }
  writeArtifacts(root, buildMemoryArtifacts(defaultConfig(scan), scan, facts).artifacts);
  baseline(root);

  write(root, 'src/native/service.c', 'int public_api(void) { return 2; }\n');
  scan = { ...scanProject(root), memoryGitRoot: root };
  assert.ok(memoryIssues(root, scan, ['src/native/service.c']).some((issue) => /stale owning code/.test(issue)));

  write(root, 'src/new.production', Buffer.from([0xff, 0x00, 0x02]));
  scan = { ...scanProject(root), memoryGitRoot: root };
  assert.ok(memoryIssues(root, scan, ['src/new.production']).some((issue) => /unowned behavior/.test(issue)));
});

test('final audit: deleted and renamed production sources use exact HEAD tombstones and required deletion-impact cases', (t) => {
  const deletedRoot = memoryFixture(t);
  const deletedPath = 'src/legacy/service.unknown';
  const deletedBytes = Buffer.from('public_api = true\n');
  write(deletedRoot, deletedPath, deletedBytes);
  baseline(deletedRoot);
  fs.unlinkSync(path.join(deletedRoot, deletedPath));
  const deletedUnit = unitFixture(deletedRoot, [deletedPath]);
  deletedUnit.manualCoverage = [{
    path: deletedPath,
    sourceSha256: sha256(deletedBytes),
    evidenceLevel: 'operator-declared',
    reason: 'HEAD tombstone inventory for deleted production behavior.',
    referenceIds: ['feature'],
    noPublicSurface: false,
    entries: [{ kind: 'public-method', symbol: 'public_api', testCaseIds: ['case-success', 'case-failure'] }],
  }];
  const deleted = checkWorkUnit(deletedRoot, deletedUnit, {
    completion: false,
    scan: { ...scanProject(deletedRoot), memoryGitRoot: deletedRoot },
    behaviorPaths: [deletedPath],
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));

  const renamedRoot = memoryFixture(t);
  const oldPath = 'src/legacy/renamed.unknown';
  const newPath = 'src/current/renamed.unknown';
  const bytes = Buffer.from('public_api = true\n');
  write(renamedRoot, oldPath, bytes);
  baseline(renamedRoot);
  fs.mkdirSync(path.dirname(path.join(renamedRoot, newPath)), { recursive: true });
  fs.renameSync(path.join(renamedRoot, oldPath), path.join(renamedRoot, newPath));
  const renamedUnit = unitFixture(renamedRoot, [oldPath, newPath]);
  const inventory = (relative) => ({
    path: relative,
    sourceSha256: sha256(bytes),
    evidenceLevel: 'operator-declared',
    reason: relative === oldPath ? 'HEAD tombstone inventory for renamed source.' : 'Current inventory for renamed source.',
    referenceIds: ['feature'],
    noPublicSurface: false,
    entries: [{ kind: 'public-method', symbol: 'public_api', testCaseIds: ['case-success', 'case-failure'] }],
  });
  renamedUnit.manualCoverage = [inventory(oldPath), inventory(newPath)];
  const renamed = checkWorkUnit(renamedRoot, renamedUnit, {
    completion: false,
    scan: { ...scanProject(renamedRoot), memoryGitRoot: renamedRoot },
    behaviorPaths: [oldPath, newPath],
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));

  const missingCases = structuredClone(deletedUnit);
  missingCases.manualCoverage[0].entries = [];
  missingCases.manualCoverage[0].noPublicSurface = true;
  assert.equal(checkWorkUnit(deletedRoot, missingCases, {
    completion: false,
    scan: { ...scanProject(deletedRoot), memoryGitRoot: deletedRoot },
    behaviorPaths: [deletedPath],
  }).ok, false);
});

test('final audit: Memory reader rejects ancestor replacement and path identity replacement during reads', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-final-reader-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-final-reader-outside-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  write(root, 'safe/evidence.txt', 'inside\n');
  write(outside, 'evidence.txt', 'outside\n');
  const target = fs.realpathSync(path.join(root, 'safe/evidence.txt'));
  const safe = path.join(root, 'safe');
  const moved = path.join(root, 'safe-original');
  const originalLstat = fs.lstatSync;
  let targetStats = 0;
  fs.lstatSync = function patchedLstat(value, ...args) {
    if (typeof value === 'string' && path.resolve(value) === target && ++targetStats === 2) {
      fs.renameSync(safe, moved);
      fs.symlinkSync(outside, safe, 'dir');
    }
    return originalLstat.call(this, value, ...args);
  };
  try {
    assert.throws(() => readMemoryFile(root, 'safe/evidence.txt'), /symbolic link|changed/i);
  } finally {
    fs.lstatSync = originalLstat;
    if (fs.existsSync(moved)) {
      fs.rmSync(safe, { recursive: true, force: true });
      fs.renameSync(moved, safe);
    }
  }

  write(root, 'safe/replacement.txt', 'first!\n');
  write(root, 'safe/replacement-next.txt', 'second\n');
  const replacementTarget = path.join(root, 'safe/replacement.txt');
  const replacementNext = path.join(root, 'safe/replacement-next.txt');
  const originalRead = fs.readSync;
  let swapped = false;
  fs.readSync = function patchedRead(fd, buffer, offset, length, position) {
    const count = originalRead.call(this, fd, buffer, offset, length, position);
    if (!swapped) {
      swapped = true;
      fs.unlinkSync(replacementTarget);
      fs.renameSync(replacementNext, replacementTarget);
    }
    return count;
  };
  try {
    assert.throws(() => readMemoryFile(root, 'safe/replacement.txt'), /changed/i);
  } finally {
    fs.readSync = originalRead;
  }
});

test('final audit: fresh Standard stays within 20 files while historical placeholders are retained', (t) => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-final-standard-fresh-'));
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-final-standard-existing-'));
  t.after(() => { fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(existing, { recursive: true, force: true }); });
  const freshScan = scanProject(fresh);
  const artifacts = buildArtifacts({ ...defaultConfig(freshScan), clients: ['codex'], governanceDepth: 'standard' }, freshScan);
  assert.ok(artifacts.length + 1 <= 20, `fresh Standard including manifest: ${artifacts.length + 1}`);
  assert.equal(artifacts.some((entry) => /^(?:reviews|reports)\/\.gitkeep$/.test(entry.path)), false);

  write(existing, 'reviews/.gitkeep', '# historical review placeholder\n');
  write(existing, 'reports/.gitkeep', '# historical report placeholder\n');
  const existingScan = scanProject(existing);
  applyArtifactPlan(existing, planArtifacts(existing, buildArtifacts({ ...defaultConfig(existingScan), clients: ['codex'], governanceDepth: 'standard' }, existingScan)));
  assert.equal(fs.readFileSync(path.join(existing, 'reviews/.gitkeep'), 'utf8'), '# historical review placeholder\n');
  assert.equal(fs.readFileSync(path.join(existing, 'reports/.gitkeep'), 'utf8'), '# historical report placeholder\n');
});

test('final audit: convention seed points to the canonical receipt and warns that embedded legacy decisions are non-authoritative', (t) => {
  const root = memoryFixture(t);
  const scan = scanProject(root);
  const memory = scanProjectMemoryFacts(scan);
  const candidate = buildProjectConventionArtifacts(defaultConfig(scan), scan, memory).candidates[0];
  const config = {
    ...defaultConfig(scan),
    adaptiveDecisions: { skills: [{ id: candidate.id, action: 'add', evidenceHash: adaptiveDecisionEvidenceHash(candidate) }], roles: [] },
  };
  const generated = buildProjectConventionArtifacts(config, scan, memory).artifacts.find((entry) => entry.path === candidate.skill);
  assert.doesNotMatch(generated.content, /Current decision|当前决策|\bdecision:\s*(?:add|defer|reject)\b/i);
  assert.match(generated.content, /adaptiveDecisions\.skills/);

  write(root, 'docs/ai/project-conventions.json', JSON.stringify({ schemaVersion: 1, candidates: [candidate], gaps: [] }));
  write(root, candidate.skill, `${generated.content}\nCurrent decision: defer\n`);
  assert.ok(projectConventionIssues(root).some((entry) => entry.status === 'warning' && /non-authoritative/i.test(entry.reason)));
});
