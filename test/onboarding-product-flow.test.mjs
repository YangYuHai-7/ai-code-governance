import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assessArchitecture } from '../src/architecture-assessment.mjs';
import { artifactDefinitions, buildArtifacts, buildArtifactsWithDefinitions, defaultConfig, governanceCommand, validateConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { promptAdaptiveDecisions, promptConfig, promptGuidedConfig } from '../src/cli/prompts.mjs';
import { addReadOnlyGuidance, initSuccessGuidance, printHumanGuidance } from '../src/cli/read-only-guidance.mjs';
import { COMMAND_HANDLERS, COMMAND_REGISTRY } from '../src/cli/command-registry.mjs';

const cli = path.resolve('bin/aicg.js');
const part = new URL(import.meta.url).searchParams.get('part') ?? 'unit';
const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

if (part === 'unit') {

test('lazy command architecture resolves every declared handler and preserves dispatch keys and arguments', async () => {
  const expected = ['help', 'version', 'request', 'init', 'enrich', 'evidence', 'team', 'complete', 'work-unit', 'hook', 'release-check', 'doctor', 'assess', 'architecture', 'standards', 'harvest', 'promote', 'check', 'sync'];
  assert.deepEqual(Object.keys(COMMAND_REGISTRY).sort(), expected.sort());
  assert.deepEqual(Object.keys(COMMAND_HANDLERS).sort(), expected.filter((name) => !['help', 'version'].includes(name)).sort());
  for (const [command, definition] of Object.entries(COMMAND_HANDLERS)) {
    const module = await import(new URL(`../src/cli/${definition.module}`, import.meta.url));
    assert.equal(typeof module[definition.exportName], 'function', `${command}: missing export`);
    assert.deepEqual(definition.argumentKeys, ['hook', 'evidence', 'work-unit'].includes(command) ? ['target', 'action', 'options'] : command === 'standards' ? ['target'] : ['target', 'options']);
  }
  const registry = fs.readFileSync(new URL('../src/cli/command-registry.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(registry, /^import .* from ['"]\.\/commands\//m, 'help/version must not eagerly load command implementations');
});

test('adaptive prompts keep recommendations deferred and metadata inspection does not approve', async () => {
  const answers = ['4', '', '3'];
  const choices = await promptAdaptiveDecisions({ skills: { candidates: [{ id: 'offline-skill', permissions: ['read-project'] }] }, team: { roleProposals: [{ id: 'domain-review', title: 'Domain review' }] } }, {
    readline: { question: async () => answers.shift() }, locale: 'en',
  });
  assert.deepEqual(choices, { skills: [{ id: 'offline-skill', action: 'defer' }], roles: [{ id: 'domain-review', action: 'reject' }] });
});

test('single-pass compilation preserves every artifact and deselected seed definition used by prune', (context) => {
  const root = fixture('single-pass-compiler');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'] };
  const compiled = buildArtifactsWithDefinitions(config, scan);
  assert.deepEqual(compiled.artifacts, buildArtifacts(config, scan));
  assert.deepEqual(compiled.definitions.map(({ path, ownership }) => ({ path, ownership })), artifactDefinitions(config, scan).map(({ path, ownership }) => ({ path, ownership })));
  assert.ok(compiled.definitions.some((entry) => entry.path === 'docs/ai/skills/generic-unknown/SKILL.md' && entry.ownership === 'seed'));
});

}

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-onboarding-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function writeBrownfield(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'brownfield', dependencies: { react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const App = () => null;\n');
}

function scriptedReadline(answers) {
  return {
    question: async () => answers.shift() ?? '',
    close() {},
  };
}

async function capturePromptLabels(callback) {
  const labels = [];
  const original = console.log;
  console.log = (message = '') => {
    const text = String(message);
    if (text.startsWith('\n')) labels.push(text.trim());
  };
  try {
    const value = await callback();
    return { labels, value };
  } finally {
    console.log = original;
  }
}

function humanGuidanceLines(result) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    printHumanGuidance(result);
    return lines;
  } finally {
    console.log = original;
  }
}

if (part === 'unit') {

test('pinned init success places a localized installation prerequisite beside its daily command', (context) => {
  const root = fixture('pinned-success-prerequisite');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  for (const [locale, label, message] of [
    ['en', 'PREREQUISITE: ', 'Temporary pinned bootstrap does not install a persistent CLI. First verify an installed project-local or global AICG executable and use the matching invocation mode. If none is available, stop and request an explicit installation or choice; never resolve a remote package automatically.'],
    ['zh-CN', '运行前提：', '临时固定版本启动不会安装持久 CLI。请先确认项目本地或全局 AICG 可执行文件确实可用，并使用匹配的调用方式。若均不可用，停止并请求显式安装或选择；不要自动解析远程包。'],
  ]) {
    const result = initSuccessGuidance({ ...defaultConfig(scan), invocationMode: 'npm-exec-pinned', interactionLanguage: locale });
    assert.equal(result.actionGuide.recommendedAction.command, 'aicg check . --json');
    assert.deepEqual(result.actionGuide.recommendedAction.invocationPrerequisite, {
      id: 'installed-aicg-cli', status: 'verification-required', onMissing: 'stop-and-request-explicit-install-or-selection', allowRemotePackageResolution: false, message,
    });
    const lines = humanGuidanceLines(result);
    assert.equal(lines[2], `${label}${message}`);
    assert.doesNotMatch(lines.join('\n'), /npm exec --yes --package/);
  }
});

test('pinned read-only commands carry installation prerequisites without warning local or global modes', (context) => {
  const root = fixture('pinned-read-only-prerequisite');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  for (const locale of ['en', 'zh-CN']) {
    const config = { ...defaultConfig(scan), invocationMode: 'npm-exec-pinned' };
    const result = addReadOnlyGuidance('doctor', { ok: true }, scan, { config, locale });
    assert.equal(result.actionGuide.recommendedAction.command, `aicg assess . --locale ${locale} --json`);
    const prerequisite = result.actionGuide.recommendedAction.invocationPrerequisite;
    assert.equal(prerequisite?.id, 'installed-aicg-cli');
    assert.equal(prerequisite.status, 'verification-required');
    assert.equal(prerequisite.allowRemotePackageResolution, false);
    for (const action of result.nextSteps.filter((step) => step.command)) assert.deepEqual(action.invocationPrerequisite, prerequisite);
    assert.equal(humanGuidanceLines(result)[2], `${locale === 'en' ? 'PREREQUISITE: ' : '运行前提：'}${prerequisite.message}`);
    assert.doesNotMatch(JSON.stringify(result), /npm exec --yes --package/);
    assert.match(prerequisite.message, locale === 'en' ? /Temporary pinned bootstrap.*persistent CLI/ : /临时固定版本启动不会安装持久 CLI/);
  }
  for (const invocationMode of ['project-local', 'global']) {
    const config = { ...defaultConfig(scan), invocationMode };
    for (const result of [initSuccessGuidance(config), addReadOnlyGuidance('doctor', { ok: true }, scan, { config })]) {
      assert.equal(Object.hasOwn(result.actionGuide.recommendedAction, 'invocationPrerequisite'), false);
      assert.equal(humanGuidanceLines(result).length, 4);
      assert.doesNotMatch(humanGuidanceLines(result).join('\n'), /bootstrap|PREREQUISITE/);
    }
  }
});

test('guided onboarding asks clients first and artifact language second', async (context) => {
  const root = fixture('guided-preset');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const readline = scriptedReadline(['1', '', '1', '', '1', '1']);

  const { labels, value: config } = await capturePromptLabels(
    () => promptGuidedConfig(scan, defaultConfig(scan), { readline }),
  );
  assert.deepEqual(labels.slice(0, 2), [
    'Which AI coding tools should this project support? / 要支持哪些 AI 编码工具？',
    'Governance artifact language / 治理产物语言',
  ]);
  assert.equal(config.interactionLanguage, 'en');
  assert.equal(config.artifactLanguage, 'en');
  assert.equal(config.codeDocumentationPolicy, 'en');
  assert.deepEqual(config.clientSupport, { mode: 'selected', selectedClients: ['codex'], source: 'interactive' });
  assert.deepEqual(config.clients, ['codex']);
  assert.deepEqual(config.initialization, { lifecycle: 'greenfield', existingCodeStrategy: null, source: null });
  assert.deepEqual(config.stacks, ['generic-unknown']);
  assert.equal(config.governanceDepth, 'minimal');
  assert.equal(config.invocationMode, 'npm-exec-pinned');
  assert.equal(config.features.aiAssist, false);
  assert.equal(config.features.knowledge, true);
  assert.deepEqual(config.supportedOs, ['macos', 'windows', 'linux']);
  assert.ok(config.initialClassification.requiredDecisions.some((decision) => decision.id === 'architecture-not-established' && decision.status === 'not-established'));
});

test('guided onboarding only recommends project-local when the package and executable exist', async (context) => {
  const root = fixture('local-executable');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { 'ai-code-governance': '0.2.0' } }));
  const prompt = () => {
    const scan = scanProject(root);
    return promptGuidedConfig(scan, defaultConfig(scan), { locale: 'en', readline: scriptedReadline(['1', '', '1', '', '1', '1']) });
  };
  assert.equal((await prompt()).invocationMode, 'npm-exec-pinned', 'a declared dependency is not an installed executable');
  const installed = path.join(root, 'node_modules', 'ai-code-governance');
  fs.mkdirSync(installed);
  fs.copyFileSync('package.json', path.join(installed, 'package.json'));
  fs.cpSync('bin', path.join(installed, 'bin'), { recursive: true });
  fs.chmodSync(path.join(installed, 'bin', 'aicg.js'), 0o755);
  for (const directory of ['src', 'assets']) fs.symlinkSync(path.resolve(directory), path.join(installed, directory), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await prompt()).invocationMode, 'npm-exec-pinned', 'a package without its bin entry is not locally invocable');
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'aicg.cmd' : 'aicg');
  if (process.platform === 'win32') fs.writeFileSync(bin, '@node "%~dp0%\\..\\ai-code-governance\\bin\\aicg.js" %*\r\n');
  else fs.symlinkSync('../ai-code-governance/bin/aicg.js', bin);
  const scan = scanProject(root);
  assert.equal(defaultConfig(scan).invocationMode, 'project-local');
  assert.equal((await prompt()).invocationMode, 'project-local');
  // The real offline npm execution probe shares the installed package fixture in packaged-projects.
  // This fast test isolates filesystem availability, including the missing-bin regressions below.
  const config = { ...defaultConfig(scan), invocationMode: 'project-local' };
  assert.equal(governanceCommand(config, 'check .'), 'npm exec -- aicg check .');
  for (const artifact of buildArtifacts(config, scan)) assert.doesNotMatch(artifact.content, /npm exec --yes --package/);
  fs.unlinkSync(bin);
  assert.equal((await prompt()).invocationMode, 'npm-exec-pinned');
});

test('missing local executable requires an explicit bootstrap or global choice and preserves existing mode', async (context) => {
  const root = fixture('invocation-choice');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  await assert.rejects(promptGuidedConfig(scan, defaultConfig(scan), {
    locale: 'en', readline: scriptedReadline(['1', '', '1', '', '1', '']),
  }), /explicit selection/i);
  const global = await promptGuidedConfig(scan, defaultConfig(scan), {
    locale: 'en', readline: scriptedReadline(['1', '', '1', '', '1', '2']),
  });
  assert.equal(global.invocationMode, 'global');
  for (const invocationMode of ['project-local', 'global', 'npm-exec-pinned']) {
    const existing = await promptGuidedConfig(scan, { ...defaultConfig(scan), invocationMode }, {
      locale: 'en', preserveInvocation: true, readline: scriptedReadline(['1', '', '1', '', '1']),
    });
    assert.equal(existing.invocationMode, invocationMode);
  }
});

test('legacy pinned config retains its mode while daily artifacts require installation and bootstrap stays separate', (context) => {
  const root = fixture('legacy-pinned-daily');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), invocationMode: 'npm-exec-pinned' };
  const artifacts = buildArtifacts(config, scan);
  const content = (relative) => artifacts.find((artifact) => artifact.path === relative).content;
  assert.equal(JSON.parse(content('.ai-governance/config.json')).invocationMode, 'npm-exec-pinned');
  assert.equal(governanceCommand(config, 'complete .'), 'aicg complete .');
  assert.match(content('AGENTS.md'), /unavailable.*stop.*install/i);
  assert.ok(content('docs/ai/bootstrap-prompt.md').includes(`npm exec --yes --package=ai-code-governance@${packageVersion} -- aicg`));
  for (const artifact of artifacts.filter((entry) => entry.path !== 'docs/ai/bootstrap-prompt.md')) assert.doesNotMatch(artifact.content, /npm exec --yes --package/);
});

test('guided existing-project onboarding shows detected stacks and requires confirmation or correction', async (context) => {
  const root = fixture('guided-existing-stack');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBrownfield(root);
  const scan = scanProject(root);

  const confirmed = await capturePromptLabels(() => promptGuidedConfig(
    scan,
    defaultConfig(scan),
    { locale: 'zh-CN', readline: scriptedReadline(['1', '', '2', '1', '1', '1', '1']) },
  ));
  assert.equal(confirmed.value.artifactLanguage, 'en');
  assert.equal(confirmed.value.codeDocumentationPolicy, 'inherit-existing');
  assert.deepEqual(confirmed.value.stacks, ['frontend-react']);
  assert.equal(confirmed.labels[0], '要支持哪些 AI 编码工具？');
  assert.equal(confirmed.labels[1], '治理产物语言');
  assert.ok(confirmed.labels.some((label) => label.includes('检测到的技术栈：frontend-react')));
  assert.ok(confirmed.labels.some((label) => label === '确认或修正检测到的技术栈？'));

  const corrected = await capturePromptLabels(() => promptGuidedConfig(
    scan,
    defaultConfig(scan),
    { locale: 'en', readline: scriptedReadline(['1', '', '2', '2', '4', '1', '1', '1']) },
  ));
  assert.deepEqual(corrected.value.stacks, ['backend-node']);
  assert.ok(corrected.labels.some((label) => label === 'Correct technology stacks'));
});

test('full onboarding accepts ordinary constraints with no confirmed risk signals', async (context) => {
  const root = fixture('full-optional-risk-signals');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const readline = scriptedReadline([
    '1', '', '', '1', '', '', '', '',
    'Every workspace belongs to one owner.', '', '',
  ]);

  const config = await promptConfig(scan, defaultConfig(scan), { locale: 'en', readline });

  assert.deepEqual(config.domainConstraints, ['Every workspace belongs to one owner.']);
  assert.deepEqual(config.confirmedRiskSignals, []);
  assert.equal(config.features.aiAssist, false);
});

test('guided client multi-select normalizes unordered duplicate input to registry order', async (context) => {
  const root = fixture('guided-client-order');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);

  for (const [answer, expectedClients, expectedMode] of [
    ['3,2,1,1', ['codex', 'claude-code', 'cursor'], 'all-built-in'],
    ['3,1,3', ['codex', 'cursor'], 'selected'],
  ]) {
    const config = await promptGuidedConfig(
      scan,
      defaultConfig(scan),
      { locale: 'en', readline: scriptedReadline([answer, '', '1', '', '1', '1']) },
    );
    assert.deepEqual(config.clients, expectedClients);
    assert.deepEqual(config.clientSupport.selectedClients, expectedClients);
    assert.equal(config.clientSupport.mode, expectedMode);
    assert.doesNotThrow(() => validateConfig({
      ...config,
      initialization: { ...config.initialization, source: 'interactive' },
    }));
  }

  await assert.rejects(
    promptGuidedConfig(
      scan,
      defaultConfig(scan),
      { locale: 'en', readline: scriptedReadline([',']) },
    ),
    /Select at least one value/,
  );
});

}

if (part === 'cli-a') {

test('Chinese and English human discovery output gives one plain-language action, reason, boundary, and exact command', (context) => {
  const root = fixture('human-guidance');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'manifest-only' }));

  for (const [locale, labels] of [
    ['zh-CN', ['建议操作：', '下一条命令：', '原因：', '边界：']],
    ['en', ['ACTION: ', 'NEXT COMMAND: ', 'REASON: ', 'BOUNDARY: ']],
  ]) {
    for (const command of ['doctor', 'assess', 'architecture']) {
      const result = run([command, root, '--locale', locale]);
      assert.equal(result.status, 0, `${command}/${locale}: ${result.stderr}`);
      const lines = result.stdout.trim().split('\n');
      assert.equal(lines.length, 4, `${command}/${locale}: ${result.stdout}`);
      labels.forEach((label, index) => assert.ok(lines[index].startsWith(label), `${command}/${locale}: ${result.stdout}`));
      assert.match(lines[1], new RegExp(`aicg init \\. --guided --locale ${locale}$`));
    }
  }

  const chinese = run(['doctor', root, '--locale', 'zh-CN']);
  assert.doesNotMatch(chinese.stdout, /Git|manifest|enforcement|negative probe/i);
});

test('guided init stays interactive and prints one exact project-local success command', (context) => {
  const root = fixture('guided-safety');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const args of [
    ['init', root, '--guided', '--yes'],
    ['init', root, '--guided', '--config', path.join(root, 'answers.json')],
    ['init', root, '--guided'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  }
});

test('a managed-link warning exposes one recovery action and claim boundary', (context) => {
  const root = fixture('warning-recovery');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'adapter-target'));
  fs.symlinkSync('adapter-target', path.join(root, '.agents'));

  const human = run(['doctor', root, '--locale', 'en']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^ACTION: .*managed adapter link/m);
  assert.match(human.stdout, /^NEXT COMMAND: aicg init \. --guided --locale en --migrate-links$/m);
  assert.match(human.stdout, /^REASON: /m);
  assert.match(human.stdout, /^BOUNDARY: /m);

  const machine = run(['doctor', root, '--locale', 'en', '--json']);
  assert.equal(machine.status, 0, machine.stderr);
  const payload = JSON.parse(machine.stdout);
  assert.equal(payload.actionGuide.warnings.length, 1);
  assert.equal(payload.actionGuide.warnings[0].recoveryAction.command, 'aicg init . --guided --locale en --migrate-links');
  assert.ok(Object.hasOwn(payload, 'nextSteps'));
  assert.ok(Object.hasOwn(payload.actionGuide, 'projectMode'));
  assert.ok(Object.hasOwn(payload.actionGuide, 'lifecycle'));
});

test('non-interactive init requires an explicit client scope and records invocation and language separately', (context) => {
  const root = fixture('scope');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rejected = run(['init', root, '--yes', '--no-assist']);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /Client support scope must be explicit/);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);

  const initialized = run(['init', root, '--clients', 'codex,cursor', '--locale', 'zh-CN', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.deepEqual(config.clientSupport, { mode: 'selected', selectedClients: ['codex', 'cursor'], source: 'cli' });
  assert.equal(config.interactionLanguage, 'zh-CN');
  assert.equal(config.artifactLanguage, 'en');
  assert.equal(config.codeDocumentationPolicy, 'en');
  assert.equal(config.invocationMode, 'npm-exec-pinned');
  assert.equal(config.toolVersion, packageVersion);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /aicg complete \./);
  assert.doesNotMatch(agents, /npm exec --yes --package/);
});

test('legacy explicit clients in a config are normalized without losing compatibility', (context) => {
  const root = fixture('legacy-clients');
  const configRoot = fixture('legacy-clients-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const configPath = path.join(configRoot, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({ clients: ['codex'], interactionLanguage: 'en' }));
  const initialized = run(['init', root, '--config', configPath, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.deepEqual(config.clientSupport, { mode: 'selected', selectedClients: ['codex'], source: 'config' });
});

test('a confirmed new project records that architecture is not established', (context) => {
  const root = fixture('new-project-architecture-gap');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'new-project-scaffold' }));
  const configPath = path.join(root, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    clients: ['codex'],
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null },
  }));

  const initialized = run(['init', root, '--config', configPath, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.ok(config.initialClassification.requiredDecisions.some((decision) => (
    decision.id === 'architecture-not-established' && decision.status === 'not-established'
  )));
});

}

if (part === 'cli-b') {

test('architecture assessment produces stable adoptable ids and an approved selection only changes governance', (context) => {
  const root = fixture('architecture-adoption');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBrownfield(root);
  const first = assessArchitecture(scanProject(root));
  const second = assessArchitecture(scanProject(root));
  assert.equal(first.adoptionPlan.planHash, second.adoptionPlan.planHash);
  assert.match(first.adoptionPlan.planHash, /^[a-f0-9]{64}$/);
  assert.ok(first.recommendedBlueprints.every((profile) => /^[a-f0-9]{64}$/.test(profile.profileHash)));

  const sourceBefore = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const configPath = path.join(root, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    clients: ['codex'],
    architectureApproval: {
      planId: first.adoptionPlan.planId,
      planHash: first.adoptionPlan.planHash,
      optionId: 'staged-migration',
      source: 'user',
    },
  }));
  const initialized = run(['init', root, '--config', configPath, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.equal(config.initialization.existingCodeStrategy, 'staged-migration');
  assert.equal(config.architecture.mode, 'staged-migration-pending');
  assert.deepEqual(config.architecture.scope.roots, []);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'), sourceBefore);
});

test('brownfield enrich is read-only and its exact plan hash can be replayed by init', (context) => {
  const root = fixture('enrich');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBrownfield(root);
  const configPath = path.join(root, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    clients: ['codex'],
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'new-code-standard' },
  }));
  const sourceBefore = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const preview = run(['enrich', root, '--config', configPath, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const payload = JSON.parse(preview.stdout);
  assert.equal(payload.readOnly, true);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  assert.match(payload.cta.applyExactPlan, /--approve [a-f0-9]{64}$/);

  const stale = run(['init', root, '--config', configPath, '--yes', '--approve', '0'.repeat(64), '--no-assist']);
  assert.equal(stale.status, 2);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  const applied = run(['init', root, '--config', configPath, '--yes', '--approve', payload.plan.planHash, '--no-assist']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'), sourceBefore);
});

test('help exposes Chinese onboarding while preserving English artifact language controls', () => {
  const result = run(['help', '--locale', 'zh-CN']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /客户端支持范围必须显式选择/);
  assert.match(result.stdout, /artifactLanguage/);
  assert.match(result.stdout, /--locale 只控制交互语言/);
  assert.match(result.stdout, /治理产物默认使用英语/);
});

test('read-only discovery commands expose locale-aware action guides and distinguish scan shape from lifecycle', (context) => {
  const root = fixture('localized-guidance');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'manifest-only' }));

  for (const command of ['doctor', 'assess', 'architecture']) {
    const result = run([command, root, '--locale', 'zh-CN', '--json']);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.actionGuide.locale, 'zh-CN');
    assert.equal(payload.actionGuide.readOnly, true);
    assert.match(payload.actionGuide.projectMode.meaning, /扫描到的仓库形态/);
    assert.match(payload.actionGuide.lifecycle.meaning, /需要用户确认/);
    assert.ok(payload.nextSteps.length > 0);
  }

  const english = run(['assess', root, '--locale', 'en', '--json']);
  assert.equal(english.status, 0, english.stderr);
  assert.match(JSON.parse(english.stdout).actionGuide.projectMode.meaning, /scan shape/i);

  const humanDoctor = run(['doctor', root, '--locale', 'zh-CN']);
  assert.equal(humanDoctor.status, 0, humanDoctor.stderr);
  assert.match(humanDoctor.stdout, /^建议操作：请选择“新项目”或“已有项目”/m);
  assert.match(humanDoctor.stdout, /^下一条命令：aicg init \. --guided --locale zh-CN$/m);
  assert.match(humanDoctor.stdout, /^边界：本次结果只解释当前仓库证据/m);

  const invalid = run(['assess', root, '--locale', 'fr', '--json']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /locale must be one of: zh-CN, en/);
});

test('post-init source and scripts produce read-only rescan CTAs without mutating governance', (context) => {
  const root = fixture('post-init-rescan');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = run(['init', root, '--clients', 'codex', '--locale', 'zh-CN', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  for (const args of [
    ['init'], ['add', '--all'],
    ['-c', 'user.name=AICG Test', '-c', 'user.email=aicg@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'governance baseline'],
  ]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const configPath = path.join(root, '.ai-governance', 'config.json');
  const configBefore = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'post-init-rescan',
    private: true,
    scripts: { test: 'node --test' },
  }));
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app', 'main.js'), 'export const ready = true;\n');

  const checked = run(['check', root, '--json']);
  assert.equal(checked.status, 0, `${checked.stderr}\n${checked.stdout}`);

  const assessed = run(['assess', root, '--locale', 'zh-CN', '--json']);
  assert.equal(assessed.status, 0, assessed.stderr);
  const payload = JSON.parse(assessed.stdout);
  assert.equal(payload.actionGuide.postInitRescan.recommended, true);
  assert.equal(payload.actionGuide.postInitRescan.mutatesConfiguration, false);
  assert.ok(payload.actionGuide.postInitRescan.newSourcePaths.includes('src/app/main.js'));
  assert.deepEqual(payload.actionGuide.allowedVerificationCommands, ['npm run test']);
  assert.ok(payload.nextSteps.some((step) => step.id === 'review-current-architecture' && step.readOnly === true));
  assert.ok(payload.nextSteps.some((step) => step.id === 'preview-current-standards' && step.readOnly === true));
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);

  const completed = run(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(completed.status, 1, `${completed.stderr}\n${completed.stdout}`);
  const completion = JSON.parse(completed.stdout);
  assert.equal(completion.ok, false);
  assert.equal(completion.taskRoute.status, 'unverified-declaration');
  assert.equal(completion.projectVerification.command, 'npm run test');
  assert.equal(completion.projectVerification.status, 'passed');
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);
});

}
