import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifyReviewMode } from '../../src/modules/governance/task-routing.mjs';
import { trustedProfessionalTaskContext } from '../../src/modules/governance/task-approval.mjs';
import { checkProject } from '../../src/checker.mjs';
import { scanProject } from '../../src/scanner.mjs';
import { decideSkillCandidates } from '../../src/skill-discovery.mjs';
import { proposeProjectAgentTeam } from '../../src/project-agent-team.mjs';

const cli = path.resolve('bin/aicg.js');
const managementPaths = ['docs/ai/skills/skill-discovery/SKILL.md', 'docs/ai/skills/team-orchestrator/SKILL.md', 'docs/ai/skill-index.json', 'docs/ai/agent-team.json'];

function fixture(context) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-adaptive-scenario-'));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root);
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, answers: path.join(parent, 'answers.json') };
}

function command(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
}

function output(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const start = result.stdout.indexOf('{\n  "dryRun"');
  return JSON.parse(start < 0 ? result.stdout : result.stdout.slice(start));
}

function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).sort().map((relative) => {
    const absolute = path.join(root, relative);
    return [relative, fs.statSync(absolute).isFile() ? fs.readFileSync(absolute).toString('base64') : 'directory'];
  });
}

function roleInput(domain = 'contract-law') {
  return {
    evidence: [{ id: 'decision.domain', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: domain, label: domain, evidenceIds: ['decision.domain'], jurisdiction: 'JP' }],
    roleNeeds: [{ id: 'project-domain-reviewer', title: 'Project domain review', capabilities: ['domain-review'], responsibilities: ['Identify issues for human review.'], outOfScope: ['Final professional judgment.'], domainNeedIds: [domain], evidenceIds: ['decision.domain'], skillIds: [], mustRemainIndependentFrom: [] }],
  };
}

function configFor(request = {}, extra = {}) {
  return {
    clients: ['codex'], stacks: ['generic-unknown'], governanceDepth: 'standard', artifactLanguage: 'en',
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null },
    domainConstraints: ['Professional conclusions require qualified-human review.'], confirmedRiskSignals: ['sensitive-data'],
    adaptiveGovernance: { installedRoots: [], curatedCatalog: [], requiredCapabilities: ['domain-review'], projectTeam: roleInput(), decisions: { skills: [], roles: [] }, activation: {}, ...request },
    ...extra,
  };
}

function writeAnswers(f, config) {
  fs.writeFileSync(f.answers, JSON.stringify(config));
}

function preview(f, config) {
  writeAnswers(f, config);
  return output(command(['init', f.root, '--yes', '--config', f.answers, '--dry-run']));
}

function selectedConfig(extra = {}) {
  return configFor({ decisions: { skills: [], roles: [{ id: 'project-domain-reviewer', action: 'add' }] }, activation: { 'project-domain-reviewer': { signals: ['sensitive-data'], paths: ['docs/contracts/**'] } } }, extra);
}

test('external config cannot manufacture an approved legal role without mandatory professional boundaries', (context) => {
  const f = fixture(context);
  const team = proposeProjectAgentTeam({ ...roleInput(), projectMode: 'greenfield' });
  Object.assign(team, { enabled: true, status: 'approved', planHash: 'b'.repeat(64), approval: { planHash: 'b'.repeat(64) }, professionalBoundaries: [] });
  Object.assign(team.roleProposals[0], { status: 'approved-available', approval: { source: 'user', evidenceId: 'owner.approval' }, professionalBoundaries: [] });
  delete team.roleProposals[0].professionalBoundary;
  const decision = decideSkillCandidates([]);
  const config = configFor({}, { agentTeam: team, skillDiscovery: { enabled: true, decision: decideSkillCandidates([], { approvalPlanHash: decision.planHash }) } });
  delete config.adaptiveGovernance;
  writeAnswers(f, config);
  const before = snapshot(f.root);
  const result = command(['init', f.root, '--yes', '--config', f.answers, '--dry-run']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /professional|boundary|approved project team/i);
  assert.deepEqual(snapshot(f.root), before);
});

for (const governanceDepth of ['minimal', 'standard']) test(`${governanceDepth} remembers exact all-reject decisions and reoffers changed evidence only`, (context) => {
  const f = fixture(context);
  const installed = path.join(f.parent, 'installed');
  fs.mkdirSync(path.join(installed, 'review'), { recursive: true });
  const source = path.join(installed, 'review/SKILL.md');
  fs.writeFileSync(source, '---\nname: review\ndescription: Review metadata.\nversion: 1.0.0\ncapabilities: ["domain-review"]\npermissions: ["read-project"]\n---\nReview only.\n');
  const config = configFor({ installedRoots: [installed] }, { governanceDepth });
  const initial = preview(f, config);
  const skillId = initial.adaptiveGovernance.skills.candidates[0].id;
  config.adaptiveGovernance.decisions = { skills: [{ id: skillId, action: 'reject' }], roles: [{ id: 'project-domain-reviewer', action: 'reject' }] };
  const rejected = preview(f, config);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', rejected.planHash]).status, 0);
  const stored = JSON.parse(fs.readFileSync(path.join(f.root, '.ai-governance/config.json')));
  assert.equal(stored.adaptiveDecisions?.skills[0].action, 'reject');
  assert.equal(stored.adaptiveDecisions?.roles[0].action, 'reject');
  for (const receipt of [...stored.adaptiveDecisions.skills, ...stored.adaptiveDecisions.roles]) assert.match(receipt.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(managementPaths.some((relative) => fs.existsSync(path.join(f.root, relative))), false);
  delete config.adaptiveGovernance.decisions;
  const again = preview(f, config);
  assert.equal(again.adaptiveGovernance.skills.candidates.some((entry) => entry.id === skillId), false);
  assert.equal(again.adaptiveGovernance.team.roleProposals.some((entry) => entry.id === 'project-domain-reviewer'), false);
  fs.appendFileSync(source, '\nNew evidence.\n');
  config.adaptiveGovernance.projectTeam.roleNeeds[0].responsibilities = ['Review changed scope.'];
  const changed = preview(f, config);
  assert.equal(changed.adaptiveGovernance.skills.candidates.some((entry) => entry.id === skillId), true);
  assert.equal(changed.adaptiveGovernance.team.roleProposals.some((entry) => entry.id === 'project-domain-reviewer'), true);
  assert.equal(changed.adaptiveGovernance.decisions.skills.find((entry) => entry.id === skillId).action, 'defer');
  assert.equal(changed.adaptiveGovernance.decisions.roles[0].action, 'defer');
  const forged = { ...config, adaptiveDecisions: stored.adaptiveDecisions };
  forged.adaptiveDecisions.roles[0].action = 'add';
  writeAnswers(f, forged);
  const before = snapshot(f.root);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--dry-run']).status, 2);
  assert.deepEqual(snapshot(f.root), before);
});

test('mixed add and reject decisions survive fresh requests while defer remains visible', (context) => {
  const f = fixture(context);
  const installed = path.join(f.parent, 'installed/review');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'SKILL.md'), '---\nname: review\ndescription: Review metadata.\nversion: 1.0.0\ncapabilities: ["domain-review"]\npermissions: []\n---\nReview.\n');
  const config = selectedConfig();
  config.adaptiveGovernance.installedRoots = [path.dirname(installed)];
  const initial = preview(f, config);
  const id = initial.adaptiveGovernance.skills.candidates[0].id;
  config.adaptiveGovernance.decisions.skills = [{ id, action: 'reject' }];
  const rejected = preview(f, config);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', rejected.planHash]).status, 0);
  delete config.adaptiveGovernance.decisions;
  delete config.adaptiveGovernance.activation;
  const again = preview(f, config);
  assert.equal(again.adaptiveGovernance.skills.candidates.some((entry) => entry.id === id), false);
  assert.equal(again.adaptiveGovernance.decisions.roles[0].action, 'add');
  config.adaptiveGovernance.decisions = { skills: [{ id, action: 'defer' }], roles: [{ id: 'project-domain-reviewer', action: 'add' }] };
  const deferred = preview(f, config);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', deferred.planHash]).status, 0);
  delete config.adaptiveGovernance.decisions;
  assert.equal(preview(f, config).adaptiveGovernance.skills.candidates.some((entry) => entry.id === id), true);
  config.adaptiveGovernance.projectTeam.roleNeeds[0].responsibilities = ['Review newly changed responsibilities.'];
  const changed = preview(f, config);
  assert.equal(changed.adaptiveGovernance.status, 'decision-refresh-required');
  assert.equal(changed.adaptiveGovernance.existingGovernance, 'unchanged');
  assert.equal(changed.adaptiveGovernance.team.roleProposals.length, 1);
  assert.equal(changed.adaptiveGovernance.decisions.roles[0].action, 'defer');
  assert.equal(changed.files.some((entry) => managementPaths.includes(entry.path)), false);
  const before = snapshot(f.root);
  for (const extra of [[], ['--dry-run']]) assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', changed.planHash, ...extra]).status, 2);
  assert.deepEqual(snapshot(f.root), before);
  config.adaptiveGovernance.decisions = { skills: [], roles: [{ id: 'project-domain-reviewer', action: 'add' }] };
  config.adaptiveGovernance.activation = { 'project-domain-reviewer': { signals: ['sensitive-data'], paths: ['docs/contracts/**'] } };
  const renewed = preview(f, config);
  assert.equal(renewed.adaptiveGovernance.status, 'recommendation');
  assert.notEqual(renewed.planHash, changed.planHash);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', renewed.planHash]).status, 0);
  assert.equal(checkProject(scanProject(f.root)).ok, true);
});

test('all-defer Minimal approval persists receipts without management artifacts and rejects config drift', (context) => {
  const f = fixture(context);
  const config = configFor({}, { governanceDepth: 'minimal' });
  const plan = preview(f, config);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--approve', plan.planHash]).status, 0);
  const file = path.join(f.root, '.ai-governance/config.json');
  const stored = JSON.parse(fs.readFileSync(file));
  assert.equal(stored.adaptiveDecisions.roles[0].action, 'defer');
  assert.equal(managementPaths.some((relative) => fs.existsSync(path.join(f.root, relative))), false);
  assert.equal(preview(f, config).adaptiveGovernance.team.roleProposals.length, 1);
  stored.adaptiveDecisions.roles[0].action = 'reject';
  fs.writeFileSync(file, JSON.stringify(stored));
  const before = snapshot(f.root);
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers, '--dry-run']).status, 2);
  assert.deepEqual(snapshot(f.root), before);
});

test('greenfield preview exposes bounded offline recommendations, open professional gaps and one exact approval without preselection', (context) => {
  const f = fixture(context);
  const config = configFor({ installedRoots: [path.join(f.parent, 'unavailable')] });
  const before = snapshot(f.root);
  const result = preview(f, config);
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(result.adaptiveGovernance.status, 'recommendation');
  assert.ok(result.adaptiveGovernance.skills.candidates.length <= 5);
  assert.ok(result.adaptiveGovernance.skills.sourceStatus.some((item) => item.status === 'unavailable'));
  assert.equal(result.adaptiveGovernance.team.projectMode, 'greenfield');
  assert.equal(result.adaptiveGovernance.team.roleProposals[0].professionalBoundary.qualification, 'licensed-lawyer');
  assert.equal(result.adaptiveGovernance.team.roleProposals[0].professionalBoundary.humanReviewRequired, true);
  assert.ok(result.adaptiveGovernance.professionalReviewGaps.some((item) => item.qualification === 'licensed-lawyer'));
  assert.equal(result.adaptiveGovernance.decisions.roles[0].action, 'defer');
  assert.equal(result.files.some((item) => managementPaths.includes(item.path)), false);
  assert.equal(result.contextCost.ordinary.files, 3);
  assert.ok(result.contextCost.ordinary.estimatedTokens <= 900);
  assert.deepEqual(result.adaptiveGovernance.actionsPerformed, []);
  assert.match(result.planHash, /^[a-f0-9]{64}$/);
  assert.equal((JSON.stringify(result).match(/"planHash":/g) ?? []).length, 1);
  assert.deepEqual(result.requiredPermissions, ['write-governance']);
});

test('restaurant website stays outside food safety until the owner confirms allergen or back-of-house scope', (context) => {
  const f = fixture(context);
  const website = preview(f, configFor({ projectTeam: roleInput('restaurant-operations') }));
  assert.equal(JSON.stringify(website.adaptiveGovernance).includes('food-safety'), false);
  const kitchen = preview(f, configFor({ projectTeam: roleInput('food-safety') }));
  assert.equal(kitchen.adaptiveGovernance.team.roleProposals[0].professionalBoundary.qualification, 'qualified-food-safety-professional');
  assert.ok(kitchen.adaptiveGovernance.professionalReviewGaps.length > 0);
});

test('brownfield repository domain candidates remain unconfirmed under the same proposal schema', (context) => {
  const f = fixture(context);
  fs.mkdirSync(path.join(f.root, 'src'));
  fs.writeFileSync(path.join(f.root, 'src/legacy.mjs'), 'export const legacy = true;\n');
  const before = snapshot(f.root);
  const result = preview(f, configFor({
    projectTeam: { evidence: [{ id: 'repository.contracts', kind: 'repository-fact' }], confirmedDomainNeeds: [], roleNeeds: [] },
    domainCandidates: [{ id: 'contract-law', label: 'Possible contract scope', evidenceIds: ['repository.contracts'] }],
  }, { initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  assert.equal(result.adaptiveGovernance.team.teamType, 'project-ai-agent-team');
  assert.equal(result.adaptiveGovernance.team.projectMode, 'brownfield');
  assert.equal(result.adaptiveGovernance.team.roleProposals.length, 0);
  assert.equal(result.adaptiveGovernance.domainCandidates[0].status, 'proposed-unconfirmed');
  assert.deepEqual(snapshot(f.root), before);
});

for (const governanceDepth of ['standard', 'complete']) {
  test(`${governanceDepth} writes four approved artifacts through the existing transaction and trusted professional routing`, (context) => {
    const f = fixture(context);
    const config = selectedConfig({ governanceDepth });
    const result = preview(f, config);
    assert.ok(result.contextCost.management.total, JSON.stringify(result));
    assert.ok(result.contextCost.management.total.files <= 26);
    assert.ok(result.contextCost.management.total.bytes <= (governanceDepth === 'standard' ? 64 : 96) * 1024);
    assert.ok(result.contextCost.management.increment.managerTokens <= 800);
    assert.deepEqual(result.files.filter((item) => managementPaths.includes(item.path)).map((item) => item.path).sort(), [...managementPaths].sort());
    const before = snapshot(f.root);
    const unapproved = output(command(['init', f.root, '--yes', '--config', f.answers]));
    assert.equal(unapproved.approvalRequired, true);
    assert.deepEqual(snapshot(f.root), before);
    const applied = command(['init', f.root, '--yes', '--config', f.answers, '--approve', result.planHash]);
    assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
    for (const relative of managementPaths) assert.equal(fs.existsSync(path.join(f.root, relative)), true);
    const stored = JSON.parse(fs.readFileSync(path.join(f.root, '.ai-governance/config.json'), 'utf8'));
    const roster = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/ai/agent-team.json'), 'utf8'));
    assert.equal(roster.roles[0].status, 'approved-available');
    assert.equal(roster.roles[0].approval.source, 'user');
    assert.match(roster.roles[0].approval.evidenceId, /^[a-zA-Z0-9:._-]+$/);
    assert.deepEqual(roster.roles[0].activation, config.adaptiveGovernance.activation['project-domain-reviewer']);
    assert.equal(roster.roles[0].professionalBoundaries[0].humanReviewRequired, true);
    assert.equal(checkProject(scanProject(f.root)).ok, true);
    const trusted = trustedProfessionalTaskContext(f.root, stored, ['docs/contracts/terms.md']);
    assert.equal(trusted.professionalGap, null);
    assert.equal(trusted.professionalBoundaries[0].qualification, 'licensed-lawyer');
    const unrelated = trustedProfessionalTaskContext(f.root, stored, ['docs/unrelated.md']);
    assert.deepEqual(unrelated.professionalBoundaries, []);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.root, '.ai-governance/manifest.json'), 'utf8'));
    assert.equal(manifest.files.find((item) => item.path === 'docs/ai/agent-team.json').ownership, 'full');
    for (const relative of ['docs/ai/bootstrap-prompt.md', 'reviews/.gitkeep', 'reports/.gitkeep', 'docs/ai/skills/business-constraints/SKILL.md', '.agents/skills/business-constraints/SKILL.md']) {
      assert.equal(fs.existsSync(path.join(f.root, relative)), false);
      for (const file of ['docs/ai/README.md', 'docs/ai/context-map.yaml']) assert.equal(fs.readFileSync(path.join(f.root, file), 'utf8').includes(relative), false);
    }
    const routes = fs.readFileSync(path.join(f.root, 'docs/ai/context-map.yaml'), 'utf8');
    assert.match(routes, /business:\n\s+- docs\/ai\/skills\/team-orchestrator\/SKILL.md\n\s+- docs\/ai\/business-constraints.json/);
    assert.match(fs.readFileSync(path.join(f.root, managementPaths[1]), 'utf8'), /risk-evidence.json/);
  });
}

test('Minimal never materializes management artifacts and stale exact approval causes zero writes', (context) => {
  const f = fixture(context);
  const minimal = preview(f, selectedConfig({ governanceDepth: 'minimal' }));
  assert.equal(minimal.files.some((item) => managementPaths.includes(item.path)), false);
  const result = preview(f, selectedConfig());
  const before = snapshot(f.root);
  const stale = command(['init', f.root, '--yes', '--config', f.answers, '--approve', '0'.repeat(64)]);
  assert.equal(stale.status, 2);
  assert.deepEqual(snapshot(f.root), before);
  const changed = selectedConfig();
  changed.adaptiveGovernance.activation['project-domain-reviewer'].paths = ['docs/changed/**'];
  writeAnswers(f, changed);
  const scopeChanged = command(['init', f.root, '--yes', '--config', f.answers, '--approve', result.planHash]);
  assert.equal(scopeChanged.status, 2);
  assert.deepEqual(snapshot(f.root), before);
});

test('malformed explicit adaptive input cannot fall through to legacy --yes writes', (context) => {
  const f = fixture(context);
  for (const adaptiveGovernance of [null, false, 0, [], { curatedCatalog: [] }]) {
    writeAnswers(f, { clients: ['codex'], stacks: ['generic-unknown'], adaptiveGovernance });
    const result = command(['init', f.root, '--yes', '--config', f.answers]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(snapshot(f.root), []);
  }
});

test('sync config requests preview until exact approval while ordinary sync remains compatible', (context) => {
  const f = fixture(context);
  const initial = command(['init', f.root, '--yes', '--clients', 'codex']);
  assert.equal(initial.status, 0, initial.stderr);
  const ordinary = command(['sync', f.root]);
  assert.equal(ordinary.status, 0, ordinary.stderr);
  const before = snapshot(f.root);
  writeAnswers(f, configFor());
  const previewed = output(command(['sync', f.root, '--config', f.answers]));
  assert.equal(previewed.approvalRequired, true);
  assert.deepEqual(snapshot(f.root), before);
  assert.match(previewed.planHash, /^[a-f0-9]{64}$/);
  const applied = command(['sync', f.root, '--config', f.answers, '--approve', previewed.planHash]);
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
  assert.equal(checkProject(scanProject(f.root)).ok, true);
});

test('Chinese governance localizes generated manager and professional prose without translating machine contracts', (context) => {
  const f = fixture(context);
  const result = preview(f, selectedConfig({ artifactLanguage: 'zh-CN' }));
  const applied = command(['init', f.root, '--yes', '--config', f.answers, '--approve', result.planHash]);
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
  for (const relative of managementPaths.filter((value) => value.endsWith('SKILL.md'))) assert.match(fs.readFileSync(path.join(f.root, relative), 'utf8'), /审批/);
  const roster = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/ai/agent-team.json'), 'utf8'));
  assert.equal(roster.teamType, 'project-ai-agent-team');
  assert.equal(roster.roles[0].professionalBoundaries[0].qualification, 'licensed-lawyer');
  assert.match(roster.roles[0].professionalBoundaries[0].reason, /真人/);
});

test('an unselected offline Skill source change invalidates the whole CLI approval with zero writes', (context) => {
  const f = fixture(context);
  const installed = path.join(f.parent, 'installed');
  fs.mkdirSync(path.join(installed, 'candidate'), { recursive: true });
  const source = path.join(installed, 'candidate/SKILL.md');
  fs.writeFileSync(source, '---\nname: candidate\ndescription: Review domain evidence.\nversion: 1\ncapabilities: ["domain-review"]\npermissions: ["read-project"]\n---\nOffline body.\n');
  const config = selectedConfig();
  config.adaptiveGovernance.installedRoots = [installed];
  const result = preview(f, config);
  assert.equal(result.adaptiveGovernance.skills.candidates.length, 1);
  assert.equal(result.adaptiveGovernance.decisions.skills[0].action, 'defer');
  const before = snapshot(f.root);
  fs.appendFileSync(source, 'Changed after preview.\n');
  const stale = command(['init', f.root, '--yes', '--config', f.answers, '--approve', result.planHash]);
  assert.equal(stale.status, 2, stale.stderr);
  assert.deepEqual(snapshot(f.root), before);
});

test('existing Minimal governance upgrades with selected roles only after exact sync approval', (context) => {
  const f = fixture(context);
  writeAnswers(f, { clients: ['codex'], stacks: ['generic-unknown'], governanceDepth: 'minimal', artifactLanguage: 'en' });
  assert.equal(command(['init', f.root, '--yes', '--config', f.answers]).status, 0);
  writeAnswers(f, selectedConfig());
  const before = snapshot(f.root);
  const result = output(command(['sync', f.root, '--config', f.answers]));
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(result.files.filter((entry) => managementPaths.includes(entry.path)).length, 4);
  const applied = command(['sync', f.root, '--config', f.answers, '--approve', result.planHash]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(checkProject(scanProject(f.root)).ok, true);
  const rosterPath = path.join(f.root, 'docs/ai/agent-team.json');
  fs.unlinkSync(rosterPath);
  const drifted = snapshot(f.root);
  const repair = output(command(['sync', f.root]));
  assert.equal(repair.approvalRequired, true);
  assert.deepEqual(snapshot(f.root), drifted);
  const repaired = command(['sync', f.root, '--approve', repair.planHash]);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(checkProject(scanProject(f.root)).ok, true);
});

test('historical Standard artifacts cause an explicit budget-blocked preview without deleting seeds', (context) => {
  const f = fixture(context);
  assert.equal(command(['init', f.root, '--yes', '--clients', 'codex']).status, 0);
  writeAnswers(f, selectedConfig({ governanceDepth: 'complete' }));
  const before = snapshot(f.root);
  const result = output(command(['sync', f.root, '--config', f.answers]));
  assert.equal(result.adaptiveGovernance.status, 'budget-blocked');
  assert.ok(result.adaptiveGovernance.budget.proposedCost.total.files > 26);
  assert.ok(result.adaptiveGovernance.manualCleanup.paths.includes('docs/ai/bootstrap-prompt.md'));
  assert.equal(result.adaptiveGovernance.manualCleanup.authorization, 'separate-explicit-approval-required');
  const applied = command(['sync', f.root, '--config', f.answers, '--approve', result.planHash]);
  assert.equal(applied.status, 2, applied.stderr);
  assert.deepEqual(snapshot(f.root), before);
});

test('forward routing keeps L0/L1 single and ordinary L2 independently reviewed, with PK for stronger evidence', () => {
  for (const taskLevel of ['L0', 'L1', 'L2']) {
    const review = classifyReviewMode({ taskLevel, plannedPaths: taskLevel === 'L2' ? ['src/local.mjs'] : ['README.md'] });
    assert.equal(review.mode, taskLevel === 'L2' ? 'quick-review' : 'single');
    assert.equal(review.requiredRoleCount, taskLevel === 'L2' ? 2 : 1);
  }
  assert.equal(classifyReviewMode({ taskLevel: 'L2', behaviorChange: true }).mode, 'quick-review');
  assert.equal(classifyReviewMode({ taskLevel: 'L2', publicContract: true }).mode, 'independent-pk');
  assert.equal(classifyReviewMode({ taskLevel: 'L3', multiSurface: true }).mode, 'high-consequence-pk');
});
