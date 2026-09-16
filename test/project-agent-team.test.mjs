import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  proposeProjectAgentTeam,
  validateProfessionalDomainBoundaryPolicy,
} from '../src/project-agent-team.mjs';
import { teamRecommendation } from '../src/team-recommendation.mjs';

const root = path.resolve('.');
const humanContext = {
  teamScope: 'human',
  businessDescription: 'A bounded project delivery context.',
  confirmedSignals: [],
};

const professionalBoundaryPolicyPath = path.resolve('assets/policies/professional-domain-boundaries.json');

function genericRole(id, capability, overrides = {}) {
  return {
    id,
    title: `${id} title`,
    capabilities: [capability],
    responsibilities: [`Deliver ${capability}.`],
    outOfScope: [`Do not approve ${capability}.`],
    domainNeedIds: [],
    evidenceIds: ['decision.architecture'],
    skillIds: [],
    mustRemainIndependentFrom: [],
    ...overrides,
  };
}

function genericInput(overrides = {}) {
  return {
    projectMode: 'greenfield',
    evidence: [{ id: 'decision.architecture', kind: 'user-confirmed-project' }],
    confirmedDomainNeeds: [],
    roleNeeds: [genericRole('technical-architect', 'technical-architecture')],
    ...overrides,
  };
}

test('project roles are dynamic, evidence-bound, professionally bounded, and isolated from other teams', () => {
  const contract = proposeProjectAgentTeam({
    projectMode: 'greenfield',
    evidence: [{ id: 'decision.contracts', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Contract law', evidenceIds: ['decision.contracts'], jurisdiction: 'JP' }],
    roleNeeds: [{
      id: 'contract-legal-domain-reviewer',
      title: 'Contract legal domain reviewer',
      capabilities: ['contract-clause-risk-review'],
      responsibilities: ['Identify contract issues for qualified human review.'],
      outOfScope: ['Final legal advice or contract approval.'],
      domainNeedIds: ['contract-law'],
      evidenceIds: ['decision.contracts'],
      skillIds: [],
      mustRemainIndependentFrom: [],
    }],
  });
  assert.equal(contract.roleProposals[0].professionalBoundary.qualification, 'licensed-lawyer');
  assert.equal(contract.roleProposals[0].professionalBoundary.humanReviewRequired, true);

  const restaurantSite = proposeProjectAgentTeam({
    projectMode: 'greenfield',
    evidence: [{ id: 'decision.restaurant-site', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'restaurant-operations', label: 'Restaurant operations', evidenceIds: ['decision.restaurant-site'] }],
    roleNeeds: [],
  });
  assert.equal(JSON.stringify(restaurantSite).includes('food-safety'), false);

  const humanAdvice = teamRecommendation(root, humanContext);
  assert.equal(Object.hasOwn(humanAdvice, 'productTeam'), false);
  assert.equal(humanAdvice.teamType, 'human-delivery-and-governance');
});

test('generic project roles require explicit user-confirmed project evidence rather than repository evidence', () => {
  const generic = proposeProjectAgentTeam(genericInput());
  assert.deepEqual(generic.roleProposals.map((role) => role.id), ['technical-architect']);
  assert.equal(Object.hasOwn(generic.roleProposals[0], 'professionalBoundaries'), false);

  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      evidence: [{ id: 'repository.architecture', kind: 'repository-fact' }],
      roleNeeds: [genericRole('technical-architect', 'technical-architecture', { evidenceIds: ['repository.architecture'] })],
    })),
    /user-confirmed-project evidence/,
  );
});

test('a multi-domain role retains every professional boundary without a misleading single boundary', () => {
  const result = proposeProjectAgentTeam({
    projectMode: 'greenfield',
    evidence: [
      { id: 'decision.contracts', kind: 'user-confirmed-domain' },
      { id: 'decision.kitchen-controls', kind: 'user-confirmed-domain' },
    ],
    confirmedDomainNeeds: [
      { id: 'food-safety', label: 'Food safety', evidenceIds: ['decision.kitchen-controls'], jurisdiction: 'JP' },
      { id: 'contract-law', label: 'Contract law', evidenceIds: ['decision.contracts'], jurisdiction: 'JP' },
    ],
    roleNeeds: [{
      id: 'regulated-operations-reviewer',
      title: 'Regulated operations reviewer',
      capabilities: ['regulated-operations-risk-review'],
      responsibilities: ['Identify regulated operations issues for qualified human review.'],
      outOfScope: ['Final legal advice or food safety approval.'],
      domainNeedIds: ['food-safety', 'contract-law'],
      evidenceIds: ['decision.kitchen-controls', 'decision.contracts'],
      skillIds: [],
      mustRemainIndependentFrom: [],
    }],
  });
  const role = result.roleProposals[0];
  assert.equal(Object.hasOwn(role, 'professionalBoundary'), false);
  assert.deepEqual(role.professionalBoundaries.map((boundary) => boundary.qualification), [
    'licensed-lawyer',
    'qualified-food-safety-professional',
  ]);
  assert.deepEqual(result.gaps.filter((gap) => gap.kind === 'qualified-human-review-required').map((gap) => gap.qualification), [
    'licensed-lawyer',
    'qualified-food-safety-professional',
  ]);
});

test('professional policy rules are mandatory and cannot be omitted or disabled', () => {
  const policy = JSON.parse(fs.readFileSync(professionalBoundaryPolicyPath, 'utf8'));
  assert.equal(validateProfessionalDomainBoundaryPolicy(policy).size, 4);

  const missingFoodSafety = structuredClone(policy);
  missingFoodSafety.boundaries = missingFoodSafety.boundaries.filter((boundary) => boundary.domainNeedId !== 'food-safety');
  assert.throws(() => validateProfessionalDomainBoundaryPolicy(missingFoodSafety), /missing required domain rule: food-safety/);

  const disabledContractLaw = structuredClone(policy);
  disabledContractLaw.boundaries.find((boundary) => boundary.domainNeedId === 'contract-law').humanReviewRequired = false;
  assert.throws(() => validateProfessionalDomainBoundaryPolicy(disabledContractLaw), /must retain required human review/);
});

test('proposal inputs fail closed at collection limits before normalization and remain stably sorted', () => {
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      evidence: Array.from({ length: 33 }, (_, index) => ({ id: `decision-${index}`, kind: 'user-confirmed-project' })),
      roleNeeds: [],
    })),
    /evidence must contain at most 32 entries/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      confirmedDomainNeeds: Array.from({ length: 17 }, (_, index) => ({
        id: `domain-${index}`,
        label: `Domain ${index}`,
        evidenceIds: ['decision.architecture'],
      })),
      roleNeeds: [],
    })),
    /confirmedDomainNeeds must contain at most 16 entries/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      approvedRoles: Array.from({ length: 33 }, (_, index) => ({ id: `approved-${index}`, capabilities: [`approved-capability-${index}`] })),
      roleNeeds: [],
    })),
    /approvedRoles must contain at most 32 entries/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      roleNeeds: Array.from({ length: 6 }, (_, index) => genericRole(`role-${index}`, `capability-${index}`, index === 5 ? { title: '' } : {})),
    })),
    /roleNeeds exceeds the maximum of 5 recommendations/,
  );

  const ordered = proposeProjectAgentTeam(genericInput({
    roleNeeds: [
      genericRole('zeta-reviewer', 'zeta-review', { skillIds: ['zeta-skill', 'alpha-skill'] }),
      genericRole('alpha-reviewer', 'alpha-review', { skillIds: ['zeta-skill-two', 'alpha-skill-two'] }),
    ],
  }));
  assert.deepEqual(ordered.roleProposals.map((role) => role.id), ['alpha-reviewer', 'zeta-reviewer']);
  assert.deepEqual(ordered.roleProposals[1].skillIds, ['alpha-skill', 'zeta-skill']);
});

test('proposal validation rejects duplicate ownership, unconfirmed domain evidence, and invalid independence', () => {
  const domainInput = {
    projectMode: 'greenfield',
    evidence: [
      { id: 'decision.contracts', kind: 'user-confirmed-domain' },
      { id: 'decision.scope', kind: 'user-confirmed-project' },
    ],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Contract law', evidenceIds: ['decision.contracts'], jurisdiction: 'JP' }],
    roleNeeds: [{
      id: 'contract-reviewer',
      title: 'Contract reviewer',
      capabilities: ['contract-risk-review'],
      responsibilities: ['Identify contract risks for qualified human review.'],
      outOfScope: ['Final legal advice.'],
      domainNeedIds: ['contract-law'],
      evidenceIds: ['decision.contracts'],
      skillIds: [],
      mustRemainIndependentFrom: [],
    }],
  };
  assert.throws(
    () => proposeProjectAgentTeam({
      ...domainInput,
      roleNeeds: [...domainInput.roleNeeds, { ...domainInput.roleNeeds[0], id: 'duplicate-contract-reviewer' }],
    }),
    /capability contract-risk-review more than once/,
  );
  assert.throws(
    () => proposeProjectAgentTeam({
      ...domainInput,
      roleNeeds: [{ ...domainInput.roleNeeds[0], evidenceIds: ['decision.scope'] }],
    }),
    /user-confirmed-domain evidence/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      approvedRoles: [{ id: 'approved-architect', capabilities: ['technical-architecture'] }],
    })),
    /capability technical-architecture more than once/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      roleNeeds: [genericRole('technical-architect', 'technical-architecture', { mustRemainIndependentFrom: ['missing-reviewer'] })],
    })),
    /unknown or self independent role/,
  );
});

test('identifiers are byte-bounded across nested inputs and required policy qualifications cannot be weakened', () => {
  const policy = JSON.parse(fs.readFileSync(professionalBoundaryPolicyPath, 'utf8'));
  const requiredQualifications = {
    'contract-law': 'licensed-lawyer',
    'medical-care': 'licensed-clinician',
    'financial-services': 'licensed-financial-professional',
    'food-safety': 'qualified-food-safety-professional',
  };
  for (const [domainNeedId, qualification] of Object.entries(requiredQualifications)) {
    assert.equal(validateProfessionalDomainBoundaryPolicy(policy).get(domainNeedId).qualification, qualification);
    for (const replacement of ['unqualified', 'any-person', 'licensed-lawyer']) {
      if (replacement === qualification) continue;
      const weakened = structuredClone(policy);
      weakened.boundaries.find((boundary) => boundary.domainNeedId === domainNeedId).qualification = replacement;
      assert.throws(() => validateProfessionalDomainBoundaryPolicy(weakened), /must retain required qualification/);
    }
  }

  const maxIdentifier = 'a'.repeat(128);
  assert.equal(proposeProjectAgentTeam(genericInput({
    roleNeeds: [genericRole(maxIdentifier, 'technical-architecture')],
  })).roleProposals[0].id, maxIdentifier);

  const oversizedIdentifier = 'a'.repeat(100000);
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      roleNeeds: [genericRole(oversizedIdentifier, 'technical-architecture')],
    })),
    /at most 128 characters/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      evidence: [{ id: oversizedIdentifier, kind: 'user-confirmed-project' }],
      roleNeeds: [genericRole('technical-architect', 'technical-architecture', { evidenceIds: [oversizedIdentifier] })],
    })),
    /at most 128 characters/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      roleNeeds: [genericRole('technical-architect', oversizedIdentifier)],
    })),
    /at most 128 characters/,
  );
  assert.throws(
    () => proposeProjectAgentTeam(genericInput({
      roleNeeds: [genericRole('technical-architect', 'technical-architecture', { skillIds: [oversizedIdentifier] })],
    })),
    /at most 128 characters/,
  );
});
