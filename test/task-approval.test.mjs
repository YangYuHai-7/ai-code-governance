import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as approval from '../src/modules/governance/index.mjs';
import { buildApprovedProjectAgentTeam, proposeProjectAgentTeam } from '../src/project-agent-team.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(context, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-approval-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'approved.md'), '# Owner-approved requirement and plan\n');
  const input = { taskLevel: 'L2', reviewMode: 'quick-review', plannedPaths: ['src/widget.ts'], changeDigest: '1'.repeat(64), requiredApprovals: ['requirements', 'plan'], professionalBoundaries: [], ...overrides };
  let plan = approval.buildTaskApprovalPlan(input);
  const evidence = {
    schemaVersion: 1, planHash: plan.planHash, reviewEvidence: {}, professionalBoundaries: input.professionalBoundaries,
    approvals: plan.requiredApprovals.map((id) => {
      const reference = /^(proposal-|referee)/.test(id) ? `${id}.md` : 'approved.md';
      if (reference !== 'approved.md') fs.writeFileSync(path.join(root, reference), `# Independent ${id} findings\n`);
      return { id, reference, sha256: sha256(fs.readFileSync(path.join(root, reference))), source: 'operator-declared', participantId: id };
    }),
  };
  const save = () => fs.writeFileSync(path.join(root, 'approval.json'), JSON.stringify(evidence));
  save();
  const evaluate = (options = {}) => approval.evaluateTaskApproval(root, { ...input, approvalEvidence: 'approval.json', approve: plan.planHash, ...options });
  const reapprove = () => { save(); plan = evaluate().plan; evidence.planHash = plan.planHash; save(); };
  reapprove();
  return { root, input, plan, evidence, save, reapprove, evaluate };
}

test('approval plans have canonical SHA256 bindings and retain mandatory gates', () => {
  const input = { taskLevel: 'L2', reviewMode: 'single', plannedPaths: ['src/b.ts', 'src/a.ts'], changeDigest: '1'.repeat(64), requiredApprovals: [], professionalBoundaries: [] };
  const plan = approval.buildTaskApprovalPlan(input);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.requiredApprovals, ['plan', 'requirements']);
  assert.equal(plan.planHash, approval.buildTaskApprovalPlan({ ...input, plannedPaths: ['src/a.ts', 'src/b.ts', 'src/a.ts'] }).planHash);
  for (const changed of [{ taskLevel: 'L3' }, { reviewMode: 'quick-review' }, { plannedPaths: ['src/c.ts'] }, { requiredApprovals: ['external-action'] }]) {
    assert.notEqual(plan.planHash, approval.buildTaskApprovalPlan({ ...input, ...changed }).planHash);
  }
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, plannedPaths: ['../escape'] }), /path/);
});

test('normalized approval receipts bind reference replacements even outside the change digest', (context) => {
  const f = fixture(context, { reviewMode: 'quick-review' });
  const first = f.evaluate().plan.planHash;
  fs.writeFileSync(path.join(f.root, 'approved.md'), '# Replaced requirements and test cases\n');
  for (const record of f.evidence.approvals) record.sha256 = sha256(fs.readFileSync(path.join(f.root, record.reference)));
  f.save();
  assert.notEqual(f.evaluate().plan.planHash, first);
  assert.equal(f.evaluate().status, 'stale-plan');
  const second = f.evaluate().plan.planHash;
  f.evidence.approvals.reverse(); f.save();
  assert.equal(f.evaluate().plan.planHash, second, 'receipt ordering is not semantic');
});

test('approval plans bind content digests and reject impossible approval counts before normalization', () => {
  const input = { taskLevel: 'L2', reviewMode: 'single', plannedPaths: ['src/widget.ts'], changeDigest: '1'.repeat(64) };
  const first = approval.buildTaskApprovalPlan(input);
  assert.notEqual(first.planHash, approval.buildTaskApprovalPlan({ ...input, changeDigest: '2'.repeat(64) }).planHash);
  assert.notEqual(first.planHash, approval.buildTaskApprovalPlan({ ...input, confirmedRiskSignals: ['authorization'] }).planHash);
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, changeDigest: undefined }), /changeDigest/);
  const oversized = Array(65).fill('plan');
  Object.defineProperty(oversized, 0, { get() { throw new Error('normalized-before-limit'); } });
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, requiredApprovals: oversized }), /64/);
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, requiredApprovals: Array.from({ length: 64 }, (_, i) => `custom-${i}`) }), /64/);
  const boundary = { humanReviewRequired: true, qualification: 'licensed-lawyer', jurisdiction: 'JP', decisionAuthority: 'human-only', reason: 'Confirmed risk' };
  assert.throws(() => approval.buildTaskApprovalPlan({ ...input, professionalBoundaries: [boundary] }), /IDs/);
});

test('a reference file over 1 MiB fails closed even with its correct declared digest', (context) => {
  const f = fixture(context);
  const oversized = Buffer.alloc(1024 * 1024 + 1, 'a');
  fs.writeFileSync(path.join(f.root, 'approved.md'), oversized);
  for (const record of f.evidence.approvals) record.sha256 = sha256(oversized);
  f.save();
  assert.equal(f.evaluate().status, 'invalid-evidence');
});

test('distinct PK participant labels cannot reuse proposal or referee artifacts', (context) => {
  const f = fixture(context, { reviewMode: 'independent-pk' });
  const first = f.evidence.approvals.find((item) => item.id === 'proposal-1');
  const second = f.evidence.approvals.find((item) => item.id === 'proposal-2');
  Object.assign(second, { reference: first.reference, sha256: first.sha256 }); f.reapprove();
  assert.equal(f.evaluate().status, 'independence-gap');
  second.reference = 'copied.md';
  fs.copyFileSync(path.join(f.root, first.reference), path.join(f.root, second.reference)); f.reapprove();
  assert.equal(f.evaluate().status, 'independence-gap');
});

test('managed professional roster cannot use unsafe unapproved malformed or drifted evidence', (context) => {
  const f = fixture(context);
  const relative = 'docs/ai/agent-team.json';
  fs.mkdirSync(path.join(f.root, 'docs/ai'), { recursive: true });
  fs.mkdirSync(path.join(f.root, '.ai-governance'));
  const team = buildApprovedProjectAgentTeam(proposeProjectAgentTeam({ projectMode: 'greenfield', evidence: [{ id: 'owner.domain', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Legal scope', evidenceIds: ['owner.domain'], jurisdiction: 'JP' }],
    roleNeeds: [{ id: 'legal', title: 'Legal review', capabilities: ['legal-review'], responsibilities: ['Review risks.'], outOfScope: ['Final advice.'], domainNeedIds: ['contract-law'], evidenceIds: ['owner.domain'], skillIds: [], mustRemainIndependentFrom: [] }],
  }), { selectedIds: ['legal'], approvalEvidenceId: 'decision.legal', activation: { legal: { signals: ['authorization'], paths: ['src/**'] } } });
  const roster = { ...team, roles: team.roleProposals };
  const writeRoster = (value) => {
    fs.writeFileSync(path.join(f.root, relative), typeof value === 'string' ? value : JSON.stringify(value));
    fs.writeFileSync(path.join(f.root, '.ai-governance/manifest.json'), JSON.stringify({ schemaVersion: 1, generatedBy: 'AI Code Governance', files: [{ path: relative, ownership: 'full', sha256: sha256(fs.readFileSync(path.join(f.root, relative))) }] }));
  };
  const evaluate = () => approval.trustedProfessionalTaskContext(f.root, { confirmedRiskSignals: ['authorization'] }, ['src/widget.ts']);
  writeRoster(roster);
  assert.equal(evaluate().professionalBoundaries[0].qualification, 'licensed-lawyer');
  for (const value of ['{', ' '.repeat(65537), { ...roster, teamType: 'human-delivery-and-governance' }, { ...roster, roles: [{ ...roster.roles[0], status: 'recommended' }] }]) {
    writeRoster(value);
    assert.ok(evaluate().professionalGap);
  }
  writeRoster(roster);
  fs.appendFileSync(path.join(f.root, relative), ' ');
  assert.ok(evaluate().professionalGap);
  fs.unlinkSync(path.join(f.root, relative));
  fs.symlinkSync(path.join(f.root, 'approved.md'), path.join(f.root, relative));
  assert.ok(evaluate().professionalGap);
});

test('approval gate requires current explicit approval and reference digests', (context) => {
  const f = fixture(context);
  assert.equal(f.evaluate().status, 'approved');
  assert.equal(f.evaluate().evidenceLevel, 'operator-declared');
  assert.equal(f.evaluate({ approve: null }).status, 'approval-required');
  assert.equal(f.evaluate({ approvalEvidence: null }).status, 'missing-evidence');
  assert.equal(f.evaluate({ plannedPaths: ['src/new.ts'] }).status, 'stale-plan');
  f.evidence.approvals.pop(); f.reapprove();
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
  proposal.participantId = 'proposal-1'; f.reapprove();
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
  Object.assign(record, { qualification: 'licensed-lawyer', jurisdiction: 'JP', responsibleHuman: 'Owner-declared reviewer' }); f.reapprove();
  assert.equal(f.evaluate().status, 'approved');
  assert.equal(f.evaluate().identityVerified, false);
  assert.equal(f.evaluate({ reviewMode: 'single' }).status, 'review-upgrade-required');
  record.jurisdiction = 'open-gap'; f.reapprove();
  assert.equal(f.evaluate().status, 'professional-review-gap');
});
