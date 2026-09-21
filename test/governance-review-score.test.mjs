import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../src/shared/index.mjs';
import { createGovernanceReviewBrief, scoreGovernanceFramework } from '../src/modules/governance/review-score.mjs';

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-review-score-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = 'docs/ai/evidence.json';
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, relative), '{"review":"recorded"}\n');
  return { root, evidence: { path: relative, sha256: sha256(fs.readFileSync(path.join(root, relative))) } };
}

const check = { ok: true, evidence: { present: 'pass', reachable: 'pass' }, architecture: { moduleGraph: { status: 'active', issues: [], unsupportedFiles: [] } } };

test('review brief requires a fresh reviewer and adds business analysis for existing projects', () => {
  const result = createGovernanceReviewBrief({ lifecycle: 'existing', generatorAgentId: 'generator-1', projectRoot: '/project' });
  assert.ok(result.roles.includes('business-analysis-reviewer'));
  assert.match(result.independence, /fresh Agent/);
});

test('score reports missing evidence and concrete remediation without a complete claim', (context) => {
  const { root } = fixture(context);
  const result = scoreGovernanceFramework({ root, lifecycle: 'greenfield', check });
  assert.equal(result.status, 'needs-remediation');
  // Two of the previously dead-zone criteria (`design-review`, `source-traceability`) now
  // derive from `check.evidence.{present,reachable}`; the other four stay unverified until
  // the owner wires up skill discovery, agent team, and brownfield memory. Baseline score
  // therefore rises from the historical 26 to 38, not to a free pass.
  assert.equal(result.score, 38);
  assert.ok(result.remediation.some((item) => item.criterion === 'independent-review'));
  assert.equal(result.dimensions.architecture.score, 15);
});

test('passing claims require unchanged local evidence and independent review identity', (context) => {
  const { root, evidence } = fixture(context);
  const proofs = Object.fromEntries([
    'project-layout', 'design-review', 'development-docs', 'source-traceability',
    'stack-skill-coverage', 'memory-ownership', 'memory-evidence', 'role-routing',
    'process-scaling', 'test-plan', 'test-result-report',
  ].map((id) => [id, { status: 'pass', evidence: [evidence] }]));
  const review = { generatorAgentId: 'generator-1', reviewerAgentId: 'reviewer-2', roles: ['architecture-reviewer', 'developer-experience-reviewer', 'quality-reviewer'], decision: 'accepted', findings: [], receipt: evidence };
  const accepted = scoreGovernanceFramework({ root, lifecycle: 'greenfield', check, proofs, review });
  assert.equal(accepted.score, 100);
  assert.equal(accepted.status, 'ready-for-owner-acceptance');
  assert.equal(scoreGovernanceFramework({ root, lifecycle: 'greenfield', check, proofs, review: { ...review, reviewerAgentId: 'generator-1' } }).score, 90);
  fs.writeFileSync(path.join(root, evidence.path), 'changed');
  const drifted = scoreGovernanceFramework({ root, lifecycle: 'greenfield', check, proofs, review });
  assert.equal(drifted.status, 'needs-remediation');
  // Drift invalidates every proof, but the two derived criteria still hold because the
  // managed-files and reachable entrypoint signals in `check` are unchanged.
  assert.equal(drifted.score, 38);
});

test('brownfield gaps override optimistic documentation, memory, and Skill claims', (context) => {
  const { root, evidence } = fixture(context);
  const proofs = Object.fromEntries(['development-docs', 'source-traceability', 'memory-ownership', 'memory-evidence', 'stack-skill-coverage']
    .map((id) => [id, { status: 'pass', evidence: [evidence] }]));
  const result = scoreGovernanceFramework({ root, lifecycle: 'existing', check: { ...check, brownfield: { gaps: ['missing development unit'] } }, proofs });
  assert.equal(result.dimensions.documentation.score, 0);
  assert.equal(result.dimensions['business-memory'].score, 0);
  assert.ok(result.remediation.some((item) => item.reason?.includes('missing development unit')));
});

test('evidence through a linked parent directory cannot raise a score', (context) => {
  const { root } = fixture(context);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-review-external-'));
  context.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'proof.json'), 'external proof');
  fs.symlinkSync(external, path.join(root, 'linked'));
  const linked = { path: 'linked/proof.json', sha256: sha256(fs.readFileSync(path.join(external, 'proof.json'))) };
  const result = scoreGovernanceFramework({ root, lifecycle: 'greenfield', check, proofs: { 'project-layout': { status: 'pass', evidence: [linked] } } });
  assert.equal(result.criteria.find((item) => item.id === 'project-layout').status, 'unverified');
  // Linked-parent evidence is rejected, but the two derivable criteria (`design-review`,
  // `source-traceability`) still ride on the unchanged `check` payload, so the baseline is
  // 38, not the historical 26.
  assert.equal(result.score, 38);
});
