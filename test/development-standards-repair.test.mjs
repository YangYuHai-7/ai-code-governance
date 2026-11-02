import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { planTask } from '../src/cli/commands/task-plan.mjs';
import { buildTaskHandoff } from '../src/modules/governance/task-handoff.mjs';
import { buildWorkflowArtifacts, workflowDocument } from '../src/modules/governance/workflow.mjs';
import { isProductionScopePath } from '../src/modules/repository/production-scope.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(t, dotnet = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-development-repair-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (dotnet) {
    fs.mkdirSync(path.join(root, 'src/Member'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Member.slnx'), '<Solution><Project Path="src/Member/Member.csproj" /></Solution>');
    fs.writeFileSync(path.join(root, 'src/Member/Member.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    fs.writeFileSync(path.join(root, 'src/Member/Member.cs'), 'public class Member {}');
  } else fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'member-app', scripts: { test: 'node --test' } }));
  const scan = scanProject(root, { probeEnvironment: false });
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  return { root, config };
}

test('generated design Skills teach proportionate design, module contracts and component reuse with real counterexamples', t => {
  const { root, config } = fixture(t);
  const artifacts = buildArtifacts(config, scanProject(root));
  for (const id of ['proportionate-design', 'module-boundaries', 'component-reuse']) {
    const skill = artifacts.find(entry => entry.path === `docs/ai/skills/standards/${id}/SKILL.md`);
    assert.ok(skill, id);
    assert.match(skill.content, /## Correct implementation shape/);
    assert.match(skill.content, /## Incorrect implementation shape/);
    assert.match(skill.content, /consumer|responsibility|lifecycle/);
    assert.match(skill.content, /review/i);
    assert.ok(artifacts.some(entry => entry.path === `.agents/skills/standard-${id}/SKILL.md`));
  }
});

test('actual .NET manifests discover explicit build/test commands without executing them and select .NET development guidance', t => {
  const { root, config } = fixture(t, true);
  const scan = scanProject(root, { probeEnvironment: false });
  assert.ok(scan.commands.some(entry => entry.command === 'dotnet test Member.slnx'));
  assert.ok(scan.commands.some(entry => entry.command === 'dotnet build Member.slnx'));
  const artifacts = buildArtifacts(config, scan);
  assert.ok(artifacts.some(entry => entry.path === 'docs/ai/skills/standards/dotnet-development/SKILL.md'));
  assert.match(artifacts.find(entry => entry.path === 'docs/ai/skills/platform-dotnet/SKILL.md').content, /standards\/dotnet-development\/SKILL\.md/);
  assert.match(artifacts.find(entry => entry.path === 'src/Member/AGENTS.md').content, /standards\/dotnet-development\/SKILL\.md/);
  assert.equal(fs.existsSync(path.join(root, 'src/Member/obj')), false);
  assert.equal(scan.commands.find(entry => entry.command === 'dotnet test Member.slnx').verification.trust.level, 'declared');
});

test('production tasks and bounded bugfixes receive required development Skills; drift blocks the handoff instruction', t => {
  const { root, config } = fixture(t);
  for (const input of [
    { text: 'Add member editor', paths: ['src/member.mjs'] },
    { text: 'Fix member display', paths: ['src/member.mjs'], taskKind: 'bugfix', bugfix: { reproducible: true, boundedFix: true } },
  ]) {
    const task = planTask(root, input);
    assert.equal(task.developmentGuidance.status, 'ready');
    assert.ok(task.developmentGuidance.skills.some(entry => entry.id === 'proportionate-design'));
    assert.equal(task.developmentGuidance.application, 'unverified');
    const handoff = buildTaskHandoff({ root, config, phase: 'applied', task, text: input.text, paths: input.paths, scope: 'MEMBER' });
    assert.match(handoff.prompt, /Required development Skill/);
  }
  fs.appendFileSync(path.join(root, 'docs/ai/skills/standards/module-boundaries/SKILL.md'), '\nUnreviewed edit\n');
  const task = planTask(root, { text: 'Add member editor', paths: ['src/member.mjs'] });
  assert.equal(task.developmentGuidance.status, 'needs-sync');
  const guide = buildTaskHandoff({ root, config, phase: 'applied', task, text: 'Add member editor', scope: 'MEMBER' });
  assert.equal(guide.nextAction.id, 'sync-development-guidance');
  assert.equal(guide.verification, 'unverified');
});

test('read-only routing does not load development Skills or add development ceremony', t => {
  const { root } = fixture(t);
  const task = planTask(root, { text: 'Explain only the member module' });
  assert.equal(task.route.level, 'L0');
  assert.equal(task.developmentGuidance.status, 'not-required');
  assert.deepEqual(task.developmentGuidance.skills, []);
});

test('an explicit project production floor overrides the generic bounded bugfix shortcut', t => {
  const { root, config } = fixture(t);
  config.taskRouting = { productionMinimumLevel: 'L2' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  const task = planTask(root, { text: 'Fix member display', paths: ['src/member.mjs'], taskKind: 'bugfix', bugfix: { reproducible: true, boundedFix: true } });
  assert.equal(task.route.level, 'L2');
  assert.ok(task.route.reasonCodes.includes('path-evidence:project-production-floor'));
});

test('known earlier Workflow templates remain valid without changing approved bytes or accepting removed baseline gates', t => {
  const { root, config } = fixture(t);
  const current = workflowDocument(config);
  const legacy = current.split('\n').filter(line => !line.startsWith('Architecture documentation and development standards share analysis.') && !line.startsWith('New projects present the concrete design for customer confirmation')).join('\n');
  assert.notEqual(legacy, current);
  const approve = content => {
    fs.writeFileSync(path.join(root, 'docs/WORKFLOW.md'), content);
    const receipt = JSON.stringify({ kind: 'workflow-content-preservation', status: 'APPROVED', source: 'owner-message', path: 'docs/WORKFLOW.md', sha256: sha256(content) });
    fs.writeFileSync(path.join(root, 'workflow-approval.json'), receipt);
    config.workflowPreservation = { contentSha256: sha256(content), approvalPath: 'workflow-approval.json', approvalSha256: sha256(receipt) };
  };
  approve(legacy);
  const built = buildWorkflowArtifacts(config, root);
  assert.equal(built.artifacts[0].content, legacy);
  assert.equal(built.compatibility.status, 'preserved-legacy');
  approve(legacy.replace('## Definition of done', '## Removed'));
  assert.throws(() => buildWorkflowArtifacts(config, root), /template/i);
});

test('archived governance evidence is not business implementation while product inputs remain in scope', () => {
  assert.equal(isProductionScopePath('governance/changes/review/logs/result.json'), false);
  assert.equal(isProductionScopePath('governance/changes/review/before/src/member.cs'), false);
  assert.equal(isProductionScopePath('.aicgignore'), false);
  for (const file of ['src/Member.cs', 'Directory.Build.props', 'tools/desktop/package.py', 'src/tools/dist/runtime.mjs', 'governance/validate.py']) assert.equal(isProductionScopePath(file), true, file);
});

test('archived project copies stay visible as evidence but cannot generate development units or select runtime dependencies', t => {
  const { root, config } = fixture(t, true);
  const directory = path.join(root, 'governance/changes/sample/before/Old.Tests');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'Old.Tests.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />');
  fs.writeFileSync(path.join(directory, 'Old.cs'), 'public class Old {}');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const scan = scanProject(root, { probeEnvironment: false });
  assert.ok(scan.files.some(entry => entry.relative.endsWith('/Old.Tests.csproj')));
  assert.equal(Boolean(scan.packageDependencies.react), false);
  const artifacts = buildArtifacts(config, scan);
  assert.equal(artifacts.some(entry => entry.path.startsWith('governance/changes/')), false);
  const index = JSON.parse(artifacts.find(entry => entry.path === 'docs/ai/development/index.json').content);
  assert.equal(index.units.some(unit => unit.path.startsWith('governance/changes/')), false);
});

test('.NET unit entrypoints use their own manifests even after the bounded stack evidence sample is full', t => {
  const { root, config } = fixture(t, true);
  for (let index = 0; index < 12; index++) {
    const directory = path.join(root, `src/Feature${index}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'Feature.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />');
  }
  const artifacts = buildArtifacts(config, scanProject(root));
  const entrypoints = artifacts.filter(entry => /^src\/Feature\d+\/AGENTS\.md$/.test(entry.path));
  assert.equal(entrypoints.length, 12);
  for (const entry of entrypoints) assert.match(entry.content, /standards\/dotnet-development\/SKILL\.md/, entry.path);
});
