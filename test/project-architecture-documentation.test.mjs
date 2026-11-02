import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig, validateConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { buildDeliveryCapabilityPlan } from '../src/modules/governance/delivery-capabilities.mjs';
import { prepareDeliveryArtifacts } from '../src/modules/governance/delivery-preparation.mjs';
import { assessDeliveryArtifacts } from '../src/modules/governance/delivery-assessment.mjs';
import { buildTaskHandoff } from '../src/modules/governance/task-handoff.mjs';
import { buildGovernanceHandoff } from '../src/modules/governance/handoff-prompt.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { runAssist } from '../src/assist.mjs';
import { checkProject } from '../src/checker.mjs';
import { spawnSync } from 'node:child_process';
import { defaultTestCaseManifest } from '../src/modules/testing/index.mjs';

function fixture(t, existing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-architecture-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (existing) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'member-app', type: 'module' }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/index.mjs'), 'export const register = (name) => { if (!name) throw new Error("Name required"); return { name }; };\n');
  }
  return root;
}

test('architecture documentation is explicit, independent of Memory, routed, and preserves manual edits', (t) => {
  const root = fixture(t, true);
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  const relative = 'docs/development/architecture.md';
  assert.equal(buildArtifacts(config, scan).some((a) => a.path === relative), true);
  config.features = { ...config.features, architectureDocumentation: true, brownfieldEnrichment: 'off', knowledge: false };
  const artifacts = buildArtifacts(config, scan);
  const doc = artifacts.find((a) => a.path === relative);
  assert.ok(doc, 'selected documentation must not depend on business Memory enrichment');
  assert.equal(doc.ownership, 'seed');
  assert.match(doc.content, /src\/index\.mjs/);
  assert.equal([...doc.content.matchAll(/```mermaid/g)].length, 3);
  const context = artifacts.find((a) => a.path.endsWith('context-map.yaml')).content;
  assert.match(context, /development\/architecture\.md/);
  assert.match(artifacts.find((a) => a.path === 'docs/ai/README.md').content, /development\/architecture\.md/);
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  const check = checkProject(scanProject(root));
  assert.equal(check.architectureDocumentation?.readiness, 'needs-content');
  assert.ok(check.architectureDocumentation.findings.some((finding) => finding.code === 'placeholder'));
  fs.writeFileSync(path.join(root, relative), '# Owner architecture\nManual diagram decisions.\n');
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), '# Owner architecture\nManual diagram decisions.\n');
  assert.equal(buildArtifacts({ ...config, governanceDepth: 'minimal' }, scan).some((a) => a.path === relative), true);
  assert.throws(() => validateConfig({ ...config, features: { ...config.features, architectureDocumentation: 'yes' } }), /architectureDocumentation/);
});

test('new-project work always prepares architecture and diagrams without creating product files', (t) => {
  const root = fixture(t);
  const config = { initialization: { lifecycle: 'greenfield' }, features: { architectureDocumentation: false } };
  const delivery = buildDeliveryCapabilityPlan({ text: 'Implement member registration', route: { level: 'L2' }, config });
  assert.ok(delivery.artifacts.some((a) => a.id === 'architecture'));
  const result = prepareDeliveryArtifacts(root, { delivery, scope: 'MEMBERS', text: 'Implement member registration', write: true });
  const doc = fs.readFileSync(path.join(root, 'docs/changes/MEMBERS/architecture.md'), 'utf8');
  assert.equal([...doc.matchAll(/```mermaid/g)].length, 3);
  assert.match(doc, /proposed|Proposed/);
  assert.match(doc, /customer confirmation/i);
  assert.match(doc, /scaffold|dependencies/i);
  assert.equal(result.readiness, 'unverified');
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
  assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
  const assessment = assessDeliveryArtifacts(root, { delivery, scope: 'MEMBERS', text: 'Implement member registration' });
  assert.equal(assessment.readiness, 'needs-content');
});

test('existing architecture authority is reused and light routes do not acquire design work', () => {
  const config = { initialization: { lifecycle: 'existing' }, features: { architectureDocumentation: true } };
  const scan = { files: [{ type: 'file', relative: 'docs/architecture.md' }] };
  const delivery = buildDeliveryCapabilityPlan({ route: { level: 'L2' }, text: 'Update architecture diagram', config, scan });
  assert.equal(delivery.artifacts.find((a) => a.id === 'architecture')?.path, 'docs/architecture.md');
  assert.equal(delivery.artifacts.find((a) => a.id === 'architecture')?.mode, 'reference');
  assert.equal(buildDeliveryCapabilityPlan({ route: { level: 'L0' }, config, scan }).artifacts.length, 0);
  const native = buildDeliveryCapabilityPlan({ route: { level: 'L3' }, config, authority: { active_change: 'openspec/changes/members' } });
  assert.equal(native.artifacts.find((a) => a.id === 'architecture')?.path, 'openspec/changes/members/design.md');
});

test('architecture assessment rejects prose-only diagrams and missing local evidence', (t) => {
  const root = fixture(t);
  const relative = 'docs/changes/MEMBERS/architecture.md';
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), '# Architecture\n\nEverything is implemented.\n');
  const delivery = { level: 'L2', lifecycle: 'greenfield', artifacts: [{ id: 'architecture', mode: 'create-or-update' }] };
  const options = { delivery, scope: 'MEMBERS', text: 'Implement member registration' };
  const result = assessDeliveryArtifacts(root, options);
  assert.ok(result.findings.some((f) => f.code === 'missing-architecture-views'));
  fs.writeFileSync(path.join(root, relative), '# Architecture\n\n## System overview\n```mermaid\nflowchart LR\nA-->B\n```\n## Module architecture\n```mermaid\nflowchart LR\nC-->D\n```\n## Core business flow\n```mermaid\nflowchart TD\nE-->F\n```\n## Evidence\n[source](../../../missing.md)\n');
  const invalid = assessDeliveryArtifacts(root, options);
  assert.ok(invalid.findings.some((f) => f.code === 'missing-source'));
  assert.ok(invalid.findings.some((f) => f.code === 'missing-negative-flow'));
});

test('new-project handoff waits for customer review even with structurally complete documents', (t) => {
  const root = fixture(t);
  const config = { initialization: { lifecycle: 'greenfield' }, interactionLanguage: 'en' };
  const delivery = { level: 'L2', lifecycle: 'greenfield', artifacts: [{ id: 'development-plan', mode: 'create-or-update' }] };
  fs.mkdirSync(path.join(root, 'docs/changes/MEMBERS'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/changes/MEMBERS/development-plan.md'), '# Plan\n## Module responsibilities\nMember service validates names.\n## Verification\nRun the selected registration cases.\n');
  const result = buildTaskHandoff({ root, config, phase: 'applied', task: { route: { level: 'L2' }, delivery }, text: 'Implement member registration', scope: 'MEMBERS' });
  assert.equal(result.assessment.readiness, 'structurally-ready');
  assert.equal(result.status, 'awaiting-customer-confirmation');
  assert.equal(result.nextAction.id, 'confirm-design-before-implementation');
  assert.match(result.prompt, /before.*scaffold|scaffold.*before/i);
  assert.equal(result.execution, 'not-run');
});

test('configuration handoff explains both lifecycle paths and forbids pre-confirmation implementation', () => {
  for (const language of ['en', 'zh-CN']) {
    const result = buildGovernanceHandoff({ root: '/sample/member-app', config: { interactionLanguage: language, initialization: { lifecycle: 'greenfield' } } });
    assert.match(result.prompt, language === 'en' ? /customer confirmation/i : /客户确认/);
    assert.match(result.prompt, language === 'en' ? /business flow/i : /业务流程/);
  }
});

test('customer confirmation reuses the existing digest-bound approval and becomes stale after a design change', (t) => {
  const root = fixture(t);
  const relative = 'docs/changes/MEMBERS/development-plan.md';
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  const plan = '# Plan\n## Module responsibilities\nMember service validates names.\n## Verification\nRun registration cases.\n';
  fs.writeFileSync(path.join(root, relative), plan);
  const approvalText = 'Customer approved the member registration design revision and scoped implementation plan.';
  fs.writeFileSync(path.join(root, 'customer-confirmation.md'), approvalText);
  const evidence = { schemaVersion: 1, planHash: '0'.repeat(64), reviewEvidence: {}, professionalBoundaries: [],
    approvals: ['requirements', 'design', 'plan'].map((id) => ({ id, reference: 'customer-confirmation.md', sha256: sha256(approvalText), source: 'operator-declared' })) };
  const save = () => fs.writeFileSync(path.join(root, 'customer-approval.json'), JSON.stringify(evidence));
  save();
  const options = { root, config: { initialization: { lifecycle: 'greenfield' } }, phase: 'applied',
    task: { route: { level: 'L2' }, delivery: { lifecycle: 'greenfield', level: 'L2', artifacts: [{ id: 'development-plan', mode: 'create-or-update' }] } },
    text: 'Implement member registration', scope: 'MEMBERS', approvalEvidence: 'customer-approval.json' };
  const preview = buildTaskHandoff(options);
  assert.ok(preview.approval.plan, 'use the established approval plan instead of a boolean confirmation');
  evidence.planHash = preview.approval.plan.planHash;
  save();
  const approved = buildTaskHandoff({ ...options, approve: evidence.planHash });
  assert.equal(approved.approval.ok, true, JSON.stringify(approved.approval));
  assert.equal(approved.status, 'prepared-for-agent');
  assert.equal(approved.approval.identityVerified, false);
  assert.equal(buildTaskHandoff({ ...options, approve: evidence.planHash }).status, 'prepared-for-agent');
  fs.writeFileSync(path.join(root, relative), plan + '\nChanged scope: include name uniqueness.\n');
  const changed = buildTaskHandoff({ ...options, approve: evidence.planHash });
  assert.equal(changed.status, 'awaiting-customer-confirmation');
  assert.equal(changed.approval.status, 'stale-plan');
  assert.equal(buildTaskHandoff({ ...options, text: 'Implement a different business', approve: evidence.planHash }).approval.ok, false);
});

test('architecture assistance respects a declined business Memory scope and greenfield confirmation', () => {
  const prompts = [];
  const capture = { commandExists: () => true, spawnSync: (_command, args) => { prompts.push(args.join('\n')); return { status: 0 }; } };
  runAssist('codex', '/sample/member-app', { ...capture, lifecycle: 'existing', architectureDocumentation: true, brownfieldEnrichment: 'off' });
  assert.match(prompts[0], /architecture\.md/);
  assert.doesNotMatch(prompts[0], /record existing business meaning in docs\/memory/i);
  runAssist('codex', '/sample/member-app', { ...capture, lifecycle: 'greenfield' });
  assert.match(prompts[1], /customer confirmation/i);
  const handoff = buildGovernanceHandoff({ root: '/sample/member-app', config: { features: { knowledge: false, brownfieldEnrichment: 'off' } } });
  assert.doesNotMatch(handoff.prompt, /Complete development-unit guidance, Memory/);
});

test('CLI creates the review package, blocks without confirmation and reuses a current receipt', (t) => {
  const root = fixture(t);
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard',
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const text = 'Implement member registration';
  const common = [root, '--text', text, '--scope', 'MEMBERS'];
  const invoke = (command, args = []) => {
    const result = spawnSync(process.execPath, [path.resolve('bin/aicg.js'), ...command, ...common, ...args], { encoding: 'utf8' });
    assert.ok(result.stdout.trim(), result.stderr);
    return { exit: result.status, body: JSON.parse(result.stdout) };
  };
  const before = fs.readdirSync(root, { recursive: true });
  assert.equal(invoke(['delivery', 'prepare']).body.status, 'preview');
  assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
  const prepared = invoke(['delivery', 'prepare'], ['--yes']);
  assert.equal(prepared.exit, 0);
  assert.ok(prepared.body.files.some((file) => file.id === 'architecture'));
  const write = (relative, content) => fs.writeFileSync(path.join(root, relative), content);
  const base = 'docs/changes/MEMBERS/';
  write(base + 'ba.md', '# Member registration\n## Actors and permissions\nOperators register members; visitors cannot.\n## Business rules\nMEMBER-001: Reject an empty name.\n## Acceptance\nBlank input leaves membership unchanged.\n');
  write(base + 'development-plan.md', '# Plan\n## Module responsibilities\nThe member module owns name validation and registration.\n## Verification\nRun the selected acceptance cases before delivery.\n');
  write(base + 'technical-design.md', '# Technical design\nThe proposed member service owns validation, with transport separated from the domain rule. Names must be supplied before storing a registration.\n');
  write(base + 'architecture.md', '# Proposed architecture\n## System overview\n```mermaid\nflowchart LR\noperator[Operator] --> app[Member application]\n```\nOperators use the proposed application.\n## Module architecture\n```mermaid\nflowchart TB\ntransport[Registration transport] --> service[Member service]\n```\nThe service owns validation.\n## Core business flow\n```mermaid\nflowchart TD\nrequest[Submit name] --> valid{Nonempty name}\nvalid -->|success| registered[Register member]\nvalid -->|failure| rejected[Reject empty name]\n```\nInvalid input creates no member.\n## Evidence\n[Requirements](ba.md) define MEMBER-001.\n');
  const cases = defaultTestCaseManifest({ scope: 'MEMBERS' });
  cases.shared.actors.operator = { role: 'Operator', goal: 'Register a member', authority: 'May register', familiarity: 'Daily', platform: 'Local', accessibility: 'Keyboard' };
  cases.shared.environments.local = { platform: 'Local', entry: 'Registration service', requirements: [] };
  cases.cases = [{ id: 'MEMBERS-TC-001', title: 'Reject empty name', priority: 'P1', layer: 'unit', tags: ['smoke', 'negative_input'], sourceIds: ['MEMBER-001'],
    ctx: { actor: 'operator', environment: 'local', data: [] }, pre: [], steps: [{ do: 'input', target: 'Name', see: ['Name required'] }], final: [], evidence: [], cleanup: [],
    automation: { kind: 'agent', runPolicy: 'manual-confirmation', driver: 'terminal' } }];
  cases.coverageDimensions.smoke = { status: 'COVERED', caseIds: ['MEMBERS-TC-001'], rationale: 'Name validation is the selected smoke case.' };
  write('docs/ai/testing/MEMBERS-test-cases.json', JSON.stringify(cases));
  const pending = invoke(['delivery', 'assess'], ['--enforce']);
  assert.equal(pending.exit, 1);
  assert.equal(pending.body.readiness, 'structurally-ready', JSON.stringify(pending.body.findings));
  assert.equal(pending.body.implementationReadiness, 'awaiting-customer-confirmation');
  assert.equal(pending.body.diagramRendering, 'unverified');
  assert.equal(invoke(['handoff'], ['--json']).body.status, 'awaiting-customer-confirmation');
  const statement = 'Customer confirmed member registration requirements, architecture and implementation scope.';
  write('customer-confirmation.md', statement);
  const evidence = { schemaVersion: 1, planHash: '0'.repeat(64), reviewEvidence: {}, professionalBoundaries: [],
    approvals: ['requirements', 'design', 'plan'].map((id) => ({ id, reference: 'customer-confirmation.md', sha256: sha256(statement), source: 'operator-declared' })) };
  write('customer-approval.json', JSON.stringify(evidence));
  const receiptArgs = ['--approval-evidence', 'customer-approval.json'];
  evidence.planHash = invoke(['handoff'], ['--json', ...receiptArgs]).body.approval.plan.planHash;
  write('customer-approval.json', JSON.stringify(evidence));
  const approved = invoke(['handoff'], ['--json', ...receiptArgs, '--approve', evidence.planHash]);
  assert.equal(approved.body.status, 'prepared-for-agent', JSON.stringify(approved.body.approval));
  assert.equal(approved.body.execution, 'not-run');
  assert.equal(invoke(['delivery', 'assess'], [...receiptArgs, '--approve', evidence.planHash, '--enforce']).exit, 0);
  assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/index.mjs')), false);
  write(base + 'architecture.md', fs.readFileSync(path.join(root, base + 'architecture.md'), 'utf8') + '\nScope now includes aliases.\n');
  const stale = invoke(['delivery', 'assess'], [...receiptArgs, '--approve', evidence.planHash, '--enforce']);
  assert.equal(stale.exit, 1);
  assert.equal(stale.body.approval.status, 'stale-plan');
});
