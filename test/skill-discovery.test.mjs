import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverSkills, decideSkillCandidates } from '../src/skill-discovery.mjs';
import * as discoveryApi from '../src/skill-discovery.mjs';
import { buildArtifacts, defaultConfig, prepareSkillGovernancePlan } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { checkProject } from '../src/checker.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { skillAdapterContent } from '../src/shared/index.mjs';
import { TOOL_NAME } from '../src/constants.mjs';
import { validateApprovedAgentTeam } from '../src/modules/skills/decisions.mjs';
import { buildApprovedProjectAgentTeam, proposeProjectAgentTeam } from '../src/project-agent-team.mjs';
import { adaptiveDecisionEvidenceHash, reconcileAdaptiveDecisions, validateAdaptiveDecisions } from '../src/modules/skills/index.mjs';
import { artifactDefinitions, selectArtifactDefinitions } from '../src/modules/governance/index.mjs';

test('adaptive generic guidance stays lazy and first-use requires fresh approval while retaining existing files', (context) => {
  const root = fixture(context), scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete' };
  const { config, plan } = approvedConfig(base, scan);
  const initial = buildArtifacts(config, scan);
  const paths = ['docs/ai/anti-patterns.md', 'docs/ai/skills/generic-unknown/SKILL.md', '.agents/skills/generic-unknown/SKILL.md'];
  for (const relative of paths) assert.equal(initial.some((entry) => entry.path === relative), false);
  const used = { ...scan, governanceUsage: ['anti-patterns'] };
  assert.throws(() => buildArtifacts(config, used), /cost|planHash|approval/i);
  const upgraded = approvedConfig(base, used);
  assert.notEqual(upgraded.plan.planHash, plan.planHash);
  const artifacts = buildArtifacts(upgraded.config, used);
  assert.ok(artifacts.some((entry) => entry.path === paths[0]));
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  const preserved = fs.readFileSync(path.join(root, paths[0]), 'utf8');
  const omission = planArtifacts(root, initial);
  assert.equal(omission.operations.some((entry) => entry.path === paths[0] && entry.remove), false);
  applyArtifactPlan(root, omission);
  assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), preserved);
  const definitions = artifactDefinitions(config, scan);
  const stack = selectArtifactDefinitions(config, { ...scan, governanceUsage: ['stack'] }, definitions);
  for (const relative of paths.slice(1)) assert.ok(stack.some((entry) => entry.path === relative));
  const retained = selectArtifactDefinitions(config, scanProject(root), definitions);
  assert.ok(retained.some((entry) => entry.path === paths[0]));
});

test('bounded folded and literal Skill descriptions are discoverable without YAML execution', (context) => {
  for (const indicator of ['>-', '|-', '>', '|']) {
    const root = fixture(context);
    const file = path.join(root, 'docs/ai/skills/block/SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nname: block\ndescription: ${indicator}\n  Review bounded metadata.\n  Preserve safety boundaries.\n---\n# Body\n`);
    assert.equal(discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] }).length, 1, indicator);
    fs.writeFileSync(file, `---\nname: block\ndescription: >-\n  ${'x'.repeat(501)}\n---\n`);
    assert.equal(discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] }).length, 0);
  }
});

test('decision receipts bind all Skill metadata and reject malformed remembered state', (context) => {
  const root = fixture(context);
  skill(root, 'docs/ai/skills/review', 'review');
  const [candidate] = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const receipt = { id: candidate.id, action: 'reject', evidenceHash: adaptiveDecisionEvidenceHash(candidate) };
  assert.equal(reconcileAdaptiveDecisions([candidate], [], [receipt])[0].action, 'reject');
  for (const change of [{ source: 'another-source' }, { version: '2.0.0' }, { contentSha256: 'e'.repeat(64) }, { permissions: ['network'] }, { availability: 'refresh-due' }, { capabilities: ['review', 'new-risk'] }]) {
    assert.equal(reconcileAdaptiveDecisions([{ ...candidate, ...change }], [], [receipt])[0].action, 'defer');
  }
  for (const value of [null, [], {}, { schemaVersion: 1, skills: [{ ...receipt, evidenceHash: 'bad' }], roles: [] }, { schemaVersion: 1, skills: [receipt, receipt], roles: [] }, { schemaVersion: 1, skills: [{ ...receipt, id: 123 }], roles: [] }, { schemaVersion: 1, skills: Array(33).fill(receipt), roles: [] }]) assert.throws(() => validateAdaptiveDecisions(value), /adaptive|decision/i);
});

test('direct approved teams cannot bypass professional semantics with matching arbitrary hashes', (context) => {
  const root = fixture(context);
  const scan = scanProject(root);
  const team = proposeProjectAgentTeam({ projectMode: 'greenfield',
    evidence: [{ id: 'owner.domain', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Legal scope', evidenceIds: ['owner.domain'], jurisdiction: 'JP' }],
    roleNeeds: [{ id: 'legal-reviewer', title: 'Legal review', capabilities: ['legal-review'], responsibilities: ['Review risks.'], outOfScope: ['Final advice.'], domainNeedIds: ['contract-law'], evidenceIds: ['owner.domain'], skillIds: [], mustRemainIndependentFrom: [] }],
  });
  Object.assign(team, { enabled: true, status: 'approved', planHash: 'b'.repeat(64), approval: { planHash: 'b'.repeat(64) } });
  Object.assign(team.roleProposals[0], { status: 'approved-available', approval: { source: 'user', evidenceId: 'owner.approval' }, professionalBoundaries: [], activation: { signals: ['sensitive-data'], paths: ['docs/contracts/**'] } });
  delete team.roleProposals[0].professionalBoundary;
  team.professionalBoundaries = [];
  const config = { ...defaultConfig(scan), clients: ['codex'], skillDiscovery: { enabled: true, decision: approvedDecision([]) }, agentTeam: team };
  assert.throws(() => validateApprovedAgentTeam(team), /approval|boundary|professional|planHash/i);
  assert.throws(() => prepareSkillGovernancePlan(config, scan), /approval|boundary|professional|planHash/i);
  assert.throws(() => buildArtifacts(config, scan), /approval|boundary|professional|planHash/i);
});

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-discovery-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function skill(root, relative, capability = 'contract-clause-risk-review', extra = '') {
  const file = path.join(root, relative, 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nname: clause-review\ndescription: Review clauses without making legal decisions.\nversion: 1.0.0\ncapabilities: ["${capability}"]\npermissions: ["read-project"]\n${extra}---\n# Review\nNever run scripts during discovery.\n`);
  return file;
}

function approvedDecision(candidates, selectedIds) {
  const recommendation = decideSkillCandidates(candidates, { selectedIds });
  return decideSkillCandidates(candidates, { selectedIds, approvalPlanHash: recommendation.planHash });
}

function approvedConfig(config, scan, candidates = [], selectedIds) {
  const agentTeam = buildApprovedProjectAgentTeam(proposeProjectAgentTeam({ projectMode: 'greenfield', evidence: [{ id: 'owner.scope', kind: 'user-confirmed-project' }], confirmedDomainNeeds: [], roleNeeds: [] }), { selectedIds: [], approvalEvidenceId: 'owner.approval' });
  const input = { ...config, skillDiscovery: { enabled: true, decision: approvedDecision(candidates, selectedIds) }, agentTeam };
  const plan = prepareSkillGovernancePlan(input, scan);
  return { plan, config: { ...input, skillDiscovery: { ...plan.skillDiscovery, approvalPlanHash: plan.planHash }, agentTeam: plan.agentTeam } };
}

test('skill discovery is local, deduplicated, approval-gated, and lazy', (context) => {
  const root = fixture(context);
  const installed = fixture(context);
  skill(root, 'docs/ai/skills/clauses');
  skill(installed, 'clauses');
  const candidates = discoverSkills({ root, installedRoots: [installed], curatedCatalog: [], requiredCapabilities: ['contract-clause-risk-review'] });
  assert.ok(candidates.length <= 5);
  assert.equal(candidates[0].sourceKind, 'project');
  assert.equal(new Set(candidates.map((item) => item.capabilityOwner)).size, candidates.length);
  assert.equal(candidates[0].decision, 'discovered');
  assert.equal(candidates[0].permissions[0], 'read-project');
  assert.equal(candidates[0].content, undefined);
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete' };
  assert.deepEqual(base.skillDiscovery, { enabled: false });
  assert.deepEqual(base.agentTeam, { enabled: false });
  const { config, plan } = approvedConfig(base, scan, candidates);
  const management = (item) => /skill-discovery|team-orchestrator|agent-team|skill-index/.test(item.path);
  assert.equal(buildArtifacts({ ...config, governanceDepth: 'minimal' }, scan).some(management), false);
  assert.equal(buildArtifacts({ ...config, governanceDepth: 'standard' }, scan).some(management), false);
  assert.throws(() => buildArtifacts({ ...config, skillDiscovery: { ...config.skillDiscovery, approvalPlanHash: null } }, scan), /approval/i);
  const artifacts = buildArtifacts(config, scan);
  assert.equal(artifacts.filter(management).length, 4);
  const roster = JSON.parse(artifacts.find((item) => item.path === 'docs/ai/agent-team.json').content);
  assert.deepEqual(roster.professionalBoundaries, config.agentTeam.professionalBoundaries);
  assert.equal(roster.teamType, 'project-ai-agent-team');
  assert.equal(plan.cost.increment.files, 4);
  // The Skill management increment is the budgeted quantity; the retained governance
  // tree is budgeted by the approved governance depth instead.
  assert.ok(plan.cost.increment.files <= 30);
  assert.ok(plan.cost.increment.bytes <= 96 * 1024);
  assert.ok(plan.cost.increment.managerTokens <= 800);
  assert.ok(plan.cost.total.files >= plan.cost.increment.files);
  const bodies = artifacts.filter((item) => /\/(skill-discovery|team-orchestrator)\/SKILL.md$/.test(item.path));
  assert.ok(Math.ceil(bodies.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) / 4) <= 800);
  const map = artifacts.find((item) => item.path === 'docs/ai/context-map.yaml').content;
  assert.doesNotMatch(map.slice(map.indexOf('  ordinary:'), map.indexOf('  behavior_change:')), /skill-discovery|team-orchestrator|agent-team|skill-index/);
  assert.match(map.slice(map.indexOf('  behavior_change:')), /skill-discovery/);
});

test('discovery remains array-compatible while direct JSON and the public serializer retain diagnostics', (context) => {
  const root = fixture(context);
  skill(root, 'docs/ai/skills/read-safe', 'read-safe');
  const candidates = discoverSkills({ root, installedRoots: [path.join(root, 'unavailable')], curatedCatalog: [], requiredCapabilities: [] });
  assert.equal(Array.isArray(candidates), true);
  assert.equal(candidates.length, 1);
  assert.equal(candidates.map((item) => item.id)[0], candidates[0].id);
  const parsed = JSON.parse(JSON.stringify(candidates));
  assert.ok(parsed.sourceStatus?.some((item) => item.status === 'unavailable'));
  assert.deepEqual(parsed.candidates, [...candidates]);
  assert.deepEqual(discoveryApi.serializeSkillDiscovery(candidates), parsed);
  assert.deepEqual(discoveryApi.serializeSkillDiscovery(parsed), parsed);
  assert.equal(decideSkillCandidates(parsed).planHash, decideSkillCandidates(candidates).planHash);
  const empty = discoverSkills({ root: fixture(context), installedRoots: [path.join(root, 'missing')], curatedCatalog: [], requiredCapabilities: [] });
  const emptyParsed = JSON.parse(JSON.stringify(empty));
  assert.deepEqual(emptyParsed.candidates, []);
  assert.ok(emptyParsed.sourceStatus.some((item) => item.status === 'unavailable'));
});

test('sourceStatus is part of the exact decision and persisted artifact approval', (context) => {
  const root = fixture(context);
  skill(root, 'docs/ai/skills/read-safe', 'read-safe');
  const candidates = discoverSkills({ root, installedRoots: [path.join(root, 'missing')], curatedCatalog: [], requiredCapabilities: [] });
  const scan = scanProject(root);
  const { config } = approvedConfig({ ...defaultConfig(scan), clients: ['codex'] }, scan, candidates);
  const approved = config.skillDiscovery.decision;
  candidates.sourceStatus[0].status = 'unavailable';
  const changed = decideSkillCandidates(candidates);
  assert.notEqual(changed.planHash, approved.planHash);
  assert.throws(() => decideSkillCandidates(candidates, { approvalPlanHash: approved.planHash }), /planHash|approval/);
  const artifacts = buildArtifacts(config, scan);
  const index = JSON.parse(artifacts.find((item) => item.path === 'docs/ai/skill-index.json').content);
  assert.deepEqual(index.sourceStatus, approved.sourceStatus);
  assert.ok(index.sourceStatus.some((item) => item.status === 'unavailable'));
  const tampered = structuredClone(config);
  tampered.skillDiscovery.decision.sourceStatus[0].status = 'unavailable';
  assert.throws(() => buildArtifacts(tampered, scan), /planHash|approval/);
});

for (const [change, mutate] of [
  ['digest', (source) => fs.appendFileSync(source, '\nChanged unselected body.\n')],
  ['version', (source) => fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('version: 1.0.0', 'version: 2.0.0'))],
  ['permissions', (source) => fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('["read-project"]', '["network"]'))],
  ['source', (source) => fs.renameSync(source, `${source}.moved`)],
  ['availability', (source) => { fs.unlinkSync(source); fs.mkdirSync(source); }],
]) {
  test(`unselected indexed candidate ${change} changes invalidate decision, artifacts and checker`, (context) => {
    const root = fixture(context);
    skill(root, 'docs/ai/skills/one', 'cap-one');
    const unselectedSource = skill(root, 'docs/ai/skills/two', 'cap-two');
    const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
    const selectedIds = [candidates[0].id];
    const scan = scanProject(root);
    const { config } = approvedConfig({ ...defaultConfig(scan), clients: ['codex'] }, scan, candidates, selectedIds);
    const artifacts = buildArtifacts(config, scan);
    const index = JSON.parse(artifacts.find((item) => item.path === 'docs/ai/skill-index.json').content);
    assert.equal(index.candidates.length, 2);
    assert.equal(index.candidates[1].decision, 'discovered');
    applyArtifactPlan(root, planArtifacts(root, artifacts));
    assert.equal(checkProject(scanProject(root)).ok, true);
    mutate(unselectedSource);
    assert.throws(() => decideSkillCandidates(candidates, { selectedIds, approvalPlanHash: config.skillDiscovery.decision.planHash }), /stale|source|digest|ENOENT/i);
    assert.throws(() => buildArtifacts(config, scanProject(root)), /stale|source|digest|ENOENT/i);
    assert.equal(checkProject(scanProject(root)).ok, false);
  });
}

test('discovery requires explicit roots, rejects links and oversized metadata, and never executes content', (context) => {
  const root = fixture(context);
  const installed = fixture(context);
  assert.throws(() => discoverSkills({ root, curatedCatalog: [], requiredCapabilities: [] }), /installedRoots/);
  const target = skill(installed, 'external');
  const projectDir = path.join(root, 'docs/ai/skills');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.symlinkSync(path.dirname(target), path.join(projectDir, 'linked-directory'));
  fs.mkdirSync(path.join(projectDir, 'linked-file'));
  fs.symlinkSync(target, path.join(projectDir, 'linked-file/SKILL.md'));
  fs.writeFileSync(path.join(projectDir, 'huge.md'), 'unused');
  const large = skill(root, 'docs/ai/skills/large');
  fs.appendFileSync(large, 'x'.repeat(65537));
  const marker = path.join(root, 'SHOULD-NOT-EXIST');
  const safe = skill(root, 'docs/ai/skills/safe', 'read-safe');
  fs.appendFileSync(safe, `\n\`touch ${marker}\`\n`);
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].capabilityOwner, 'read-safe');
  assert.equal(fs.existsSync(marker), false);
  assert.ok(candidates.sourceStatus.some((item) => item.status === 'skipped-unsafe'));
  const unavailable = discoverSkills({ root, installedRoots: [path.join(root, 'not-present')], curatedCatalog: [], requiredCapabilities: [] });
  assert.ok(unavailable.sourceStatus.some((item) => item.status === 'unavailable'));
});

test('source priority, same-priority conflicts, bounded recommendations and stale catalog are explicit', (context) => {
  const root = fixture(context);
  const installed = fixture(context);
  skill(root, 'docs/ai/skills/one', 'same-owner');
  skill(root, 'docs/ai/skills/two', 'same-owner', 'version-note: distinct\n');
  skill(installed, 'installed', 'installed-owner');
  const curatedCatalog = Array.from({ length: 7 }, (_, index) => ({ id: `curated-${index}`, source: `official:curated-${index}`, version: '1.0.0', contentSha256: String(index).repeat(64), capabilities: [`curated-${index}`], permissions: [], verifiedAt: '2000-01-01T00:00:00.000Z' }));
  const candidates = discoverSkills({ root, installedRoots: [installed], curatedCatalog, requiredCapabilities: [] });
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0].sourceKind, 'project');
  assert.equal(candidates[0].availability, 'needs-user-decision');
  assert.equal(candidates[1].sourceKind, 'installed');
  assert.equal(candidates[2].sourceKind, 'official-curated');
  assert.equal(candidates[2].availability, 'refresh-due');
  assert.ok(candidates.every((item) => ['verified', 'reachable', 'stated', 'unverified'].includes(item.verification)));
  assert.throws(() => approvedDecision(candidates), /conflict|refresh|unverified/i);
});

test('only manifest-verified project adapters are discovered and approval rechecks adapter bytes', (context) => {
  const root = fixture(context);
  const adapter = skill(root, '.agents/skills/existing', 'read-safe');
  skill(root, '.claude/skills/unowned', 'unowned');
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  fs.mkdirSync(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, generatedBy: 'AI Code Governance', files: [{
    path: '.agents/skills/existing/SKILL.md', ownership: 'full', kind: 'adapter-skill', source: 'docs/ai/skills/existing/SKILL.md', sha256: sha256(fs.readFileSync(adapter)),
  }] }));
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceKind, 'project');
  const approved = approvedDecision(candidates);
  fs.appendFileSync(adapter, '\nchanged\n');
  assert.throws(() => decideSkillCandidates(candidates, { approvalPlanHash: approved.planHash, activeForTask: { taskId: 'task-1', ids: [candidates[0].id] } }), /stale|source|digest/i);
  assert.equal(discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] }).length, 0);
});

test('discovery does not traverse a linked canonical ancestor or expose source bodies', (context) => {
  const root = fixture(context);
  const outside = fixture(context);
  skill(outside, 'skills/secret', 'secret-owner');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.symlinkSync(outside, path.join(root, 'docs/ai'));
  assert.equal(discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] }).length, 0);
});

test('non-UTF-8 manifests cannot collapse distinct raw bytes into one approved content digest', (context) => {
  const root = fixture(context);
  const source = skill(root, 'docs/ai/skills/invalid-encoding', 'invalid-encoding');
  fs.appendFileSync(source, Buffer.from([0xff]));
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  assert.equal(candidates.length, 0);
  assert.ok(candidates.sourceStatus.some((item) => /UTF-8/.test(item.reason ?? '')));
});

test('task activation remains bounded and team, permission and total-cost changes need new approval', (context) => {
  const root = fixture(context);
  for (let index = 0; index < 4; index += 1) skill(root, `docs/ai/skills/skill-${index}`, `cap-${index}`);
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const decision = approvedDecision(candidates);
  assert.throws(() => decideSkillCandidates(candidates, { approvalPlanHash: decision.planHash, activeForTask: { taskId: 'task-1', ids: candidates.map((item) => item.id) } }), /three/);
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'] };
  const { config } = approvedConfig(base, scan, candidates);
  for (const mutate of [
    (value) => { value.agentTeam.planHash = 'e'.repeat(64); },
    (value) => { value.agentTeam.approval.planHash = 'f'.repeat(64); },
    (value) => { value.skillDiscovery.decision.candidates[0].permissions = ['network']; },
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(() => buildArtifacts(changed, scan), /approval|planHash/);
  }
  for (const relative of ['docs/ai/bootstrap-prompt.md', 'reviews/.gitkeep', 'reports/.gitkeep', 'docs/ai/skills/business-constraints/SKILL.md']) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'retained historical governance seed\n');
  }
  // Regression: an existing Complete repository that already retains a large governance
  // tree must still be able to adopt skills. Budgeting the retained tree against a fixed
  // allowance made the brownfield "no evidence-backed project Skill" gap unreachable.
  const retainedScan = { ...scan, governanceUsage: ['anti-patterns'] };
  const retained = approvedConfig(
    { ...base, governanceDepth: 'complete', clients: ['codex', 'claude-code', 'cursor'] },
    retainedScan,
    candidates,
    candidates.map((candidate) => candidate.id),
  );
  assert.equal(retained.plan.cost.increment.files, 4);
  assert.ok(retained.plan.cost.increment.managerTokens <= 800);
  assert.ok(retained.plan.cost.total.files > retained.plan.cost.increment.files, 'the retained governance tree stays visible in total cost');
  assert.ok(buildArtifacts(retained.config, retainedScan).length > retained.plan.cost.increment.files);
  const tampered = structuredClone(retained.config);
  tampered.skillDiscovery.artifactPlan.cost.total.files += 1;
  assert.throws(() => buildArtifacts(tampered, retainedScan), /approval|planHash/);
});

test('exact decisions bind source, version, digest, permissions and task activation without doing work', (context) => {
  const root = fixture(context);
  skill(root, 'docs/ai/skills/safe', 'read-safe');
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const proposed = decideSkillCandidates(candidates);
  assert.equal(proposed.status, 'recommended');
  const approved = decideSkillCandidates(candidates, { approvalPlanHash: proposed.planHash });
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.actionsPerformed, []);
  for (const change of [ { source: 'different' }, { version: '2.0.0' }, { contentSha256: 'd'.repeat(64) }, { permissions: ['network'] } ]) {
    assert.throws(() => decideSkillCandidates([{ ...candidates[0], ...change }], { approvalPlanHash: proposed.planHash }), /approval|planHash/i);
  }
  const active = decideSkillCandidates(candidates, { approvalPlanHash: proposed.planHash, activeForTask: { taskId: 'task-1', ids: [candidates[0].id] } });
  assert.equal(active.candidates[0].decision, 'active-for-task');
  assert.deepEqual(active.actionsPerformed, []);
  assert.throws(() => decideSkillCandidates(candidates, { activeForTask: { taskId: 'task-1', ids: [candidates[0].id] } }), /approval/i);
  const applied = decideSkillCandidates(candidates, { approvalPlanHash: proposed.planHash, applied: { planHash: proposed.planHash, ids: [candidates[0].id] } });
  assert.equal(applied.candidates[0].decision, 'applied');
  assert.deepEqual(applied.actionsPerformed, []);
});

test('approved artifacts reuse transactional generation and checker; stale source and approval fail closed', (context) => {
  const root = fixture(context);
  const source = skill(root, 'docs/ai/skills/read-safe', 'read-safe');
  const scan = scanProject(root);
  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const base = { ...defaultConfig(scan), clients: ['codex'] };
  const { config } = approvedConfig(base, scan, candidates);
  const artifacts = buildArtifacts(config, scan);
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  assert.ok(manifest.files.some((item) => item.path === 'docs/ai/agent-team.json'));
  const tampered = structuredClone(config);
  tampered.skillDiscovery.artifactPlan.cost.total.bytes += 1;
  assert.throws(() => buildArtifacts(tampered, scan), /planHash|approval/i);
  assert.throws(() => buildArtifacts({ ...config, artifactLanguage: 'zh-CN' }, scan), /planHash|approval/i);
  fs.appendFileSync(source, '\nChanged source after approval.\n');
  assert.throws(() => buildArtifacts(config, scanProject(root)), /source|digest|stale/i);
  assert.equal(checkProject(scanProject(root)).ok, false);
});

test('the existing transaction rolls back approved artifacts when an installed source changes before apply', (context) => {
  const root = fixture(context);
  const installed = fixture(context);
  const source = skill(installed, 'read-safe', 'read-safe');
  const scan = scanProject(root);
  const candidates = discoverSkills({ root, installedRoots: [installed], curatedCatalog: [], requiredCapabilities: [] });
  const { config } = approvedConfig({ ...defaultConfig(scan), clients: ['codex'] }, scan, candidates);
  const plan = planArtifacts(root, buildArtifacts(config, scan));
  assert.throws(() => applyArtifactPlan(root, plan, {
    transactional: true,
    beforeApply: () => fs.appendFileSync(source, '\nChanged after planning.\n'),
    verify: () => checkProject(scanProject(root)),
  }), /Post-apply verification failed/);
  for (const relative of ['.ai-governance/config.json', '.ai-governance/manifest.json', 'docs/ai/agent-team.json', 'docs/ai/skill-index.json']) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, relative);
  }
});

test('ordinary sync retains deselected managers and exact trusted prune removes only unchanged managed files', (context) => {
  const root = fixture(context);
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'] };
  const { config } = approvedConfig(base, scan);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const inactive = buildArtifacts(base, scanProject(root));
  const sync = planArtifacts(root, inactive);
  assert.equal(sync.operations.some((item) => item.remove), false);
  applyArtifactPlan(root, sync);
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/agent-team.json')), true);
  const prune = planArtifacts(root, inactive, { allowStaleRemoval: true });
  assert.equal(prune.conflicts.length, 0);
  assert.equal(prune.operations.filter((item) => item.remove).length, 4);
  fs.appendFileSync(path.join(root, 'docs/ai/agent-team.json'), '\nuser edit\n');
  const drifted = planArtifacts(root, inactive, { allowStaleRemoval: true });
  assert.ok(drifted.conflicts.some((item) => /agent-team.*changed/.test(item)));
  assert.equal(drifted.operations.some((item) => item.path === 'docs/ai/agent-team.json' && item.remove), false);
});

test('approved Standard and Complete costs are exact, capped, localized and outside ordinary context', (context) => {
  const root = fixture(context);
  const scan = scanProject(root);
  for (const governanceDepth of ['standard', 'complete']) {
    for (const artifactLanguage of ['en', 'zh-CN', 'bilingual']) {
      const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth, artifactLanguage };
      const { config, plan } = approvedConfig(base, scan);
      const artifacts = buildArtifacts(config, scan);
      assert.equal(artifacts.some((entry) => entry.path === 'docs/ai/anti-patterns.md'), false);
      assert.equal(artifacts.some((entry) => entry.path === 'docs/ai/skills/generic-unknown/SKILL.md'), false);
      const transaction = planArtifacts(root, artifacts);
      const bytes = transaction.operations.reduce((sum, item) => sum + Buffer.byteLength(item.desired), 0) + Buffer.byteLength(transaction.manifest.content);
      assert.equal(transaction.operations.length + 1, plan.cost.total.files);
      assert.equal(bytes, plan.cost.total.bytes);
      assert.ok(bytes <= (governanceDepth === 'standard' ? 96 : 128) * 1024);
      // The depth owns the tree: the delivery loop now ships by default in both Standard and
      // Complete, and this fixture also carries the four adaptive management artifacts. Both
      // depths land on the same 43 operations because the remaining Complete artifacts stay
      // lazy until the usage profile requests them. Tighten this deliberately, not by accident.
      assert.ok(transaction.operations.length <= 43, `${governanceDepth} ${artifactLanguage} operations ${transaction.operations.length}`);
      for (const artifact of artifacts.filter((item) => /\/(skill-discovery|team-orchestrator)\/SKILL.md$/.test(item.path))) {
        if (artifactLanguage !== 'en') assert.match(artifact.content, /审批/);
        assert.match(artifact.content, /planHash/);
      }
      const ordinary = (items) => {
        const text = items.find((item) => item.path === 'docs/ai/context-map.yaml').content;
        return [items.find((item) => item.path === 'AGENTS.md').content, text.slice(0, text.indexOf('profiles:')) + text.slice(text.indexOf('  ordinary:'), text.indexOf('  behavior_change:')), items.find((item) => item.path === 'docs/ai/rules/00_always.mdc').content];
      };
      assert.deepEqual(ordinary(artifacts), ordinary(buildArtifacts(base, scan)));
    }
  }
});

test('a canonical project Skill and its generated client adapter are one owner, not an unresolved conflict', (context) => {
  const root = fixture(context);
  const canonicalRelative = 'docs/ai/skills/standards/alpha/SKILL.md';
  const canonical = path.join(root, canonicalRelative);
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  const canonicalContent = '---\nname: alpha-standard\ndescription: Apply the alpha standard.\nversion: 1.0.0\ncapabilities: ["alpha-standard"]\npermissions: []\n---\n# Alpha standard\n';
  fs.writeFileSync(canonical, canonicalContent);

  const adapterRelative = '.agents/skills/standards/alpha/SKILL.md';
  const adapter = path.join(root, adapterRelative);
  fs.mkdirSync(path.dirname(adapter), { recursive: true });
  const adapterContent = skillAdapterContent(canonicalRelative, canonicalContent);
  fs.writeFileSync(adapter, adapterContent);
  fs.mkdirSync(path.join(root, '.ai-governance'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-governance', 'manifest.json'), JSON.stringify({
    schemaVersion: 1, generatedBy: TOOL_NAME, toolVersion: '0.0.0', templateVersion: 1,
    files: [{ path: adapterRelative, ownership: 'full', kind: 'technical-standard-adapter-skill', source: canonicalRelative, sha256: sha256(adapterContent) }],
  }));

  const candidates = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const owner = candidates.find((item) => item.capabilityOwner === 'alpha-standard');
  assert.equal(owner.source, `project:${canonicalRelative}`);
  assert.notEqual(owner.availability, 'needs-user-decision');
  assert.equal(owner.overlaps.length, 1);
  assert.equal(owner.overlaps[0].source, `project:${adapterRelative}`);

  // Approval must succeed even though the generated copy differs byte-for-byte.
  const decision = approvedDecision(candidates, [owner.id]);
  assert.equal(decision.status, 'approved');
  assert.equal(decision.candidates.find((item) => item.id === owner.id).decision, 'approved');
});

test('a recorded decision keeps its candidate visible past the bounded candidate list', (context) => {
  const root = fixture(context);
  for (let index = 0; index < 7; index += 1) skill(root, `docs/ai/skills/standards/standard-${index}`, `standard-${index}`);
  const allIds = Array.from({ length: 7 }, (_unused, index) => `clause-review-${sha256(`project:docs/ai/skills/standards/standard-${index}/SKILL.md`).slice(0, 12)}`);
  const capped = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [] });
  const dropped = allIds.filter((id) => !capped.some((item) => item.id === id));
  // The context budget keeps the discovery result bounded.
  assert.equal(capped.length, 5);
  assert.ok(dropped.length >= 2, 'seven candidates must exceed the five-slot budget');

  // A candidate that a stored approval already names must not fall out of the list.
  // Losing it turns a valid plan into an unknown id, and every later init fails with
  // "Adaptive decisions require unique known ids and add, defer or reject."
  const recordedId = dropped[0];
  const pinned = discoverSkills({ root, installedRoots: [], curatedCatalog: [], requiredCapabilities: [], keepIds: [recordedId] });
  assert.equal(pinned.length, 5);
  assert.ok(pinned.some((item) => item.id === recordedId), 'a recorded candidate must survive the context budget');
  const decision = approvedDecision(pinned, [recordedId]);
  assert.equal(decision.status, 'approved');
  assert.equal(decision.candidates.find((item) => item.id === recordedId).decision, 'approved');
});
