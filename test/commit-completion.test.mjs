import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PRE_COMMIT_HOOK_MARKER, runCompletion } from '../src/commit-completion.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { minimumTaskLevelFromPaths } from '../src/modules/governance/index.mjs';
import { buildApprovedProjectAgentTeam, proposeProjectAgentTeam } from '../src/project-agent-team.mjs';
import { memoryFixture } from './helpers/memory-fixture.mjs';
import { scanProjectMemoryFacts, buildMemoryArtifacts } from '../src/modules/memory/index.mjs';
import { prepareCompletionUnit } from './helpers/work-unit-fixture.mjs';

const cli = path.resolve('bin/aicg.js');

test('completion reports stale owning memory and exempts test-only and formatting changes', (context) => {
  const root = memoryFixture(context);
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  baseline(root);
  write(root, 'test/widgets.test.mjs', '// test-only refinement\n');
  assert.deepEqual(runCompletion(root, { taskLevel: 'L1' }).memory.issues, []);
  write(root, 'src/server/service.mjs', 'export function listWidgets( ) {\n return [];\n}\n');
  assert.deepEqual(runCompletion(root, { taskLevel: 'L2' }).memory.issues, []);
  write(root, 'src/server/service.mjs', 'export function listWidgets() { return [1]; }\n');
  const result = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(result.ok, false);
  assert.ok(result.memory.issues.some((issue) => /stale/.test(issue)));
});

test('default memory blocks unowned implementation and accepts the correct evidence update', (context) => {
  const root = fixture('new-memory-owner');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  baseline(root);
  write(root, 'src/new.mjs', 'export function value() { return 1; }\n');
  assert.ok(runCompletion(root, { taskLevel: 'L2' }).memory.issues.some((issue) => /unowned/.test(issue)));
  const current = scanProject(root);
  for (const artifact of buildMemoryArtifacts(config, current, scanProjectMemoryFacts(current)).artifacts) write(root, artifact.path, artifact.content);
  assert.deepEqual(runCompletion(root, { taskLevel: 'L2' }).memory.issues, []);
});

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-completion-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function initialize(root, artifactLanguage) {
  // These fixtures isolate unrelated approval/verification gates. Dedicated tests
  // above exercise the default memory contract and its full implementation diff.
  const answersPath = path.join(root, 'answers.json');
  fs.writeFileSync(answersPath, JSON.stringify({ ...(artifactLanguage ? { artifactLanguage } : {}), features: { knowledge: false }, initialization: { lifecycle: 'greenfield', existingCodeStrategy: null } }));
  const options = ['--config', answersPath];
  const result = run(['init', root, '--clients', 'all', '--yes', '--no-assist', ...options]);
  assert.equal(result.status, 0, result.stderr);
  baseline(root);
}

function baseline(root) {
  for (const args of [
    ['init'], ['config', 'user.email', 'aicg@example.test'], ['config', 'user.name', 'AICG Test'],
    ['add', '--all'], ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'completion baseline'],
  ]) {
    const result = git(root, args);
    assert.equal(result.status, 0, result.stderr);
  }
}

function write(root, relative, content = 'export const value = true;\n') {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}

// Explicit test-owner approvals, separate from completion itself. Persist the
// reference paths before requesting the plan so its path binding is exact.
function approvalOptions(root, options = {}) {
  const prepared = prepareCompletionUnit(root, options);
  options = prepared.options;
  const reference = 'docs/ai/task-approval/approved.md';
  const approvalEvidence = 'docs/ai/task-approval/evidence.json';
  write(root, reference, '# Test-owner approved requirements, design and plan\n');
  write(root, approvalEvidence, '{}\n');
  if (options.fromGitHook) assert.equal(git(root, ['add', reference, approvalEvidence]).status, 0);
  const preview = runCompletion(root, { ...options, verificationCommand: null });
  let plan = preview.taskApproval.plan;
  const evidence = {
    schemaVersion: 1, planHash: '0'.repeat(64), reviewEvidence: {}, professionalBoundaries: [],
    approvals: plan.requiredApprovals.map((id) => {
      const selected = /^(proposal-|referee|implementation$|targeted-review$)/.test(id) ? `docs/ai/task-approval/${id}.md` : reference;
      if (selected !== reference) write(root, selected, `# Independent ${id} findings\n`);
      if (options.fromGitHook) assert.equal(git(root, ['add', selected]).status, 0);
      return { id, reference: selected, sha256: sha256(fs.readFileSync(path.join(root, selected))), source: 'operator-declared', participantId: id };
    }),
  };
  write(root, approvalEvidence, JSON.stringify(evidence));
  if (options.fromGitHook) assert.equal(git(root, ['add', approvalEvidence]).status, 0);
  plan = runCompletion(root, { ...options, verificationCommand: null, approvalEvidence }).taskApproval.plan;
  evidence.planHash = plan.planHash;
  write(root, approvalEvidence, JSON.stringify(evidence));
  if (options.fromGitHook) assert.equal(git(root, ['add', approvalEvidence]).status, 0);
  prepared.finalize(plan.planHash);
  return { taskLevel: plan.taskLevel, reviewMode: plan.reviewMode, approvalEvidence, approve: plan.planHash, ...options };
}

function runApproved(args) {
  assert.equal(args[0], 'complete');
  const verifyIndex = args.indexOf('--verify');
  const options = approvalOptions(args[1], verifyIndex >= 0 ? { verificationCommand: args[verifyIndex + 1] } : {});
  return run([...args, '--task-level', options.taskLevel, '--review-mode', options.reviewMode, '--approval-evidence', options.approvalEvidence, '--approve', options.approve, ...(options.workUnit ? ['--work-unit', options.workUnit] : []), ...(verifyIndex < 0 && options.verificationCommand ? ['--verify', options.verificationCommand] : [])]);
}

test('ignored reference replacement invalidates exact approval with unchanged Git scope', (context) => {
  const root = fixture('ignored-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.appendFileSync(path.join(root, '.gitignore'), '\n/docs/ai/task-approval/\n');
  baseline(root);
  write(root, 'src/widget.mjs', 'export const value = 1;\n');
  const options = approvalOptions(root, { taskLevel: 'L2' });
  const before = runCompletion(root, options);
  assert.equal(before.taskApproval.status, 'approved');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, options.approvalEvidence), 'utf8'));
  const reference = receipt.approvals[0].reference;
  write(root, reference, '# Replaced ignored requirement, plan and initial tests\n');
  for (const record of receipt.approvals.filter((item) => item.reference === reference)) record.sha256 = sha256(fs.readFileSync(path.join(root, reference)));
  write(root, options.approvalEvidence, JSON.stringify(receipt));
  const after = runCompletion(root, options);
  assert.equal(after.taskApproval.plan.changeDigest, before.taskApproval.plan.changeDigest);
  assert.notEqual(after.taskApproval.plan.planHash, before.taskApproval.plan.planHash);
  assert.equal(after.taskApproval.status, 'stale-plan');
});

test('approval binds same-path staged unstaged and untracked content plus verification rewrites', (context) => {
  const root = fixture('content-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').appendFileSync(\'src/modules/widget/index.mjs\', \'\\n// rewritten\')"' } }));
  assert.equal(run(['sync', root]).status, 0);
  baseline(root);
  for (const kind of ['unstaged', 'staged', 'untracked']) {
    const relative = kind === 'untracked' ? 'src/modules/widget/new.mjs' : 'src/modules/widget/index.mjs';
    write(root, relative, 'export const n = 1;\n');
    if (kind === 'staged') assert.equal(git(root, ['add', relative]).status, 0);
    const options = approvalOptions(root, { taskLevel: 'L2' });
    assert.match(runCompletion(root, options).taskApproval.plan.changeDigest, /^[a-f0-9]{64}$/);
    write(root, relative, 'export const n = 2;\n');
    if (kind === 'staged') assert.equal(git(root, ['add', relative]).status, 0);
    assert.equal(runCompletion(root, options).taskApproval.status, 'stale-plan', kind);
  }
  const options = approvalOptions(root, { taskLevel: 'L2' });
  const verified = runCompletion(root, { ...options, verificationCommand: 'npm test' });
  assert.equal(verified.projectVerification.status, 'passed');
  assert.equal(verified.taskApproval.status, 'stale-plan');
  assert.equal(verified.ok, false);
});

function trustedProfessionalRoster(root, activation) {
  const relative = 'docs/ai/agent-team.json';
  const team = buildApprovedProjectAgentTeam(proposeProjectAgentTeam({ projectMode: 'greenfield', evidence: [{ id: 'owner.domain', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Legal scope', evidenceIds: ['owner.domain'], jurisdiction: 'JP' }],
    roleNeeds: [{ id: 'legal-reviewer', title: 'Legal reviewer', capabilities: ['legal-review'], responsibilities: ['Review risks.'], outOfScope: ['Final advice.'], domainNeedIds: ['contract-law'], evidenceIds: ['owner.domain'], skillIds: [], mustRemainIndependentFrom: [] }],
  }), { selectedIds: ['legal-reviewer'], approvalEvidenceId: 'decision.legal', activation: activation ? { 'legal-reviewer': activation } : {} });
  const roster = { ...team, roles: team.roleProposals };
  write(root, relative, JSON.stringify(roster));
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files.push({ path: relative, ownership: 'full', kind: 'agent-team', source: 'approved-project-roles', sha256: sha256(fs.readFileSync(path.join(root, relative))) });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  baseline(root);
}

for (const scope of [
  { name: 'production source', path: 'src/modules/legal/index.mjs', pattern: 'src/modules/legal/**', level: 'L2', unrelated: 'src/modules/widget/index.mjs' },
  { name: 'L1 contract document', path: 'docs/contracts/terms.md', pattern: 'docs/contracts/**', level: 'L1', unrelated: 'docs/guide.md' },
]) test(`explicit professional activation on ${scope.name} requires qualified human approval without an operator risk declaration`, (context) => {
  const root = fixture('trusted-professional');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Only approved actors may edit contracts.'], ['authorization']);
  trustedProfessionalRoster(root, { signals: ['authorization'], paths: [scope.pattern] });
  write(root, scope.path);
  assert.equal(minimumTaskLevelFromPaths([scope.path]), scope.level);
  const options = approvalOptions(root, { taskLevel: 'L2' });
  const result = runCompletion(root, options);
  assert.equal(result.ok, false);
  assert.equal(result.taskApproval.status, 'professional-review-gap');
  assert.equal(result.taskApproval.review.mode, 'high-consequence-pk');
  assert.ok(result.taskApproval.plan.requiredApprovals.includes('human:contract-law'));
  assert.equal(result.taskApproval.plan.professionalBoundaries[0].qualification, 'licensed-lawyer');
  const evidencePath = path.join(root, options.approvalEvidence);
  const evidence = JSON.parse(fs.readFileSync(evidencePath));
  Object.assign(evidence.approvals.find((record) => record.id === 'human:contract-law'), {
    qualification: 'licensed-lawyer', jurisdiction: 'JP', responsibleHuman: 'Owner-declared licensed reviewer',
  });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  const current = runCompletion(root, options).taskApproval.plan;
  evidence.planHash = current.planHash;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  if (options.workUnit) {
    const unit = JSON.parse(fs.readFileSync(path.join(root, options.workUnit)));
    unit.approvalPlanHash = current.planHash;
    write(root, options.workUnit, JSON.stringify(unit));
  }
  const satisfied = runCompletion(root, { ...options, approve: current.planHash });
  assert.equal(satisfied.ok, true, JSON.stringify(satisfied));
  assert.equal(satisfied.taskApproval.identityVerified, false);
  baseline(root);
  write(root, scope.unrelated);
  const unrelated = runCompletion(root, approvalOptions(root, { taskLevel: 'L2' }));
  assert.equal(unrelated.ok, true, JSON.stringify(unrelated));
  assert.equal(unrelated.taskApproval.review.mode, scope.name === 'production source' ? 'quick-review' : 'single');
  assert.deepEqual(unrelated.taskApproval.plan.requiredApprovals, scope.name === 'production source' ? ['implementation', 'plan', 'requirements', 'targeted-review'] : ['plan', 'requirements']);
});

test('trusted professional scope without an explicit applicability mapping cannot silently pass', (context) => {
  const root = fixture('unmapped-professional');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Confirmed professional project.'], ['authorization']);
  trustedProfessionalRoster(root);
  write(root, 'src/modules/widget/index.mjs');
  const result = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(result.ok, false);
  assert.equal(result.taskApproval.status, 'professional-review-gap');
});

test('project public and external risk flags do not request PK for unrelated docs but real public contracts do', (context) => {
  const root = fixture('task-risk-applicability');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['External and public operations require approval.'], ['public-api', 'external-side-effect', 'sensitive-data']);
  trustedProfessionalRoster(root, { signals: ['sensitive-data'], paths: ['docs/contracts/**'] });
  write(root, 'docs/unrelated.md', '# Corrected wording\n');
  const docs = runCompletion(root, { taskLevel: 'L3' });
  assert.equal(docs.taskApproval.review.mode, 'single');
  assert.equal(docs.taskRoute.minimumLevel, 'L1');
  assert.deepEqual(docs.taskApproval.plan.requiredApprovals, ['design', 'plan', 'requirements']);
  baseline(root);
  write(root, 'schema.proto', 'syntax = "proto3";\n');
  const contract = runCompletion(root, { taskLevel: 'L3' });
  assert.equal(contract.taskApproval.review.mode, 'independent-pk');
  assert.ok(contract.taskApproval.plan.requiredApprovals.includes('proposal-1'));
  assert.ok(contract.taskApproval.plan.requiredApprovals.includes('referee'));
});

test('unmapped ordinary documentation keeps its L1 single-review flow', (context) => {
  const root = fixture('professional-docs');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  trustedProfessionalRoster(root);
  write(root, 'README.md', '# Local documentation fix\n');
  const result = runCompletion(root, { taskLevel: 'L1' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.taskRoute.minimumLevel, 'L1');
  assert.equal(result.taskApproval.review.mode, 'single');
  assert.equal(result.taskApproval.status, 'not-required');
  assert.equal(result.taskApproval.plan.professionalBoundaries.length, 0);
});

test('trusted professional roster rejects conflicting singular and plural boundaries', (context) => {
  const root = fixture('professional-conflict');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  trustedProfessionalRoster(root, { signals: ['authorization'], paths: ['src/modules/legal/**'] });
  const relative = 'docs/ai/agent-team.json';
  const roster = JSON.parse(fs.readFileSync(path.join(root, relative)));
  roster.roles[0].professionalBoundary = roster.roles[0].professionalBoundaries[0];
  roster.roles[0].professionalBoundaries = [];
  write(root, relative, JSON.stringify(roster));
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files.find((entry) => entry.path === relative).sha256 = sha256(fs.readFileSync(path.join(root, relative)));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  baseline(root);
  write(root, 'src/modules/legal/index.mjs');
  const result = runCompletion(root, approvalOptions(root, { taskLevel: 'L2' }));
  assert.equal(result.ok, false);
  assert.equal(result.taskApproval.status, 'professional-review-gap');
});

test('the installed hook accepts only explicit safe approval environment values', (context) => {
  const root = fixture('hook-approval-env');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  assert.equal(run(['hook', 'install', root, '--yes', '--json']).status, 0);
  write(root, 'src/modules/widget/index.mjs');
  assert.equal(git(root, ['add', 'src/modules/widget/index.mjs']).status, 0);
  const options = approvalOptions(root, { taskLevel: 'L2', fromGitHook: true });
  const env = { ...process.env, AICG_TASK_LEVEL: options.taskLevel, AICG_REVIEW_MODE: options.reviewMode, AICG_APPROVAL_EVIDENCE: options.approvalEvidence, AICG_APPROVE: options.approve, AICG_WORK_UNIT: options.workUnit };
  const invoke = (values) => spawnSync(path.join(root, '.git/hooks/pre-commit'), [], { cwd: root, env: values, encoding: 'utf8' });
  const approved = invoke(env);
  assert.equal(approved.status, 0, approved.stdout + approved.stderr);
  assert.notEqual(invoke({ ...env, AICG_APPROVE: '0'.repeat(64) }).status, 0);
  assert.notEqual(invoke({ ...env, AICG_TASK_LEVEL: '' }).status, 0);
  assert.notEqual(invoke({ ...env, AICG_APPROVAL_EVIDENCE: '$(touch env-injection)' }).status, 0);
  assert.equal(fs.existsSync(path.join(root, 'env-injection')), false);
  write(root, 'src/modules/widget/index.mjs', 'export const changed = true;\n');
  assert.equal(invoke(env).status, 0, 'unstaged source must not alter hook approval');
  assert.equal(git(root, ['add', 'src/modules/widget/index.mjs']).status, 0);
  assert.notEqual(invoke(env).status, 0, 'staging changed bytes invalidates the old plan');
});

test('production completion cannot pass with an omitted task declaration or missing approval evidence', (context) => {
  const root = fixture('required-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  const omitted = runCompletion(root);
  assert.equal(omitted.ok, false);
  assert.equal(omitted.taskRoute.status, 'unverified-declaration');
  const missing = runCompletion(root, { taskLevel: 'L2', reviewMode: 'single' });
  assert.equal(missing.ok, false);
  assert.equal(missing.taskApproval.status, 'review-upgrade-required');
  assert.equal(missing.taskApproval.review.mode, 'single');
  assert.equal(missing.harvest.status, 'skipped');
});

test('complete accepts explicit review and approval flags but rejects stale evidence', (context) => {
  const root = fixture('approval-flags');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  write(root, 'approval.json', JSON.stringify({ schemaVersion: 1, planHash: '0'.repeat(64), reviewEvidence: {}, professionalBoundaries: [], approvals: [] }));
  const result = run(['complete', root, '--task-level', 'L2', '--review-mode', 'quick-review', '--approval-evidence', 'approval.json', '--approve', '0'.repeat(64), '--json']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).taskApproval.status, 'stale-plan');
});

test('completion rereads final approval references and recomputes path and review bindings', (context) => {
  const root = fixture('final-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'package.json', JSON.stringify({ scripts: {
    'test:path': 'node -e "require(\'fs\').writeFileSync(\'README.md\', \'new path\')"',
    'test:review': 'node -e "require(\'fs\').writeFileSync(\'schema.proto\', \'new contract\')"',
    'test:reference': 'node -e "require(\'fs\').appendFileSync(\'docs/ai/task-approval/approved.md\', \'stale\')"',
  } }));
  assert.equal(run(['sync', root]).status, 0);
  baseline(root);
  write(root, 'src/modules/widget/index.mjs');
  for (const [command, status] of [['test:path', 'stale-plan'], ['test:review', 'review-upgrade-required'], ['test:reference', 'invalid-evidence']]) {
    const options = approvalOptions(root, { taskLevel: 'L2' });
    const manifest = fs.readFileSync(path.join(root, '.ai-governance/manifest.json'));
    const result = runCompletion(root, { ...options, verificationCommand: `npm run ${command}` });
    assert.equal(result.projectVerification.status, 'passed');
    assert.equal(result.taskApproval.status, status);
    assert.equal(result.ok, false);
    assert.equal(result.harvest.status, 'skipped');
    assert.deepEqual(result.harvest.candidates, []);
    assert.deepEqual(fs.readFileSync(path.join(root, '.ai-governance/manifest.json')), manifest);
  }
});

test('hook approval gate reads only staged evidence and manual gate sees worktree mismatches', (context) => {
  const root = fixture('staged-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  assert.equal(git(root, ['add', 'src/modules/widget/index.mjs']).status, 0);
  const options = approvalOptions(root, { taskLevel: 'L2', fromGitHook: true });
  write(root, options.approvalEvidence, '{');
  write(root, 'docs/ai/task-approval/approved.md', 'unapproved worktree change');
  write(root, 'db/migrations/001.sql', 'select 1;');
  const hook = runCompletion(root, options);
  assert.equal(hook.ok, true, JSON.stringify(hook));
  assert.equal(hook.taskApproval.status, 'approved');
  const manual = runCompletion(root, { ...options, fromGitHook: false });
  assert.equal(manual.ok, false);
  assert.equal(manual.taskApproval.status, 'invalid-evidence');
  assert.equal(manual.taskRoute.minimumLevel, 'L3');
});

for (const [mutation, body, taskLevel] of [
  ['untracked-risk', "fs.mkdirSync('db/migrations', { recursive: true }); fs.writeFileSync('db/migrations/001.sql', 'select 1;');", 'L1'],
  ['unstaged-risk', "fs.appendFileSync('src/modules/session/auth.mjs', '\\nexport const changed = true;');", 'L2'],
  ['staged-risk', "fs.appendFileSync('src/modules/session/auth.mjs', '\\nexport const changed = true;'); require('node:child_process').execFileSync('git', ['add', 'src/modules/session/auth.mjs']);", 'L2'],
  ['staged-reversed-in-worktree', "const p = 'src/modules/session/auth.mjs'; const before = fs.readFileSync(p); fs.appendFileSync(p, '\\nexport const changed = true;'); require('node:child_process').execFileSync('git', ['add', p]); fs.writeFileSync(p, before);", 'L2'],
  ['configured-risk', "const p = '.ai-governance/config.json'; const c = JSON.parse(fs.readFileSync(p)); c.domainConstraints = ['External actions require approval.']; c.confirmedRiskSignals = ['external-side-effect']; fs.writeFileSync(p, JSON.stringify(c));", 'L1'],
]) {
  test(`completion refreshes final task routing after verification ${mutation}`, (context) => {
    const root = fixture(`final-route-${mutation}`);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    initialize(root);
    write(root, 'src/modules/session/auth.mjs');
    write(root, 'scripts/verify.cjs', `const fs = require('node:fs'); ${body}\n`);
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'node scripts/verify.cjs' } }));
    assert.equal(run(['sync', root]).status, 0);
    baseline(root);
    write(root, 'README.md', '# Changed guide\n');
    const manifest = fs.readFileSync(path.join(root, '.ai-governance/manifest.json'));
    const result = runCompletion(root, { taskLevel, verificationCommand: 'npm test' });
    assert.equal(result.projectVerification.status, 'passed');
    assert.equal(result.taskRoute.minimumLevel, mutation === 'configured-risk' ? 'L1' : 'L3');
    assert.equal(result.taskRoute.status, mutation === 'configured-risk' ? 'verified' : 'upgrade-required');
    assert.equal(result.ok, false);
    assert.equal(result.harvest.status, 'skipped');
    assert.equal(result.harvest.reason, mutation === 'configured-risk' ? 'task-approval-missing-evidence' : 'task-route-upgrade-required');
    assert.deepEqual(result.harvest.candidates, []);
    assert.deepEqual(fs.readFileSync(path.join(root, '.ai-governance/manifest.json')), manifest);
  });
}

for (const [mutation, body] of [
  ['index', "fs.writeFileSync('.git/index', 'corrupt');"],
  ['config', "fs.writeFileSync('.ai-governance/config.json', '{}');"],
]) {
  test(`completion fails closed when verification leaves final ${mutation} unreadable`, (context) => {
    const root = fixture(`final-route-unreadable-${mutation}`);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    initialize(root);
    write(root, 'scripts/verify.cjs', `const fs = require('node:fs'); ${body}\n`);
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'node scripts/verify.cjs' } }));
    assert.equal(run(['sync', root]).status, 0);
    baseline(root);
    assert.throws(() => runCompletion(root, { taskLevel: 'L1', verificationCommand: 'npm test' }), /Cannot read.*(?:changed paths|routing configuration)/);
  });
}

test('completion returns current verified capability candidates without writing or staging artifacts', (context) => {
  const root = fixture('harvest-summary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'package.json', JSON.stringify({ dependencies: { axios: '1.7.0' }, scripts: { test: 'node -e "process.exit(0)"', 'test:fail': 'node -e "process.exit(1)"' } }));
  assert.equal(run(['sync', root]).status, 0);
  baseline(root);
  write(root, 'src/modules/http/index.ts', "import axios from 'axios'; export const client = axios.create({});\n");
  const approved = approvalOptions(root, { taskLevel: 'L2' });
  const tree = () => Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter((relative) => !relative.startsWith(`.git${path.sep}`) && fs.lstatSync(path.join(root, relative)).isFile())
    .sort().map((relative) => [relative, fs.readFileSync(path.join(root, relative), 'base64')]));
  const before = tree();
  const index = git(root, ['ls-files', '--stage']).stdout;
  const result = runCompletion(root, { ...approved, verificationCommand: 'npm test' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.harvest?.status, 'dry-run');
  assert.equal(result.harvest.eligible, true);
  assert.equal(result.harvest.candidates[0].outcome, 'create-new');
  assert.equal(result.harvest.candidates[0].capability.status, 'candidate');
  assert.equal(result.harvest.candidates[0].capability.promotion, undefined);
  assert.equal(result.harvest.verification.command, 'npm run test');
  assert.equal(result.projectVerification.inputEvidence.status, 'unchanged');
  assert.match(result.projectVerification.inputEvidence.beforeFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.projectVerification.inputEvidence.beforeFingerprint, result.projectVerification.inputEvidence.afterFingerprint);
  assert.deepEqual(result.harvest.verification.inputEvidence, result.projectVerification.inputEvidence);
  assert.deepEqual(tree(), before);
  assert.equal(git(root, ['ls-files', '--stage']).stdout, index);
  for (const [options, reason] of [
    [{ taskLevel: 'L2', verificationCommand: null }, 'project-verification-not-requested'],
    [{ taskLevel: 'L2', verificationCommand: 'npm run test:fail' }, 'project-verification-failed'],
    [{ verificationCommand: 'npm test' }, 'task-route-unverified-declaration'],
    [{ taskLevel: 'L1', verificationCommand: 'npm test' }, 'task-route-upgrade-required'],
  ]) {
    const skipped = runCompletion(root, { ...approved, taskLevel: options.taskLevel ?? null, ...options }).harvest;
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.reason, reason);
    assert.deepEqual(skipped.candidates, []);
  }
  baseline(root);
  write(root, 'src/modules/unrelated/index.ts');
  assert.equal(runCompletion(root, { ...approvalOptions(root, { taskLevel: 'L2' }), verificationCommand: 'npm test' }).harvest.reason, 'no-reusable-public-capability-change');
  baseline(root);
  write(root, 'src/modules/http/index.ts', "import axios from 'axios';\n\nexport const client = axios.create({ });\n");
  const formatOnly = runCompletion(root, { ...approvalOptions(root, { taskLevel: 'L2' }), verificationCommand: 'npm test' }).harvest;
  assert.equal(formatOnly.status, 'skipped');
  assert.equal(formatOnly.reason, 'no-production-source-change');
});

test('completion fails closed when a verified command leaves HEAD source evidence unreadable', (context) => {
  const root = fixture('harvest-missing-source-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const source = 'src/modules/http/index.ts';
  write(root, source, "import axios from 'axios'; export const client = axios.create({ timeout: 1000 });\n");
  baseline(root);
  const blob = git(root, ['rev-parse', `HEAD:${source}`]).stdout.trim();
  const objectPath = `.git/objects/${blob.slice(0, 2)}/${blob.slice(2)}`;
  write(root, 'package.json', JSON.stringify({ dependencies: { axios: '1.7.0' }, scripts: { test: `node -e "require('fs').unlinkSync('${objectPath}')"` } }));
  assert.equal(run(['sync', root]).status, 0);
  baseline(root);
  write(root, source, "import axios from 'axios'; export const client = axios.create({ timeout: 2000 });\n");
  assert.throws(() => runCompletion(root, { taskLevel: 'L2', verificationCommand: 'npm test' }), /Cannot read changed paths/);
});

for (const [mutation, body] of [
  ['rewrite', "fs.appendFileSync(source, '\\nexport const unverified = true;\\n');"],
  ['add', "fs.writeFileSync('src/modules/http/added.ts', 'export const unverified = true;');"],
  ['delete', "fs.unlinkSync('src/modules/http/peer.ts');"],
  ['type', "fs.unlinkSync(source); fs.symlinkSync('peer.ts', source);"],
  ['stage', "require('node:child_process').execFileSync('git', ['add', source]);"],
]) {
  test(`completion binds verification inputs against source ${mutation}`, (context) => {
    const root = fixture(`harvest-verification-${mutation}`);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    initialize(root);
    const source = 'src/modules/http/index.ts';
    write(root, source, "import axios from 'axios'; export const client = axios.create({ timeout: 1000 });\n");
    write(root, 'src/modules/http/peer.ts', 'export const peer = true;\n');
    write(root, 'scripts/verify.cjs', `const fs = require('node:fs'); const source = ${JSON.stringify(source)}; if (!fs.readFileSync(source, 'utf8').includes('2000')) process.exit(1); ${body}\n`);
    write(root, 'package.json', JSON.stringify({ dependencies: { axios: '1.7.0' }, scripts: { test: 'node scripts/verify.cjs' } }));
    const synced = run(['sync', root]);
    assert.equal(synced.status, 0, synced.stdout + synced.stderr);
    baseline(root);
    write(root, source, "import axios from 'axios'; export const client = axios.create({ timeout: 2000 });\n");
    const result = runCompletion(root, { taskLevel: 'L2', verificationCommand: 'npm test' });
    assert.equal(result.projectVerification.status, 'passed');
    assert.equal(result.harvest.status, 'skipped');
    assert.equal(result.harvest.reason, 'verification-input-changed');
    assert.deepEqual(result.harvest.candidates, []);
  });
}

test('completion rejects L1 after a production or high-risk diff', (context) => {
  const root = fixture('task-level');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/payment.mjs');
  const result = run(['complete', root, '--task-level', 'L1', '--json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.taskRoute.status, 'upgrade-required');
  assert.equal(payload.taskRoute.minimumLevel, 'L3');
  assert.equal(payload.ok, false);
});

test('manual completion classifies staged unstaged untracked deleted and renamed paths', (context) => {
  const root = fixture('changed-paths');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  write(root, 'src/modules/session/auth.mjs');
  baseline(root);
  for (const [relative, staged, minimum] of [
    ['README.md', false, 'L1'],
    ['src/modules/widget/index.mjs', false, 'L2'],
    ['package-lock.json', true, 'L2'],
    ['db/migrations/001.sql', false, 'L3'],
    ['test/fixtures/contracts/openapi.yaml', false, 'L2'],
    ['docs/ai/architecture-profile.json', false, 'L3'],
  ]) {
    write(root, relative, '{}\n');
    if (staged) assert.equal(git(root, ['add', relative]).status, 0);
    const result = runCompletion(root, { taskLevel: 'L0' });
    assert.equal(result.taskRoute.minimumLevel, minimum, relative);
    assert.equal(result.taskRoute.status, 'upgrade-required', relative);
    assert.equal(result.ok, false, relative);
    baseline(root);
  }
  fs.unlinkSync(path.join(root, 'src/modules/session/auth.mjs'));
  assert.equal(runCompletion(root, { taskLevel: 'L1' }).taskRoute.minimumLevel, 'L3');
  baseline(root);
  assert.equal(git(root, ['mv', 'src/modules/widget/index.mjs', 'widget.md']).status, 0);
  assert.equal(runCompletion(root, { taskLevel: 'L1' }).taskRoute.minimumLevel, 'L2');
  assert.equal(runCompletion(root, { taskLevel: 'L1', fromGitHook: true }).taskRoute.minimumLevel, 'L2');
});

test('completion verifies sufficient declarations and identifies omitted declarations', (context) => {
  const root = fixture('declared-level');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  assert.equal(runCompletion(root, { taskLevel: 'L0' }).taskRoute.status, 'verified');
  write(root, 'README.md', '# Guide\n');
  const declared = runCompletion(root, { taskLevel: 'L1' });
  assert.equal(declared.ok, true);
  assert.equal(declared.taskRoute.declaredLevel, 'L1');
  assert.equal(declared.taskRoute.minimumLevel, 'L1');
  assert.equal(declared.taskRoute.status, 'verified');
  const omitted = runCompletion(root);
  assert.equal(omitted.ok, true);
  assert.equal(omitted.taskRoute.declaredLevel, null);
  assert.equal(omitted.taskRoute.status, 'unverified-declaration');
  const text = run(['complete', root, '--task-level', 'L1']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /task_route=verified.*declared=L1.*minimum=L1/);
});

test('completion ignores unmapped project risk in both worktree and staged snapshot', (context) => {
  const root = fixture('confirmed-risk');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Public API responses retain their documented shape.'], ['public-api']);
  write(root, 'docs/unrelated.md', '# Unrelated documentation\n');
  assert.equal(git(root, ['add', 'docs/unrelated.md']).status, 0);
  assert.equal(runCompletion(root, { taskLevel: 'L1' }).taskRoute.minimumLevel, 'L1');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  write(root, '.ai-governance/config.json', JSON.stringify({ ...config, confirmedRiskSignals: ['external-side-effect'] }));
  assert.equal(runCompletion(root, { taskLevel: 'L1' }).taskRoute.minimumLevel, 'L1');
  const hook = runCompletion(root, { taskLevel: 'L2', fromGitHook: true });
  assert.equal(hook.taskRoute.minimumLevel, 'L1');
  assert.equal(hook.taskRoute.status, 'verified');
});

test('hook task routing uses only staged paths while manual routing sees unstaged production changes', (context) => {
  const root = fixture('index-routing');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'src/modules/widget/index.mjs');
  baseline(root);
  write(root, 'README.md', '# Staged guide\n');
  assert.equal(git(root, ['add', 'README.md']).status, 0);
  write(root, 'src/modules/widget/index.mjs', 'export const value = false;\n');
  write(root, 'db/migrations/001.sql', 'select 1;\n');
  const hook = runCompletion(root, { taskLevel: 'L1', fromGitHook: true });
  assert.equal(hook.taskRoute.minimumLevel, 'L1');
  assert.equal(hook.taskRoute.status, 'verified');
  assert.deepEqual(hook.stagedFiles, ['README.md']);
  assert.equal(runCompletion(root, { taskLevel: 'L1' }).taskRoute.minimumLevel, 'L3');
});

test('upgrade-required completion performs no harvest or project command mutations', (context) => {
  const root = fixture('upgrade-read-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  write(root, 'package.json', JSON.stringify({ scripts: { verify: 'node --eval "require(\'fs\').writeFileSync(\'mutation-marker\', \'bad\')"' } }));
  assert.equal(run(['sync', root]).status, 0);
  baseline(root);
  write(root, 'src/modules/widget/index.mjs');
  const tree = () => Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter((relative) => !relative.startsWith(`.git${path.sep}`) && fs.lstatSync(path.join(root, relative)).isFile())
    .sort().map((relative) => [relative, fs.readFileSync(path.join(root, relative), 'base64')]));
  const treeBefore = tree();
  const before = git(root, ['status', '--porcelain=v1', '-z']).stdout;
  const manifest = fs.readFileSync(path.join(root, '.ai-governance/manifest.json'));
  const result = runCompletion(root, { taskLevel: 'L1', verificationCommand: 'npm run verify' });
  assert.equal(result.governance.ok, true);
  assert.equal(result.ok, false);
  assert.equal(result.projectVerification.status, 'skipped-after-task-route-failure');
  assert.equal(fs.existsSync(path.join(root, 'mutation-marker')), false);
  assert.equal(git(root, ['status', '--porcelain=v1', '-z']).stdout, before);
  assert.deepEqual(fs.readFileSync(path.join(root, '.ai-governance/manifest.json')), manifest);
  assert.deepEqual(tree(), treeBefore);
});

test('completion fails closed on missing HEAD corrupt index and invalid routing config', (context) => {
  const root = fixture('missing-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  assert.throws(() => runCompletion(root), (error) => error.code === 'AICG_USAGE' && /changed paths/.test(error.message));
  initialize(root);
  const indexPath = path.join(root, '.git/index');
  const indexBefore = fs.readFileSync(indexPath);
  write(root, '.git/index', 'corrupt index');
  for (const fromGitHook of [false, true]) {
    assert.throws(() => runCompletion(root, { fromGitHook, taskLevel: 'L1' }), (error) => error.code === 'AICG_USAGE');
  }
  fs.writeFileSync(indexPath, indexBefore);
  const configPath = path.join(root, '.ai-governance/config.json');
  const configBefore = fs.readFileSync(configPath);
  for (const invalid of ['{', JSON.stringify({ confirmedRiskSignals: ['guessed-risk'] })]) {
    fs.writeFileSync(configPath, invalid);
    assert.throws(() => runCompletion(root), (error) => error.code === 'AICG_USAGE' && /routing configuration/.test(error.message));
  }
  fs.unlinkSync(configPath);
  assert.throws(() => runCompletion(root), (error) => error.code === 'AICG_USAGE');
  write(root, 'linked-config.json', configBefore);
  fs.symlinkSync(path.join(root, 'linked-config.json'), configPath);
  assert.throws(() => runCompletion(root), (error) => error.code === 'AICG_USAGE' && /symbolic link/.test(error.message));
});

test('manual and hook completion require a commit HEAD on initial and orphan branches', (context) => {
  const root = fixture('unborn-hook-head');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  const initialized = run(['init', root, '--clients', 'all', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(git(root, ['add', '--all']).status, 0);

  const assertMissingCommitFails = () => {
    const indexBefore = fs.readFileSync(path.join(root, '.git/index'));
    const configBefore = fs.readFileSync(path.join(root, '.ai-governance/config.json'));
    const manifestBefore = fs.readFileSync(path.join(root, '.ai-governance/manifest.json'));
    const statusBefore = git(root, ['status', '--porcelain=v1', '-z']).stdout;
    for (const fromGitHook of [true, false]) {
      assert.throws(() => runCompletion(root, { fromGitHook, taskLevel: 'L3' }), (error) => error.code === 'AICG_USAGE');
      const result = run(['complete', root, '--task-level', 'L3', '--json', ...(fromGitHook ? ['--from-git-hook'] : [])]);
      assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    }
    assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), indexBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, '.ai-governance/config.json')), configBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, '.ai-governance/manifest.json')), manifestBefore);
    assert.equal(git(root, ['status', '--porcelain=v1', '-z']).stdout, statusBefore);
  };

  assertMissingCommitFails();
  baseline(root);
  const valid = runCompletion(root, approvalOptions(root, { fromGitHook: true, taskLevel: 'L3' }));
  assert.equal(valid.ok, true);
  assert.equal(valid.taskRoute.status, 'verified');
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
  assert.equal(git(root, ['checkout', '--orphan', 'orphan-completion']).status, 0);
  assertMissingCommitFails();
  write(root, '.git/HEAD', `${tree}\n`);
  assert.throws(() => runCompletion(root, { fromGitHook: true, taskLevel: 'L3' }), (error) => error.code === 'AICG_USAGE');
});

test('completion rejects invalid declarations and unreadable repository evidence fail closed', (context) => {
  const root = fixture('route-errors');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  for (const taskLevel of ['L4', 'l1', '', 1, ['L1'], true]) {
    assert.throws(() => runCompletion(root, { taskLevel }), (error) => error.code === 'AICG_USAGE' && /task.level/.test(error.message));
  }
  const invalid = run(['complete', root, '--task-level', 'L4', '--json']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /task.level/);
  write(root, '.git/HEAD', 'invalid head\n');
  assert.throws(() => runCompletion(root, { taskLevel: 'L1' }), (error) => error.code === 'AICG_USAGE');
  const noRepo = fixture('no-repository');
  context.after(() => fs.rmSync(noRepo, { recursive: true, force: true }));
  assert.notEqual(run(['complete', noRepo, '--json']).status, 0);
});

function initializeWithConstraints(root, constraints, confirmedRiskSignals = ['authorization']) {
  const configPath = path.join(os.tmpdir(), `aicg-completion-config-${process.pid}-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    governanceDepth: 'standard',
    features: { knowledge: false },
    domainConstraints: constraints,
    confirmedRiskSignals,
  }));
  try {
    const result = run(['init', root, '--clients', 'all', '--config', configPath, '--yes', '--no-assist']);
    assert.equal(result.status, 0, result.stderr);
    baseline(root);
  } finally {
    fs.rmSync(configPath, { force: true });
  }
}

test('manual completion is read-only and runs only an explicitly discovered npm script', (context) => {
  const root = fixture('manual');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const agentsBefore = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'completion-fixture',
    private: true,
    scripts: {
      test: 'node --eval "process.exit(0)"',
      verify: 'node --eval "process.exit(0)"',
      'verify:broken': 'node --eval "process.exit(7)"',
    },
  }, null, 2));
  const configPath = path.join(root, '.ai-governance', 'config.json');
  const before = fs.readFileSync(configPath, 'utf8');
  const checked = run(['check', root, '--json']);
  assert.equal(checked.status, 0, `${checked.stderr}\n${checked.stdout}`);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), agentsBefore);

  const shorthand = runApproved(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(shorthand.status, 0, `${shorthand.stderr}\n${shorthand.stdout}`);
  assert.equal(JSON.parse(shorthand.stdout).projectVerification.command, 'npm run test');

  const passed = runApproved(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(passed.status, 0, `${passed.stderr}\n${passed.stdout}`);
  const passedPayload = JSON.parse(passed.stdout);
  assert.equal(passedPayload.mode, 'manual');
  assert.equal(passedPayload.projectVerification.status, 'passed');
  assert.equal(passedPayload.generation.status, 'manual-only');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const unknown = run(['complete', root, '--verify', 'npm run missing', '--json']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Allowed commands: npm run test, npm run verify, npm run verify:broken/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const injected = run(['complete', root, '--verify', 'npm test -- --watch', '--json']);
  assert.equal(injected.status, 2);
  assert.match(injected.stderr, /Allowed commands: npm run test, npm run verify, npm run verify:broken/);

  const failed = run(['complete', root, '--verify', 'npm run verify:broken', '--json']);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).projectVerification.status, 'failed');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('completion exposes only verification scripts and never runs implicit npm lifecycle hooks', (context) => {
  const root = fixture('verification-command-boundary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const marker = path.join(root, 'implicit-hook-ran');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'completion-command-boundary',
    private: true,
    scripts: {
      pretest: 'node --eval "require(\'fs\').writeFileSync(\'implicit-hook-ran\', \'unexpected\')"',
      test: 'node --eval "process.exit(0)"',
      'test:unit': 'node --eval "process.exit(0)"',
      verify: 'node --eval "process.exit(0)"',
      start: 'node --eval "process.exit(0)"',
      deploy: 'node --eval "process.exit(0)"',
    },
  }, null, 2));

  const assessed = run(['assess', root, '--json']);
  assert.equal(assessed.status, 0, assessed.stderr);
  assert.deepEqual(JSON.parse(assessed.stdout).actionGuide.allowedVerificationCommands, [
    'npm run test:unit',
    'npm run verify',
  ]);

  const hooked = run(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(hooked.status, 2);
  assert.match(hooked.stderr, /Allowed commands: npm run test:unit, npm run verify/);
  assert.equal(fs.existsSync(marker), false, 'implicit pretest hook must not execute');

  const deploy = run(['complete', root, '--verify', 'npm run deploy', '--json']);
  assert.equal(deploy.status, 2);
  assert.equal(fs.existsSync(marker), false);

  const verified = runApproved(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).projectVerification.status, 'passed');
});

for (const artifactLanguage of ['en', 'zh-CN']) test(`surface verification passes a reachable HTTP story through a discovered safe command (${artifactLanguage})`, (context) => {
  const root = fixture('surface-http');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, artifactLanguage);
  fs.mkdirSync(path.join(root, 'src', 'modules', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'api', 'index.mjs'), "import http from 'node:http';\nexport const server = http.createServer();\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'http-health',
      signalId: 'surface-node-http',
      profileId: 'http-contract',
      entrypoint: 'GET /health',
      reachability: 'reachable',
      environment: 'available',
      command: 'npm run test:http',
    }],
  }));
  const synced = run(['sync', root]);
  assert.equal(synced.status, 0, `${synced.stderr}\n${synced.stdout}`);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const firstUse = { ...scanProject(root), governanceUsage: ['surface'] };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, firstUse)));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/surface-verification-profiles.json'), 'utf8'));
  assert.equal(/[\u3400-\u9fff]/u.test(profiles.claimBoundary), artifactLanguage === 'zh-CN');
  const fabricated = run(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(fabricated.status, 1, fabricated.stderr);
  const fabricatedPayload = JSON.parse(fabricated.stdout);
  assert.equal(fabricatedPayload.projectVerification.status, 'passed');
  assert.equal(fabricatedPayload.surfaceVerification.status, 'blocked');
  assert.match(fabricatedPayload.surfaceVerification.results[0].reason, /marker/i);
  assert.equal('stdout' in fabricatedPayload.projectVerification, false);

  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'verify-http.mjs'), `import http from 'node:http';
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('healthy');
    return;
  }
  response.writeHead(404);
  response.end('missing');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const response = await fetch(\`http://127.0.0.1:\${address.port}/health\`);
const body = await response.text();
await new Promise((resolve) => server.close(resolve));
if (response.status !== 200 || body !== 'healthy') process.exit(1);
console.log('AICG_SURFACE_EVIDENCE ' + JSON.stringify({ schemaVersion: 1, storyId: 'http-health', signalId: 'surface-node-http', profileId: 'http-contract', entrypoint: 'GET /health', outcome: 'passed' }));
`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node scripts/verify-http.mjs' } }));
  const completed = runApproved(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(completed.status, 0, `${completed.stderr}\n${completed.stdout}`);
  const completedPayload = JSON.parse(completed.stdout);
  const surface = completedPayload.surfaceVerification;
  assert.equal(surface.status, 'passed');
  assert.equal(surface.results[0].status, 'passed');
  assert.match(completedPayload.projectVerification.outputDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(completedPayload.projectVerification.markers, [{
    schemaVersion: 1,
    storyId: 'http-health',
    signalId: 'surface-node-http',
    profileId: 'http-contract',
    entrypoint: 'GET /health',
    outcome: 'passed',
  }]);
});

test('surface verification rejects a successful command with a marker bound to another entrypoint', (context) => {
  const root = fixture('surface-wrong-marker');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.mkdirSync(path.join(root, 'src', 'modules', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'api', 'index.mjs'), "import http from 'node:http';\nexport const server = http.createServer();\n");
  const marker = JSON.stringify({ schemaVersion: 1, storyId: 'http-health', signalId: 'surface-node-http', profileId: 'http-contract', entrypoint: 'GET /invented', outcome: 'passed' });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': `node --eval "console.log('AICG_SURFACE_EVIDENCE ${marker.replaceAll('"', '\\"')}')"` } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{ id: 'http-health', signalId: 'surface-node-http', profileId: 'http-contract', entrypoint: 'GET /health', reachability: 'reachable', environment: 'available', command: 'npm run test:http' }],
  }));
  const completed = run(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(completed.status, 1, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).surfaceVerification.status, 'blocked');
});

test('surface verification blocks an explicitly internal-only unreachable story', (context) => {
  const root = fixture('surface-internal-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.mkdirSync(path.join(root, 'src', 'modules', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'api', 'index.mjs'), "import http from 'node:http';\nexport const server = http.createServer();\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'internal-handler-only',
      signalId: 'surface-node-http',
      profileId: 'http-contract',
      entrypoint: 'unmounted request handler',
      reachability: 'internal-only',
      environment: 'available',
      command: 'npm run test:http',
    }],
  }));
  const completed = run(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(completed.status, 1, completed.stderr);
  const payload = JSON.parse(completed.stdout);
  assert.equal(payload.projectVerification.status, 'passed');
  assert.equal(payload.surfaceVerification.status, 'blocked');
  assert.match(payload.surfaceVerification.results[0].reason, /internal-only/);
});

test('unavailable browser verification remains unverified instead of passing or blocking', (context) => {
  const root = fixture('surface-browser-unavailable');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<button id="save">Save</button>\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:browser': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'save-click',
      signalId: 'surface-browser-ui',
      profileId: 'browser-smoke',
      entrypoint: 'click #save',
      reachability: 'reachable',
      environment: 'unavailable',
      command: 'npm run test:browser',
    }],
  }));
  const completed = runApproved(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const surface = JSON.parse(completed.stdout).surfaceVerification;
  assert.equal(surface.status, 'unverified');
  assert.equal(surface.results[0].status, 'unverified');
  assert.match(surface.results[0].reason, /environment is unavailable/);
});

test('completion blocks production readiness when confirmed risk signals lack bound acceptance evidence', (context) => {
  const root = fixture('production-readiness-missing');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Only active members may access tenant issues.']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node --eval "process.exit(0)"' } }));
  assert.equal(run(['sync', root]).status, 0);

  const json = runApproved(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.productionReadiness.state, 'blocked');
  assert.equal(payload.productionReadiness.constraintEvidence.status, 'missing');
  assert.equal(payload.productionReadiness.constraintEvidence.declared, 1);
  assert.match(payload.claimBoundary, /does not establish production readiness/i);

  const human = runApproved(['complete', root, '--verify', 'npm run verify']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^PRODUCTION_READINESS=blocked constraint_evidence=missing/m);
  assert.equal(human.stdout.trimStart().startsWith('PRODUCTION_READINESS=blocked'), true);
});

test('completion blocks production readiness when owner-confirmed constraints lack evidence without risk signals', (context) => {
  const root = fixture('production-readiness-constraint-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['A completed reminder must be delivered at its scheduled time.'], []);

  const completed = run(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const payload = JSON.parse(completed.stdout);
  assert.equal(payload.productionReadiness.state, 'blocked');
  assert.equal(payload.productionReadiness.constraintEvidence.status, 'missing');
  assert.equal(payload.productionReadiness.constraintEvidence.declared, 1);
  assert.match(payload.productionReadiness.reason, /business constraints or risk signals/i);
});

test('business acceptance evidence must bind the current stable constraint id, text, and hash', (context) => {
  const root = fixture('production-readiness-binding');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Every issue belongs to exactly one tenant.'], []);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8'));
  const current = registry.constraints[0];
  const evidencePath = path.join(root, 'docs/ai/business-acceptance-results.json');
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: '0'.repeat(64),
      status: 'pass',
      successEvidence: 'npm run test: tenant-local path passed',
      failureOrBoundaryEvidence: 'cross-tenant negative path failed closed',
    }],
  }));
  const stale = run(['complete', root, '--json']);
  assert.equal(stale.status, 0, stale.stderr);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.ok, true);
  assert.equal(stalePayload.productionReadiness.state, 'blocked');
  assert.equal(stalePayload.productionReadiness.constraintEvidence.status, 'invalid');
  assert.match(stalePayload.productionReadiness.constraintEvidence.issues.join('\n'), /constraintHash does not match/);

  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: current.constraintHash,
      status: 'pass',
      successEvidence: 'npm run test: tenant-local path passed',
      failureOrBoundaryEvidence: 'cross-tenant negative path failed closed',
    }],
  }));
  const recorded = run(['complete', root, '--json']);
  assert.equal(recorded.status, 0, recorded.stderr);
  const recordedPayload = JSON.parse(recorded.stdout);
  assert.equal(recordedPayload.productionReadiness.state, 'unverified');
  assert.equal(recordedPayload.productionReadiness.reviewEligibility, 'eligible-for-review');
  assert.equal(recordedPayload.productionReadiness.constraintEvidence.status, 'recorded-unverified');
  assert.equal(recordedPayload.productionReadiness.constraintEvidence.covered, 1);
  assert.match(recordedPayload.productionReadiness.reason, /does not replay or certify/i);
});

test('production readiness requires owner-confirmed negative and recovery evidence for confirmed risks', (context) => {
  const root = fixture('production-readiness-risk-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Only a trusted actor may change the record.'], ['authorization']);
  const constraint = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8')).constraints[0];
  fs.writeFileSync(path.join(root, 'docs/ai/business-acceptance-results.json'), JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: constraint.id,
      constraint: constraint.constraint,
      constraintHash: constraint.constraintHash,
      status: 'pass',
      successEvidence: 'trusted actor success path passed',
      failureOrBoundaryEvidence: 'request-controlled actor was denied',
    }],
  }));
  const missing = runApproved(['complete', root, '--json']);
  assert.equal(missing.status, 0, missing.stderr);
  const missingReadiness = JSON.parse(missing.stdout).productionReadiness;
  assert.equal(missingReadiness.state, 'blocked');
  assert.equal(missingReadiness.constraintEvidence.status, 'recorded-unverified');
  assert.equal(missingReadiness.riskEvidence.status, 'missing');

  fs.writeFileSync(path.join(root, 'docs/ai/risk-evidence.json'), JSON.stringify({
    schemaVersion: 1,
    owner: 'product-owner',
    source: 'owner-confirmed',
    risks: [{
      riskId: 'body-actor-identity',
      applicability: 'applicable',
      reason: 'Authorization depends on binding the actor to trusted authentication.',
      status: 'passed',
      entrypoint: 'npm run test:authorization',
      negativeDiagnostic: 'A request-controlled actor identity was rejected.',
      recoveryEvidence: 'A trusted authenticated actor completed the operation.',
      sourceFingerprint: missingReadiness.riskEvidence.sourceFingerprint,
      evidenceLevel: 'project-local-unverified',
    }],
  }));
  const recorded = runApproved(['complete', root, '--json']);
  assert.equal(recorded.status, 0, recorded.stderr);
  const readiness = JSON.parse(recorded.stdout).productionReadiness;
  assert.equal(readiness.state, 'unverified');
  assert.equal(readiness.reviewEligibility, 'eligible-for-review');
  assert.equal(readiness.riskEvidence.status, 'recorded-unverified');
});

test('business acceptance evidence cannot traverse a symbolic link', (context) => {
  const root = fixture('production-readiness-symlink');
  const outside = fixture('production-readiness-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  initializeWithConstraints(root, ['Every issue belongs to exactly one tenant.']);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8'));
  const current = registry.constraints[0];
  const outsideEvidence = path.join(outside, 'business-acceptance-results.json');
  fs.writeFileSync(outsideEvidence, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: current.constraintHash,
      status: 'pass',
      successEvidence: 'success',
      failureOrBoundaryEvidence: 'boundary',
    }],
  }));
  fs.symlinkSync(outsideEvidence, path.join(root, 'docs/ai/business-acceptance-results.json'));

  const completed = runApproved(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const readiness = JSON.parse(completed.stdout).productionReadiness;
  assert.equal(readiness.state, 'blocked');
  assert.equal(readiness.reviewEligibility, 'not-eligible');
  assert.equal(readiness.constraintEvidence.status, 'invalid');
  assert.match(readiness.constraintEvidence.issues.join('\n'), /symbolic link/);
});

test('chat completion and the managed pre-commit hook validate only when explicitly invoked or committing', (context) => {
  const root = fixture('git-hook');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  assert.equal(git(root, ['config', 'user.email', 'aicg@example.test']).status, 0);
  assert.equal(git(root, ['config', 'user.name', 'AICG Test']).status, 0);
  initialize(root);
  assert.equal(git(root, ['add', '--all']).status, 0);
  assert.equal(git(root, ['commit', '--allow-empty', '-m', 'governance baseline']).status, 0);

  const completion = run(['request', root, '--text', '运行完成门禁', '--json']);
  assert.equal(completion.status, 0, completion.stderr);
  assert.equal(JSON.parse(completion.stdout).result.mode, 'manual');

  const completionInput = path.join(root, 'completion.json');
  fs.writeFileSync(completionInput, JSON.stringify({ verificationCommand: 'npm run verify' }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node --eval "process.exit(0)"' } }));
  assert.equal(run(['sync', root]).status, 0);
  const verifiedCompletion = run(['request', root, '--text', '运行完成门禁', '--config', completionInput, '--json']);
  assert.equal(verifiedCompletion.status, 1, verifiedCompletion.stderr);
  assert.equal(JSON.parse(verifiedCompletion.stdout).result.taskRoute.status, 'unverified-declaration');
  assert.equal(JSON.parse(verifiedCompletion.stdout).result.projectVerification.status, 'passed');

  const preview = run(['request', root, '--text', '安装 Git 提交门禁', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout).plan;
  assert.equal(plan.intent, 'governance.install-precommit');
  const installed = run(['request', root, '--text', '安装 Git 提交门禁', '--approve', plan.planHash, '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).installed.status, 'installed');

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  const hook = JSON.parse(status.stdout);
  assert.equal(hook.status, 'managed');
  assert.match(fs.readFileSync(hook.hookPath, 'utf8'), new RegExp(PRE_COMMIT_HOOK_MARKER));
  const chatStatus = run(['request', root, '--text', '查看提交门禁状态', '--json']);
  assert.equal(chatStatus.status, 0, chatStatus.stderr);
  assert.equal(JSON.parse(chatStatus.stdout).result.hookStatus, 'managed');

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'flat.ts'), 'export const flat = true;\n');
  assert.equal(git(root, ['add', 'src/flat.ts']).status, 0);
  const blocked = git(root, ['commit', '-m', 'blocked flat source']);
  assert.notEqual(blocked.status, 0, `${blocked.stdout}\n${blocked.stderr}`);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /architecture placement: src\/flat\.ts/);
  assert.match(git(root, ['diff', '--cached', '--name-only']).stdout, /src\/flat\.ts/);
});

test('pre-commit installation never overwrites a non-managed hook', (context) => {
  const root = fixture('hook-conflict');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\necho custom\n', { mode: 0o755 });

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'conflict');
  const install = run(['hook', 'install', root, '--yes', '--json']);
  assert.equal(install.status, 2);
  assert.match(install.stderr, /Refuse to replace the existing pre-commit hook/);
  assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho custom\n');
});
