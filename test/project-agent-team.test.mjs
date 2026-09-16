import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { proposeProjectAgentTeam } from '../src/project-agent-team.mjs';
import { teamRecommendation } from '../src/team-recommendation.mjs';

const root = path.resolve('.');
const humanContext = {
  teamScope: 'human',
  businessDescription: 'A bounded project delivery context.',
  confirmedSignals: [],
};

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
