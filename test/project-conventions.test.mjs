import assert from 'node:assert/strict';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { scanProjectMemoryFacts } from '../src/modules/memory/index.mjs';
import { discoverProjectConventionCandidates } from '../src/modules/standards/project-conventions.mjs';
import { adaptiveDecisionEvidenceHash, reconcileAdaptiveDecisions } from '../src/modules/skills/index.mjs';
import { memoryFixture, write } from './helpers/memory-fixture.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';
import { applyArtifactPlan } from '../src/managed-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { checkProject } from '../src/checker.mjs';

test('repeated project-local calls yield evidence-bound candidates with stale approvals', (t) => {
  const root = memoryFixture(t);
  const discover = () => { const scan = scanProject(root); return discoverProjectConventionCandidates(scan, scanProjectMemoryFacts(scan)); };
  const { candidates } = discover();
  const candidate = candidates.find((entry) => entry.id === 'project-api-client');
  assert.ok(candidate);
  for (const key of ['trigger', 'purpose', 'why', 'example', 'verificationBoundary']) assert.ok(candidate[key]);
  assert.match(candidate.example, /fetch\('\/api\/widgets'\)/);
  assert.ok(candidate.evidencePaths.includes('src/api/widgets.mjs'));
  assert.match(candidate.sourceDigests['src/api/widgets.mjs'], /^[a-f0-9]{64}$/);
  assert.equal(candidate.status, 'candidate');
  const receipts = reconcileAdaptiveDecisions(candidates, [{ id: candidate.id, action: 'add' }]);
  write(root, 'src/api/widgets.mjs', "export function listWidgets() { return fetch('/api/widgets', { method: 'GET' }); }\nexport function getWidget() { return fetch('/api/widgets/one'); }\n");
  const changed = discover().candidates.find((entry) => entry.id === candidate.id);
  assert.notEqual(adaptiveDecisionEvidenceHash(candidate), adaptiveDecisionEvidenceHash(changed));
  assert.equal(reconcileAdaptiveDecisions([changed], [], receipts)[0].action, 'defer');
});

test('conflicting API client styles produce a visible gap instead of a standard', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/api/other.mjs', "import axios from 'axios';\nexport function other() { return axios.get('/api/widgets'); }\n");
  const scan = scanProject(root);
  const result = discoverProjectConventionCandidates(scan, scanProjectMemoryFacts(scan));
  assert.equal(result.candidates.some((entry) => entry.id === 'project-api-client'), false);
  assert.ok(result.gaps.some((entry) => entry.reason.includes('conflicting')));
});

test('initialization previews convention choices, preserves evidence receipts and marks source drift', async (t) => {
  const root = memoryFixture(t);
  const answers = { clients: ['codex'], initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' }, adaptiveGovernance: { installedRoots: [], decisions: { skills: [{ id: 'project-api-client', action: 'add' }], roles: [] } } };
  write(root, 'answers.json', JSON.stringify(answers));
  const prepared = await prepareInit(root, { config: path.join(root, 'answers.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.ok(prepared.plan.adaptiveGovernance.skills.candidates.some((entry) => entry.id === 'project-api-client'));
  assert.equal(prepared.config.adaptiveDecisions.skills.find((entry) => entry.id === 'project-api-client').action, 'add');
  assert.equal(fs.existsSync(path.join(root, 'docs/memory/INDEX.json')), false);
  applyArtifactPlan(root, prepared.plan);
  const generated = fs.readFileSync(path.join(root, 'docs/ai/skills/project-conventions/project-api-client/SKILL.md'), 'utf8');
  assert.match(generated, /Current decision: add/);
  assert.match(generated, /not adopted/);
  write(root, 'src/api/widgets.mjs', "export function listWidgets() { return fetch('/api/widgets', { method: 'GET' }); }\nexport function getWidget() { return fetch('/api/widgets/one'); }\n");
  delete answers.adaptiveGovernance.decisions;
  write(root, 'answers.json', JSON.stringify(answers));
  const refreshed = await prepareInit(root, { config: path.join(root, 'answers.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.equal(refreshed.plan.adaptiveGovernance.skills.candidates.filter((entry) => entry.id.startsWith('project-api-client')).length, 1);
  assert.equal(refreshed.config.adaptiveDecisions.skills.find((entry) => entry.id === 'project-api-client').action, 'defer');
  assert.ok(checkProject(scanProject(root)).warnings.some((entry) => /convention.*stale/.test(entry)));
});

test('stale memory cannot endorse a new digest with an obsolete example', (t) => {
  const root = memoryFixture(t);
  const scan = scanProject(root);
  const memory = scanProjectMemoryFacts(scan);
  write(root, 'src/api/widgets.mjs', "export function listWidgets() { return fetch('/new'); }\n");
  const result = discoverProjectConventionCandidates(scanProject(root), memory);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.gaps.some((entry) => /stale/.test(entry.reason)));
});
