import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  dynamicTeamPlan,
  loadAicgProductTeamRegistry,
  validateAicgProductTeamRegistry,
} from '../src/dynamic-team.mjs';
import { loadTeamRoleRegistry } from '../src/team-recommendation.mjs';

const cli = path.resolve('bin/aicg.js');

function approvedSpecialist() {
  return {
    id: 'healthcare-interoperability-specialist',
    title: 'Healthcare Interoperability Specialist',
    phase: 'dynamic',
    responsibilities: [
      'Own healthcare interoperability constraints and evidence for the requested integration.',
    ],
    outOfScope: [
      'Approving product scope or claiming regulatory compliance.',
    ],
    capabilities: ['healthcare-interoperability'],
    requiredCompanionRoleIds: [],
    mustRemainIndependentFrom: [],
    approval: {
      status: 'approved',
      approvedBy: 'product-owner',
      evidence: 'Approved by the Product Owner in decision AICG-TEAM-001.',
    },
  };
}

function proposedSpecialist() {
  const role = approvedSpecialist();
  delete role.approval;
  return role;
}

function snapshot(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .map((entry) => {
      const absolute = path.join(root, entry.name);
      return entry.isFile()
        ? { name: entry.name, hash: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') }
        : { name: entry.name, type: entry.isDirectory() ? 'directory' : 'other' };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

test('the AICG roster records every approved member while activating nobody without a requirement', () => {
  const registry = loadAicgProductTeamRegistry();
  assert.equal(registry.roles.length, 16);
  assert.deepEqual(new Set(registry.roles.map((role) => role.id)), new Set([
    'product-owner',
    'project-manager',
    'principal-governance-architect',
    'cli-cross-platform-engineer',
    'agent-integration-engineer',
    'applied-ai-knowledge-engineer',
    'adversarial-evaluation-release-engineer',
    'developer-experience-solutions-engineer',
    'product-security-engineer',
    'product-designer',
    'full-stack-control-plane-engineer',
    'platform-sre',
    'enterprise-security-compliance-lead',
    'developer-relations',
    'sales-customer-success',
    'technology-stack-certification-specialist',
  ]));
  for (const role of registry.roles) {
    assert.ok(role.responsibilities.length > 0, `${role.id} must record responsibilities`);
    assert.ok(role.outOfScope.length > 0, `${role.id} must record a responsibility boundary`);
  }
  const plan = dynamicTeamPlan();
  assert.equal(plan.status, 'no-requirement-provided');
  assert.equal(plan.availableRoles.length, 16);
  assert.deepEqual(plan.assignment.activeRoles, []);
  assert.equal(plan.assignment.inactiveRoleIds.length, 16);
});

test('the internal Project Manager coordinates delivery with an independent reviewer but cannot own acceptance or risk decisions', () => {
  const plan = dynamicTeamPlan({ requiredCapabilities: [
    'delivery-coordination',
    'evidence-traceability',
    'risk-register-management',
  ] });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.assignment.activeRoles.map((role) => role.id), [
    'adversarial-evaluation-release-engineer',
    'project-manager',
  ]);
  const projectManager = plan.assignment.activeRoles.find((role) => role.id === 'project-manager');
  assert.deepEqual(projectManager.matchedCapabilities, [
    'delivery-coordination',
    'evidence-traceability',
    'risk-register-management',
  ]);
  assert.ok(plan.assignment.requiredSeparations.some((entry) => entry.roles.join(':') === 'adversarial-evaluation-release-engineer:project-manager'));
  assert.ok(!projectManager.capabilities.some((capability) => [
    'product-strategy-decision',
    'release-acceptance',
    'scope-and-risk-approval',
  ].includes(capability)));

  const customerRegistry = loadTeamRoleRegistry();
  assert.ok(!customerRegistry.roles.some((role) => role.id === 'project-manager'), 'the internal AICG role must not leak into customer-project recommendations');
});

test('the product-team registry rejects a Project Manager that can approve scope, risk, or release', () => {
  for (const forbiddenCapability of ['product-strategy-decision', 'release-acceptance', 'scope-and-risk-approval']) {
    const registry = structuredClone(loadAicgProductTeamRegistry());
    const projectManager = registry.roles.find((role) => role.id === 'project-manager');
    projectManager.capabilities = [...projectManager.capabilities, forbiddenCapability];
    const existingOwner = registry.roles.find((role) => role.id !== 'project-manager' && role.capabilities.includes(forbiddenCapability));
    existingOwner.capabilities = existingOwner.capabilities.filter((capability) => capability !== forbiddenCapability);
    assert.throws(
      () => validateAicgProductTeamRegistry(registry),
      /Project Manager.*must not own/i,
    );
  }
});

test('a requirement activates only its minimum owner and mandatory independent reviewer', () => {
  const plan = dynamicTeamPlan({ requiredCapabilities: ['cli-implementation'] });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.assignment.activeRoles.map((role) => role.id), [
    'adversarial-evaluation-release-engineer',
    'cli-cross-platform-engineer',
  ]);
  assert.deepEqual(plan.assignment.activeRoles.find((role) => role.id === 'cli-cross-platform-engineer').matchedCapabilities, ['cli-implementation']);
  assert.ok(plan.assignment.requiredSeparations.some((entry) => entry.roles.join(':') === 'adversarial-evaluation-release-engineer:cli-cross-platform-engineer'));
  assert.equal(plan.assignment.inactiveRoleIds.length, 14);
});

test('a missing capability remains inactive until a proposed role receives explicit Product Owner approval', () => {
  const proposed = dynamicTeamPlan({
    requiredCapabilities: ['healthcare-interoperability'],
    proposedAdditionalRoles: [proposedSpecialist()],
  });
  assert.equal(proposed.status, 'needs-role-approval');
  assert.deepEqual(proposed.assignment.activeRoles, []);
  assert.ok(!proposed.availableRoles.some((role) => role.id === 'healthcare-interoperability-specialist'));
  assert.equal(proposed.roleProposals[0].status, 'needs-product-owner-approval');
  assert.match(proposed.nextAction, /Do not add, activate, or persist/);

  const approved = dynamicTeamPlan({
    requiredCapabilities: ['healthcare-interoperability'],
    approvedAdditionalRoles: [approvedSpecialist()],
  });
  assert.equal(approved.status, 'ready');
  assert.deepEqual(approved.assignment.activeRoles.map((role) => role.id), ['healthcare-interoperability-specialist']);
  const dynamicRole = approved.availableRoles.find((role) => role.id === 'healthcare-interoperability-specialist');
  assert.equal(dynamicRole.source, 'project-approved-extension');
  assert.deepEqual(dynamicRole.approval, {
    status: 'approved',
    approvedBy: 'product-owner',
    evidence: 'provided-not-returned',
  });
  assert.doesNotMatch(JSON.stringify(approved), /AICG-TEAM-001/);
});

test('role approval cannot be inferred, forged by omission, or overlap an existing capability', () => {
  const missingApproval = approvedSpecialist();
  delete missingApproval.approval;
  assert.throws(
    () => dynamicTeamPlan({ requiredCapabilities: ['healthcare-interoperability'], approvedAdditionalRoles: [missingApproval] }),
    /explicit product-owner approval evidence/,
  );

  const duplicateCapability = approvedSpecialist();
  duplicateCapability.capabilities = ['cli-implementation'];
  assert.throws(
    () => dynamicTeamPlan({ requiredCapabilities: ['cli-implementation'], approvedAdditionalRoles: [duplicateCapability] }),
    /more than one role/,
  );

  const unknown = dynamicTeamPlan({ requiredCapabilities: ['quantum-runtime-certification'] });
  assert.equal(unknown.status, 'needs-role-approval');
  assert.equal(unknown.roleProposals[0].status, 'needs-role-proposal');
  assert.equal(unknown.roleProposals[0].id, null);
});

test('the CLI exposes the dynamic team plan without modifying the repository', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-dynamic-team-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(root, 'team-context.json'), JSON.stringify({
    teamScope: 'human',
    businessDescription: 'A local governance CLI product.',
    confirmedSignals: [],
    requiredCapabilities: ['chat-intent-routing'],
  }));
  const before = snapshot(root);
  const result = spawnSync(process.execPath, [cli, 'team', root, '--config', 'team-context.json', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(root), before);
  const output = JSON.parse(result.stdout);
  assert.equal(output.productTeam.status, 'ready');
  assert.deepEqual(output.productTeam.assignment.activeRoles.map((role) => role.id), [
    'adversarial-evaluation-release-engineer',
    'agent-integration-engineer',
  ]);
  assert.equal(output.productTeam.actionsPerformed.length, 0);

  const rosterOnly = spawnSync(process.execPath, [cli, 'team', root, '--json'], { encoding: 'utf8' });
  assert.equal(rosterOnly.status, 0, rosterOnly.stderr);
  const rosterOutput = JSON.parse(rosterOnly.stdout);
  assert.equal(rosterOutput.status, 'needs-user-input');
  assert.equal(rosterOutput.productTeam.status, 'no-requirement-provided');
  assert.equal(rosterOutput.productTeam.availableRoles.length, 16);
  assert.deepEqual(rosterOutput.productTeam.assignment.activeRoles, []);
  assert.deepEqual(snapshot(root), before);
});

test('the registry rejects missing roles and the planner has no process, network, or write primitive', () => {
  const missing = structuredClone(loadAicgProductTeamRegistry());
  missing.roles = missing.roles.filter((role) => role.id !== 'product-designer');
  assert.throws(() => validateAicgProductTeamRegistry(missing), /missing required role/);
  const source = fs.readFileSync(path.resolve('src/dynamic-team.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawnSync|execSync|writeFileSync|writeText|https?:\/\//);
});
