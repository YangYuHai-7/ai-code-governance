import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendTaskRoles } from '../src/modules/governance/task-role-routing.mjs';

const roles = [
  { id: 'frontend-engineer', status: 'approved-available', approval: { source: 'user', evidenceId: 'approval-1' }, capabilities: ['frontend-engineering'] },
  { id: 'business-analyst', membershipStatus: 'approved-available', capabilities: ['business-analysis'] },
  { id: 'backend-engineer', status: 'recommended', capabilities: ['backend-engineering'] },
  { id: 'legal-specialist', status: 'approved-available', capabilities: ['legal-analysis'] },
];

test('a frontend bug recommends only an approved available frontend role', () => {
  const result = recommendTaskRoles({
    taskText: 'Fix the button layout bug',
    changedPaths: ['apps/web/src/components/Button.vue'],
    route: { level: 'L1', reasonCodes: ['mutation:product-behavior'] },
    availableRoles: roles,
  });
  assert.equal(result.routeEvidence.effectiveLevel, 'L2');
  assert.deepEqual(result.recommendedRoles, [{ roleId: 'frontend-engineer', categories: ['frontend'], status: 'recommended-not-activated' }]);
  assert.deepEqual(result.humanReviewRequirements, []);
  assert.deepEqual(result.actionsPerformed, []);
});

test('contract business analysis requests a BA and qualified human legal review', () => {
  const result = recommendTaskRoles({
    taskText: '分析合同业务需求与条款',
    route: { level: 'L2' },
    availableRoles: roles,
  });
  assert.deepEqual(result.recommendedRoles, [{ roleId: 'business-analyst', categories: ['businessAnalysis'], status: 'recommended-not-activated' }]);
  assert.deepEqual(result.humanReviewRequirements, [{
    domain: 'contract-law', qualification: 'licensed-lawyer', status: 'required-unassigned',
    decisionAuthority: 'qualified-human-only', jurisdiction: 'must-be-confirmed',
  }]);
  assert.equal(result.recommendedRoles.some((role) => role.roleId === 'legal-specialist'), false);
  assert.equal(result.status, 'human-review-required');
});

test('API contracts do not imply legal review and unapproved roles stay gaps', () => {
  const result = recommendTaskRoles({
    taskText: 'Update the API contract',
    changedPaths: ['backend/api/contracts/order.yaml'],
    route: { level: 'L2' },
    availableRoles: roles,
  });
  assert.deepEqual(result.humanReviewRequirements, []);
  assert.deepEqual(result.recommendedRoles, []);
  assert.deepEqual(result.missingRoleCapabilities, [{ category: 'backend', status: 'approval-or-availability-required' }]);
  assert.equal(result.status, 'role-gap');
});

test('a project role status without owner approval evidence is not selectable', () => {
  const result = recommendTaskRoles({
    taskText: 'Fix frontend bug',
    route: { level: 'L1' },
    availableRoles: [{ id: 'frontend-engineer', status: 'approved-available', capabilities: ['frontend-engineering'] }],
  });
  assert.deepEqual(result.recommendedRoles, []);
  assert.deepEqual(result.missingRoleCapabilities, [{ category: 'frontend', status: 'approval-or-availability-required' }]);
});

test('text-only questions do not create a team without relevant evidence', () => {
  const result = recommendTaskRoles({ taskText: 'Explain the current status', route: { level: 'L0' }, availableRoles: roles });
  assert.deepEqual(result.recommendedRoles, []);
  assert.deepEqual(result.signals, []);
  assert.equal(result.routeEvidence.effectiveLevel, 'L0');
});

test('invalid route, paths and role catalogs fail closed', () => {
  const base = { taskText: 'Fix frontend bug', route: { level: 'L1' }, availableRoles: roles };
  for (const input of [
    { ...base, route: { level: 'L9' } },
    { ...base, changedPaths: ['../outside.tsx'] },
    { ...base, availableRoles: [...roles, roles[0]] },
  ]) {
    assert.throws(() => recommendTaskRoles(input), (error) => error.code === 'AICG_USAGE');
  }
});
