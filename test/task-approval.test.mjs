import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as approval from '../src/modules/governance/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(context, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-approval-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'approved.md'), '# Owner-approved requirement and plan\n');
  const input = { taskLevel: 'L2', reviewMode: 'single', plannedPaths: ['src/widget.ts'], requiredApprovals: ['requirements', 'plan'], professionalBoundaries: [], ...overrides };
  const plan = approval.buildTaskApprovalPlan(input);
  const evidence = {
    schemaVersion: 1, planHash: plan.planHash, reviewEvidence: {}, professionalBoundaries: input.professionalBoundaries,
    approvals: plan.requiredApprovals.map((id) => ({ id, reference: 'approved.md', sha256: sha256(fs.readFileSync(path.join(root, 'approved.md'))), source: 'operator-declared', participantId: id })),
  };
  const save = () => fs.writeFileSync(path.join(root, 'approval.json'), JSON.stringify(evidence));
  save();
  const evaluate = (options = {}) => approval.evaluateTaskApproval(root, { ...input, approvalEvidence: 'approval.json', approve: plan.planHash, ...options });
  return { root, input, plan, evidence, save, evaluate };
}

test('approval plans have canonical SHA256 bindings and retain mandatory gates', () => {
  const input = { taskLevel: 'L2', reviewMode: 'single', plannedPaths: ['src/b.ts', 'src/a.ts'], requiredApprovals: [], professionalBoundaries: [] };
  const plan = approval.buildTaskApprovalPlan(input);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.requiredApprovals, ['plan', 'requirements']);
  assert.equal(plan.planHash, approval.buildTaskApprovalPlan({ ...input, plannedPaths: ['src/a.ts', 'src/b.ts', 'src/a.ts'] }).planHash);
  for (const changed of [{ taskLevel: 'L3' }, { reviewMode: 'quick-review' }, { plannedPaths: ['src/c.ts'] }, { requiredApprovals: ['external-action'] }]) {
    assert.notEqual(plan.planHash, approval.buildTaskApprovalPlan({ ...input, ...changed }).planHash);
  }
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, plannedPaths: ['../escape'] }), /path/);
});

test('approval gate requires current explicit approval and reference digests', (context) => {
  const f = fixture(context);
  assert.equal(f.evaluate().status, 'approved');
  assert.equal(f.evaluate().evidenceLevel, 'operator-declared');
  assert.equal(f.evaluate({ approve: null }).status, 'approval-required');
  assert.equal(f.evaluate({ approvalEvidence: null }).status, 'missing-evidence');
  assert.equal(f.evaluate({ plannedPaths: ['src/new.ts'] }).status, 'stale-plan');
  f.evidence.approvals.pop(); f.save();
  assert.equal(f.evaluate().status, 'missing-approval');
  f.evidence.approvals[0].sha256 = '0'.repeat(64); f.save();
  assert.equal(f.evaluate().status, 'invalid-evidence');
});

test('approval evidence fails closed on unsafe malformed oversized or copied bodies', (context) => {
  const f = fixture(context);
  for (const relative of ['../approval.json', '/tmp/approval.json', '.git/config', 'missing.json']) {
    assert.equal(f.evaluate({ approvalEvidence: relative }).status, 'invalid-evidence');
  }
  for (const text of ['{', JSON.stringify({ ...f.evidence, requirements: 'copied requirement body' }), ' '.repeat(65537)]) {
    fs.writeFileSync(path.join(f.root, 'approval.json'), text);
    assert.equal(f.evaluate().status, 'invalid-evidence');
  }
  f.save();
  fs.symlinkSync('approval.json', path.join(f.root, 'linked.json'));
  assert.equal(f.evaluate({ approvalEvidence: 'linked.json' }).status, 'invalid-evidence');
  fs.mkdirSync(path.join(f.root, 'real'));
  fs.symlinkSync('real', path.join(f.root, 'linked-dir'));
  assert.equal(f.evaluate({ approvalEvidence: 'linked-dir/approval.json' }).status, 'invalid-evidence');
  fs.unlinkSync(path.join(f.root, 'approved.md'));
  fs.symlinkSync('approval.json', path.join(f.root, 'approved.md'));
  assert.equal(f.evaluate().status, 'invalid-evidence');
});

test('PK approval records require distinct declared participants, never verified identity', (context) => {
  const f = fixture(context, { reviewMode: 'independent-pk' });
  assert.equal(f.evaluate().status, 'approved');
  assert.equal(f.evaluate().review.mode, 'independent-pk');
  assert.equal(f.evaluate().review.requiredRoleCount, 3);
  assert.equal(f.evaluate().identityVerified, false);
  const proposal = f.evidence.approvals.find((item) => item.id === 'proposal-2');
  proposal.participantId = 'proposal-1'; f.save();
  assert.equal(f.evaluate().status, 'independence-gap');
});

test('caller-confirmed professional boundaries and external authority cannot be weakened by evidence', (context) => {
  const f = fixture(context);
  const boundary = { id: 'legal', humanReviewRequired: true, qualification: 'licensed-lawyer', jurisdiction: 'JP', decisionAuthority: 'human-only', reason: 'Owner-confirmed requirement' };
  assert.equal(f.evaluate({ professionalBoundaries: [boundary] }).status, 'review-upgrade-required');
  const external = f.evaluate({ reviewMode: 'high-consequence-pk', reviewEvidence: { externalAction: true } });
  assert.ok(external.plan.requiredApprovals.includes('external-action'));
  const risk = f.evaluate({ reviewMode: 'high-consequence-pk', reviewEvidence: { professionalRisk: 'contract-law' } });
  assert.ok(risk.review.triggers.some((trigger) => trigger.id === 'professionalRisk'));
});

test('professional boundaries cannot be removed by single review or AI approvals', (context) => {
  const boundary = { id: 'legal', humanReviewRequired: true, qualification: 'licensed-lawyer', jurisdiction: 'JP', decisionAuthority: 'human-only', reason: 'Confirmed contract-law risk' };
  const f = fixture(context, { reviewMode: 'high-consequence-pk', professionalBoundaries: [boundary] });
  assert.equal(f.evaluate().status, 'professional-review-gap');
  const record = f.evidence.approvals.find((item) => item.id === 'human:legal');
  Object.assign(record, { qualification: 'licensed-lawyer', jurisdiction: 'JP', responsibleHuman: 'Owner-declared reviewer' }); f.save();
  assert.equal(f.evaluate().status, 'approved');
  assert.equal(f.evaluate().identityVerified, false);
  assert.equal(f.evaluate({ reviewMode: 'single' }).status, 'review-upgrade-required');
  record.jurisdiction = 'open-gap'; f.save();
  assert.equal(f.evaluate().status, 'professional-review-gap');
});
