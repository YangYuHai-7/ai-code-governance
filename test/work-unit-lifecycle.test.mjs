import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { memoryFixture, write } from './helpers/memory-fixture.mjs';
import { unitFixture, qaMarkers } from './helpers/work-unit-fixture.mjs';
import { parseArgs } from '../src/cli/args.mjs';
import { scanProject } from '../src/modules/repository/index.mjs';
import { sha256, stableJson } from '../src/shared/index.mjs';

async function api() { return import('../src/modules/work-units/index.mjs'); }
function evidence(unit) { return { taskApproval: { ok: true, plan: { planHash: unit.approvalPlanHash } }, memory: { issues: [], status: 'checked' }, verification: { status: 'passed', command: unit.verification.command, outputDigest: 'b'.repeat(64), inputEvidence: { status: 'unchanged', beforeFingerprint: 'c'.repeat(64), afterFingerprint: 'c'.repeat(64) }, qaResults: qaMarkers(unit) } }; }

test('work-unit plan and status accept a safe evidence input without mutation actions', () => {
  assert.equal(parseArgs(['work-unit', 'plan', '.', '--work-unit', 'docs/unit.json', '--json']).action, 'plan');
  assert.equal(parseArgs(['complete', '--work-unit', 'docs/unit.json']).options['work-unit'], 'docs/unit.json');
  assert.throws(() => parseArgs(['work-unit', 'apply']), /plan|status/);
});

test('one unit validates canonical coverage, QA categories and unchanged verification evidence', async (t) => {
  const root = memoryFixture(t), { checkWorkUnit, planWorkUnit } = await api();
  const paths = ['src/server/routes.mjs', 'src/server/service.mjs'];
  const unit = unitFixture(root, paths);
  const planned = planWorkUnit(root, unit);
  assert.equal(planned.workUnit.id, 'feature');
  assert.equal(planned.workUnit.scope.length, 1);
  assert.ok(planned.roles.recommendations.length >= 2);
  assert.equal(planned.actionsPerformed.length, 0);
  assert.equal(checkWorkUnit(root, unit, { ...evidence(unit), changedPaths: paths }).ok, true);
  for (const mutate of [
    (value) => value.coverage.pop(),
    (value) => { value.coverage[0].gap = 'Cannot test'; },
    (value) => { value.coverage[0].testCaseIds = ['missing']; },
    (value) => { value.qa.applicability.pop(); },
    (value) => { value.qa.additions = []; },
    (value) => { value.references[0].sha256 = 'f'.repeat(64); },
    (value) => { value.status = 'implementing'; },
    (value) => { value.scope[0].paths = []; },
    (value) => { value.testCases[0].testPath = 'src/server/service.mjs'; },
    (value) => { value.professionalBoundaries = [{ id: 'medical', humanReviewRequired: false }]; },
  ]) {
    const altered = structuredClone(unit); mutate(altered);
    assert.equal(checkWorkUnit(root, altered, { ...evidence(altered), changedPaths: paths }).ok, false);
  }
  for (const status of ['failed', 'blocked']) {
    const ev = evidence(unit); ev.verification.qaResults[0].status = status;
    assert.equal(checkWorkUnit(root, unit, { ...ev, changedPaths: paths }).ok, false);
  }
  for (const mutate of [
    (value) => value.verification.qaResults.pop(),
    (value) => value.verification.qaResults.push(value.verification.qaResults[0]),
    (value) => { value.verification.qaResults[0].caseId = 'invented'; },
    (value) => { value.verification.inputEvidence.status = 'unverified'; },
    (value) => { value.memory.issues = ['memory stale owning code']; },
    (value) => { value.taskApproval.ok = false; },
    (value) => { value.verification.qaResults[0] = null; },
  ]) {
    const ev = evidence(unit); mutate(ev);
    assert.equal(checkWorkUnit(root, unit, { ...ev, changedPaths: paths }).ok, false);
  }
});

test('work-unit reader rejects unsafe paths, symlinks, oversized and unknown fields', async (t) => {
  const root = memoryFixture(t), { readWorkUnit } = await api();
  const unit = unitFixture(root, ['src/server/service.mjs']);
  write(root, 'docs/unit.json', JSON.stringify(unit));
  assert.equal(readWorkUnit(root, 'docs/unit.json').id, 'feature');
  for (const relative of ['../unit.json', '/unit.json', '.git/config']) assert.throws(() => readWorkUnit(root, relative));
  fs.symlinkSync(path.join(root, 'docs/unit.json'), path.join(root, 'docs/link.json'));
  assert.throws(() => readWorkUnit(root, 'docs/link.json'));
  write(root, 'docs/unit.json', JSON.stringify({ ...unit, tasks: [] }));
  assert.throws(() => readWorkUnit(root, 'docs/unit.json'));
  write(root, 'docs/unit.json', ' '.repeat(262145));
  assert.throws(() => readWorkUnit(root, 'docs/unit.json'));
});

test('no-memory-impact cannot waive changed behavior and reference mutations invalidate plan binding', async (t) => {
  const root = memoryFixture(t), { checkWorkUnit, workUnitPlanDigest } = await api();
  const unit = unitFixture(root, ['src/server/service.mjs']);
  const before = workUnitPlanDigest(unit);
  unit.approvalPlanHash = 'd'.repeat(64);
  unit.status = 'verified';
  assert.equal(workUnitPlanDigest(unit), before);
  unit.requirements.summary = 'Different approved scope';
  assert.notEqual(workUnitPlanDigest(unit), before);
  unit.memory.decision = 'no-memory-impact';
  unit.memory.reason = 'Operator says no effect';
  assert.equal(checkWorkUnit(root, unit, { ...evidence(unit), changedPaths: unit.scope[0].paths, behaviorPaths: unit.scope[0].paths }).ok, false);
});

test('recorded verification replays only exact current inputs, command, approved plan and case evidence', async (t) => {
  const root = memoryFixture(t), { recordWorkUnitVerification, replayWorkUnitVerification, checkWorkUnit, parseWorkUnitResults, planWorkUnit } = await api();
  const unit = unitFixture(root, ['src/server/service.mjs']);
  const verification = { ...evidence(unit).verification, exitCode: 0 };
  unit.verification.evidence = recordWorkUnitVerification(root, scanProject(root), unit, verification);
  unit.qa.results = verification.qaResults;
  const replay = () => replayWorkUnitVerification(root, scanProject(root), unit);
  assert.equal(replay().status, 'passed');
  assert.equal(replay().evidenceLevel, 'operator-declared');
  assert.equal(planWorkUnit(root, { taskLevel: 'L0' }).workUnit, null);
  assert.equal(planWorkUnit(root, { taskLevel: 'L1' }).status, 'lightweight-receipt');
  unit.qa.results[0].status = 'failed';
  assert.equal(replay().status, 'recorded-evidence-invalid');
  // Even recomputing declared digests cannot waive required failed case status.
  unit.verification.evidence.resultsDigest = sha256(stableJson(unit.qa.results));
  const { evidenceDigest, ...body } = unit.verification.evidence;
  unit.verification.evidence.evidenceDigest = sha256(stableJson(body));
  assert.equal(checkWorkUnit(root, unit, { ...evidence(unit), changedPaths: unit.scope[0].paths, verification: replay() }).ok, false);
  unit.qa.results = verification.qaResults = qaMarkers(unit);
  unit.verification.evidence = recordWorkUnitVerification(root, scanProject(root), unit, verification);
  fs.chmodSync(path.join(root, 'test/feature.test.mjs'), 0o755);
  assert.equal(replay().status, 'recorded-evidence-invalid');
  fs.chmodSync(path.join(root, 'test/feature.test.mjs'), 0o644);
  fs.symlinkSync('feature.test.mjs', path.join(root, 'test/link.mjs'));
  assert.equal(replay().status, 'recorded-evidence-invalid');
  fs.unlinkSync(path.join(root, 'test/link.mjs'));
  write(root, 'test/new-check.mjs', '// Additional verification input\n');
  assert.equal(replay().status, 'recorded-evidence-invalid');
  assert.ok(parseWorkUnitResults('AICG_QA_RESULT {broken').error);
});
