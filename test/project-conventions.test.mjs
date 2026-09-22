import assert from 'node:assert/strict';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { scanProjectMemoryFacts } from '../src/modules/memory/index.mjs';
import { buildProjectConventionArtifacts, discoverProjectConventionCandidates, projectConventionIssues } from '../src/modules/standards/project-conventions.mjs';
import { adaptiveDecisionEvidenceHash, reconcileAdaptiveDecisions } from '../src/modules/skills/index.mjs';
import { memoryFixture, write } from './helpers/memory-fixture.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';
import { applyArtifactPlan } from '../src/managed-files.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProject } from '../src/checker.mjs';
import { artifactDefinitions, buildArtifacts, defaultConfig, selectedArtifactDefinitions } from '../src/generator.mjs';
import { planArtifacts } from '../src/managed-files.mjs';
import { validateManifestRemovalAuthority } from '../src/modules/governance/manifest-trust.mjs';

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
  const candidateDefinition = artifactDefinitions(defaultConfig(scanProject(root)), scanProject(root))
    .find((entry) => entry.path === candidate.skill);
  assert.deepEqual(candidateDefinition.routeProfiles, []);
  assert.equal(candidateDefinition.ownership, 'seed');
  const receipts = reconcileAdaptiveDecisions(candidates, [{ id: candidate.id, action: 'add' }]);
  write(root, 'src/api/widgets.mjs', "export function listWidgets() { return fetch('/api/widgets', { method: 'GET' }); }\nexport function getWidget() { return fetch('/api/widgets/one'); }\n");
  const changed = discover().candidates.find((entry) => entry.id === candidate.id);
  assert.notEqual(adaptiveDecisionEvidenceHash(candidate), adaptiveDecisionEvidenceHash(changed));
  assert.equal(reconcileAdaptiveDecisions([changed], [], receipts)[0].action, 'defer');
});

test('convention receipts bind the evidence surface, not the presentational prose', (t) => {
  const root = memoryFixture(t);
  const scan = scanProject(root);
  const candidate = discoverProjectConventionCandidates(scan, scanProjectMemoryFacts(scan)).candidates.find((entry) => entry.id === 'project-api-client');
  assert.ok(candidate);
  // A reworded claim about identical evidence keeps the approval: trigger, why, example and
  // the freshness note are prose, and a generator rewording must not reset owner decisions.
  const reworded = { ...candidate, trigger: 'Reworded trigger.', why: 'Reworded summary.', example: "fetch('/rewritten')", staleOnChange: 'Reworded freshness note.' };
  assert.equal(adaptiveDecisionEvidenceHash(reworded), adaptiveDecisionEvidenceHash(candidate));
  // Changing the evidence itself still invalidates the receipt.
  const rewrittenDigests = Object.fromEntries(Object.keys(candidate.sourceDigests).map((relative) => [relative, '0'.repeat(64)]));
  assert.notEqual(adaptiveDecisionEvidenceHash({ ...candidate, sourceDigests: rewrittenDigests }), adaptiveDecisionEvidenceHash(candidate));
  // Skill candidates are machine evidence rather than prose, so their metadata stays
  // deny-list bound: a permission change there genuinely changes what was approved.
  const skill = { id: 'offline-skill', permissions: ['read-project'] };
  assert.notEqual(adaptiveDecisionEvidenceHash({ ...skill, permissions: ['network'] }), adaptiveDecisionEvidenceHash(skill));
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
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  assert.equal(manifest.files.find((entry) => entry.path === 'docs/ai/skills/project-conventions/project-api-client/SKILL.md')?.ownership, 'full');
  assert.match(generated, /adaptiveDecisions\.skills/);
  assert.doesNotMatch(generated, /Current decision|Current decision: add/);
  assert.match(generated, /owner-approved for new code/);
  write(root, 'docs/ai/skills/project-conventions/project-api-client/SKILL.md', `${generated}\nunauthorized change\n`);
  assert.ok(checkProject(scanProject(root)).errors.some((entry) => entry.includes('managed content drift')));
  write(root, 'docs/ai/skills/project-conventions/project-api-client/SKILL.md', generated);
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

test('repeated project layout becomes an evidence-backed project Skill candidate', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    'src/main/java/example/controller/AlphaController.java',
    'src/main/java/example/controller/BetaController.java',
    'src/main/java/example/controller/GammaController.java',
    'src/main/java/example/service/AlphaService.java',
    'src/main/java/example/service/BetaService.java',
    'src/test/java/example/AlphaTest.java',
  ]) write(root, relative, 'class Example {}\n');
  write(root, 'pom.xml', '<project><properties><skipTests>false</skipTests></properties></project>\n');
  const scan = scanProject(root);
  const memory = scanProjectMemoryFacts(scan);
  const candidate = discoverProjectConventionCandidates(scan, memory).candidates.find((entry) => entry.kind === 'project-layout');
  assert.ok(candidate);
  assert.ok(candidate.observations.some((entry) => entry.id === 'http-entrypoints' && entry.count === 3));
  assert.equal(candidate.verificationCommands[0].trust.level, 'declared');
  assert.equal(candidate.verificationCommands[0].source.path, 'pom.xml');
  assert.match(candidate.verificationCommands[0].source.sha256, /^[a-f0-9]{64}$/);
  const config = {
    ...defaultConfig(scan),
    adaptiveDecisions: { schemaVersion: 1, skills: [{ id: candidate.id, action: 'add', evidenceHash: adaptiveDecisionEvidenceHash(candidate) }], roles: [] },
  };
  const skill = buildProjectConventionArtifacts(config, scan, memory).artifacts.find((entry) => entry.path === candidate.skill).content;
  for (const heading of ['When to use', 'When not to use', 'Observed current patterns', 'Approved new-code decisions', 'Confirmed business invariants', 'Conflicts and unverified gaps', 'Verification matrix', 'Evidence catalog']) assert.match(skill, new RegExp(`## ${heading}`));
  assert.match(skill, /owner-approved for new code/);
  assert.match(skill, /mvn test.*declared/s);
  write(root, '.ai-governance/state/project-conventions.json', JSON.stringify({ schemaVersion: 1, candidates: [candidate], gaps: [] }));
  write(root, 'src/main/java/example/controller/DeltaController.java', 'class DeltaController {}\n');
  assert.ok(projectConventionIssues(root, scanProject(root)).some((entry) => entry.status === 'stale' && entry.reason.includes('observed project convention evidence changed')));
});

test('repeated source roles are decomposed into bounded project-surface candidates', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/server/controller/First.mjs', 'export const first = true;\n');
  write(root, 'src/server/controller/Second.mjs', 'export const second = true;\n');
  write(root, 'src/server/controller/Third.mjs', 'export const third = true;\n');
  write(root, 'src/server/service/First.mjs', 'export const first = true;\n');
  write(root, 'src/server/service/Second.mjs', 'export const second = true;\n');
  const scan = scanProject(root);
  const discovery = discoverProjectConventionCandidates(scan, scanProjectMemoryFacts(scan));
  const surfaces = discovery.candidates.filter((candidate) => candidate.kind === 'project-surface');
  assert.ok(surfaces.some((candidate) => candidate.surface === 'http-entrypoints'));
  assert.ok(surfaces.some((candidate) => candidate.surface === 'services'));
  assert.ok(surfaces.length <= 8);
});

test('project layout decision hash binds the verification command source digest', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-layout-command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    'src/controllers/Alpha.ts',
    'src/controllers/Beta.ts',
    'src/controllers/Gamma.ts',
    'src/services/Alpha.ts',
  ]) write(root, relative, 'export const value = true;\n');
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
  const beforeScan = scanProject(root);
  const before = discoverProjectConventionCandidates(beforeScan, scanProjectMemoryFacts(beforeScan)).candidates.find((entry) => entry.kind === 'project-layout');
  assert.ok(before);
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test test/unit.test.mjs' } }));
  const afterScan = scanProject(root);
  const after = discoverProjectConventionCandidates(afterScan, scanProjectMemoryFacts(afterScan)).candidates.find((entry) => entry.kind === 'project-layout');
  assert.ok(after);
  assert.notEqual(before.verificationCommands[0].source.sha256, after.verificationCommands[0].source.sha256);
  assert.notEqual(adaptiveDecisionEvidenceHash(before), adaptiveDecisionEvidenceHash(after));
});

test('an exact add decision safely promotes a convention seed into a routed managed Skill', (t) => {
  const root = memoryFixture(t);
  const initialScan = scanProject(root);
  const initialConfig = defaultConfig(initialScan);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(initialConfig, initialScan)));
  const initialManifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  const initialAuthority = validateManifestRemovalAuthority(root, initialManifest);
  assert.equal(initialAuthority.trusted, true, JSON.stringify(initialAuthority.errors));
  const refreshedScan = scanProject(root);
  const candidate = discoverProjectConventionCandidates(refreshedScan, scanProjectMemoryFacts(refreshedScan)).candidates
    .find((entry) => entry.id === 'project-api-client');
  assert.ok(candidate);
  const seedPath = path.join(root, candidate.skill);
  const seedContent = fs.readFileSync(seedPath, 'utf8');
  assert.equal(initialManifest.files.some((entry) => entry.path === candidate.skill), false);
  assert.equal(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8').includes(candidate.skill), false);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  config.adaptiveDecisions = {
    schemaVersion: 1,
    skills: [{ id: candidate.id, action: 'add', evidenceHash: adaptiveDecisionEvidenceHash(candidate) }],
    roles: [],
  };
  assert.deepEqual(artifactDefinitions(config, refreshedScan).find((entry) => entry.path === candidate.skill)?.routeProfiles, ['behavior_change:project_conventions']);
  assert.ok(selectedArtifactDefinitions(config, refreshedScan).some((entry) => entry.path === candidate.skill));
  write(root, candidate.skill, `${seedContent}\nowner change\n`);
  const rejectedPlan = planArtifacts(root, buildArtifacts(config, refreshedScan));
  assert.ok(rejectedPlan.conflicts.some((entry) => entry === `${candidate.skill}: existing unowned file will not be overwritten`));
  write(root, candidate.skill, seedContent);
  const plan = planArtifacts(root, buildArtifacts(config, refreshedScan));
  assert.deepEqual(plan.conflicts, []);
  assert.match(plan.operations.find((entry) => entry.path === 'docs/ai/context-map.yaml').desired, new RegExp(candidate.skill.replaceAll('/', '\\/')));
  applyArtifactPlan(root, plan);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  const skill = manifest.files.find((entry) => entry.path === candidate.skill);
  assert.equal(skill?.ownership, 'full');
  assert.equal(skill?.kind, 'project-convention-skill');
  assert.equal(validateManifestRemovalAuthority(root, manifest).trusted, true);
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
});
