import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { memoryFixture, write, baseline } from './helpers/memory-fixture.mjs';
import { unitFixture, qaMarkers } from './helpers/work-unit-fixture.mjs';
import { defaultConfig, buildArtifacts } from '../src/generator.mjs';
import { planArtifacts, applyArtifactPlan } from '../src/managed-files.mjs';
import { scanProject } from '../src/modules/repository/index.mjs';
import { runCompletion } from '../src/modules/completion/index.mjs';
import { checkWorkUnit, planWorkUnit, workUnitPlanDigest, recordWorkUnitVerification, replayWorkUnitVerification } from '../src/modules/work-units/index.mjs';
import { readMemoryFile } from '../src/modules/memory/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

test('L2 completion requires a unit for C, configuration and unknown production syntax', (t) => {
  const root = memoryFixture(t), scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  baseline(root);
  for (const [relative, source] of [['src/service.c', 'int public_api(void) { return 1; }'], ['src/config.json', '{"enabled":true}'], ['src/service.unknown', 'public_api = true']]) {
    write(root, relative, source);
    const result = runCompletion(root, { taskLevel: 'L2' });
    assert.equal(result.workUnit.status, 'missing', relative);
    assert.equal(result.workUnit.ok, false, relative);
    fs.unlinkSync(path.join(root, relative));
  }
  write(root, 'docs/design.md', '# Docs only\n');
  write(root, 'test/only.test.mjs', '// Tests only\n');
  write(root, 'src/server/service.mjs', 'export function listWidgets( ) {\n return [];\n}\n');
  assert.equal(runCompletion(root, { taskLevel: 'L2' }).workUnit.status, 'not-required');
});

test('unknown, dynamic and exhausted coverage never silently passes with an empty inventory', (t) => {
  const root = memoryFixture(t);
  for (const [relative, source] of [['src/service.py', 'def public_api():\n    return 1\n'], ['src/dynamic.mjs', 'export function publicApi() { return fetch(endpoint); }'], ['src/service.unknown', 'public_api = true']]) {
    write(root, relative, source);
    const unit = unitFixture(root, [relative]);
    const result = checkWorkUnit(root, unit, { completion: false });
    assert.equal(result.ok, false, relative);
    assert.ok(result.issues.some((issue) => /coverage.*(unknown|unverified|incomplete)/i.test(issue)), JSON.stringify(result));
    assert.ok(planWorkUnit(root, unit).coverageGaps.some((gap) => gap.path === relative));
  }
  const unit = unitFixture(root, ['src/server/service.mjs']);
  const scan = scanProject(root); scan.scanBudget.complete = false;
  assert.equal(checkWorkUnit(root, unit, { completion: false, scan }).ok, false);
});

test('manual public-surface inventory binds current source, required unit cases and approval references', (t) => {
  const root = memoryFixture(t), relative = 'src/service.py', source = 'def public_api():\n    return 1\n';
  write(root, relative, source);
  const unit = unitFixture(root, [relative]);
  unit.manualCoverage = [{ path: relative, sourceSha256: sha256(source), evidenceLevel: 'operator-declared', reason: 'Reviewed the complete Python public surface.', referenceIds: ['feature'], noPublicSurface: false,
    entries: [{ kind: 'public-method', symbol: 'public_api', testCaseIds: ['case-success', 'case-failure'] }] }];
  const check = (value = unit) => checkWorkUnit(root, value, { completion: false });
  assert.equal(check().ok, true, JSON.stringify(check()));
  assert.equal(check().manualCoverage[0].evidenceLevel, 'operator-declared');
  const original = workUnitPlanDigest(unit);
  for (const mutate of [
    (value) => { value.manualCoverage[0].sourceSha256 = 'f'.repeat(64); },
    (value) => { value.manualCoverage[0].referenceIds = ['absent']; },
    (value) => { value.manualCoverage[0].entries[0].testCaseIds = ['absent']; },
    (value) => { value.manualCoverage[0].entries = []; },
    (value) => { value.manualCoverage[0].path = 'src/outside.py'; },
    (value) => { value.manualCoverage[0].entries.push(value.manualCoverage[0].entries[0]); },
    (value) => { value.testCases[0].required = false; },
    (value) => { value.references[0].sha256 = 'f'.repeat(64); },
  ]) { const changed = structuredClone(unit); mutate(changed); assert.equal(check(changed).ok, false); }
  unit.manualCoverage[0].reason += ' Updated review.';
  assert.notEqual(workUnitPlanDigest(unit), original);
  unit.manualCoverage[0].entries = []; unit.manualCoverage[0].noPublicSurface = true;
  assert.equal(check().ok, true, 'explicit source-bound no-public-surface is an operator declaration, not a scan claim');
  unit.testabilityGaps = [{ path: relative, reason: 'Required behavior cannot be tested yet.', sourceSha256: sha256(source), referenceIds: ['feature'] }];
  assert.equal(check().ok, false, 'an unresolved testability gap cannot be waived by an inventory');
  delete unit.testabilityGaps;
  write(root, relative, `${source}# changed\n`);
  assert.equal(check().ok, false);
});

test('manual no-public-surface cannot contradict known canonical public methods', (t) => {
  const root = memoryFixture(t), relative = 'src/server/service.mjs', unit = unitFixture(root, [relative]);
  unit.manualCoverage = [{ path: relative, sourceSha256: sha256(fs.readFileSync(path.join(root, relative))), evidenceLevel: 'operator-declared', reason: 'Incorrect empty inventory.', referenceIds: ['feature'], noPublicSurface: true, entries: [] }];
  assert.equal(checkWorkUnit(root, unit, { completion: false }).ok, false);
});

test('verification hashes binary inputs as raw bytes and retains bounds and link rejection', (t) => {
  const root = memoryFixture(t), unit = unitFixture(root, ['src/server/service.mjs']);
  const relative = 'public/logo.png';
  write(root, relative, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0, 1]));
  assert.throws(() => readMemoryFile(root, relative), /UTF-8/, 'Memory text reader remains strict');
  const verification = { command: unit.verification.command, status: 'passed', exitCode: 0, outputDigest: 'b'.repeat(64), qaResults: qaMarkers(unit) };
  unit.verification.evidence = recordWorkUnitVerification(root, scanProject(root), unit, verification);
  unit.qa.results = verification.qaResults;
  const replay = () => replayWorkUnitVerification(root, scanProject(root), unit);
  assert.equal(replay().status, 'passed');
  write(root, relative, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfe, 0, 1]));
  assert.equal(replay().status, 'recorded-evidence-invalid');
  unit.verification.evidence = recordWorkUnitVerification(root, scanProject(root), unit, verification);
  fs.chmodSync(path.join(root, relative), 0o755);
  assert.equal(replay().status, 'recorded-evidence-invalid');
  fs.unlinkSync(path.join(root, relative)); fs.symlinkSync('../package.json', path.join(root, relative));
  assert.equal(replay().status, 'recorded-evidence-invalid');
  fs.unlinkSync(path.join(root, relative)); write(root, relative, Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.equal(replay().status, 'recorded-evidence-invalid');
});
