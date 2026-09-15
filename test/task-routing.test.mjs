import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { artifactDefinitions, selectedArtifactDefinitions } from '../src/modules/governance/compiler.mjs';
import { classifyTaskRoute, minimumTaskLevelFromPaths } from '../src/modules/governance/index.mjs';

test('task route level is the maximum required by mutation scope and risk', () => {
  for (const [input, expected] of [
    [{ mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' }, 'L0'],
    [{ mutation: 'non-production', scope: 'single-file', risk: 'low', clarity: 'clear' }, 'L1'],
    [{ mutation: 'product-behavior', scope: 'single-module', risk: 'business', clarity: 'clear' }, 'L2'],
    [{ mutation: 'product-behavior', scope: 'multi-surface', risk: 'business', clarity: 'clear' }, 'L3'],
    [{ mutation: 'external-action', scope: 'single-module', risk: 'high-consequence', clarity: 'clear' }, 'L3'],
  ]) {
    assert.equal(classifyTaskRoute(input).level, expected);
  }
});

test('exploratory clarity adds discovery without escalating a low-risk route', () => {
  const route = classifyTaskRoute({ mutation: 'governance-only', scope: 'single-file', risk: 'low', clarity: 'exploratory' });
  assert.equal(route.level, 'L1');
  assert.deepEqual(route.requiredApprovals, ['discovery']);
  assert.deepEqual(route.overlays, ['discovery']);
});

test('task route returns stable profiles approvals verification and reason codes', () => {
  assert.deepEqual(
    classifyTaskRoute({ mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' }),
    {
      level: 'L0',
      profile: 'ordinary',
      requiredApprovals: [],
      verificationClass: 'read-only',
      overlays: [],
      reasonCodes: ['mutation:none', 'scope:single-file', 'risk:low', 'clarity:clear'],
    },
  );
  assert.deepEqual(
    classifyTaskRoute({ mutation: 'product-behavior', scope: 'multi-module', risk: 'business', clarity: 'locally-ambiguous' }),
    {
      level: 'L2',
      profile: 'behavior_change',
      requiredApprovals: ['clarification', 'requirements', 'plan'],
      verificationClass: 'behavior',
      overlays: ['clarification'],
      reasonCodes: ['mutation:product-behavior', 'scope:multi-module', 'risk:business', 'clarity:locally-ambiguous'],
    },
  );
  assert.deepEqual(
    classifyTaskRoute({ mutation: 'external-action', scope: 'single-module', risk: 'high-consequence', clarity: 'clear' }).requiredApprovals,
    ['requirements', 'design', 'plan', 'external-action'],
  );
});

test('task route rejects every unsupported input enum fail closed', () => {
  const valid = { mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' };
  for (const field of ['mutation', 'scope', 'risk', 'clarity']) {
    assert.throws(
      () => classifyTaskRoute({ ...valid, [field]: 'unsupported' }),
      (error) => error.code === 'AICG_USAGE' && error.message.includes(field),
    );
  }
});

test('changed paths conservatively raise the minimum task level', () => {
  for (const [paths, expected] of [
    [[], 'L0'],
    [['README.md'], 'L1'],
    [['test/widget.test.mjs'], 'L1'],
    [['src/widget.mjs'], 'L2'],
    [['backend/orders/service.go'], 'L2'],
    [['cmd/server/main.go'], 'L2'],
    [['package-lock.json'], 'L2'],
    [['Cargo.toml'], 'L2'],
    [['Pipfile.lock'], 'L2'],
    [['pom.xml'], 'L2'],
    [['gradle.lockfile'], 'L2'],
    [['contracts/public-api.yaml'], 'L2'],
    [['prisma/schema.prisma'], 'L2'],
    [['db/migrations/20260915-add-account.sql'], 'L3'],
    [['src/authorization/policy.mjs'], 'L3'],
    [['src/payments/settle.mjs'], 'L3'],
    [['src/tenants/isolation.mjs'], 'L3'],
    [['apps/web/editor.mjs', 'apps/api/editor.mjs'], 'L3'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths(paths, { confirmedRiskSignals: [] }), expected, paths.join(', '));
  }
  assert.equal(minimumTaskLevelFromPaths(['docs/guide.md'], { confirmedRiskSignals: ['public-api'] }), 'L2');
  assert.equal(minimumTaskLevelFromPaths(['docs/guide.md'], { confirmedRiskSignals: ['external-side-effect'] }), 'L3');
});

test('changed path classification rejects malformed paths and risk configuration', () => {
  for (const paths of [null, ['../outside.mjs'], ['/absolute.mjs'], ['src//bad.mjs'], [42]]) {
    assert.throws(() => minimumTaskLevelFromPaths(paths, {}), (error) => error.code === 'AICG_USAGE');
  }
  assert.throws(
    () => minimumTaskLevelFromPaths(['README.md'], { confirmedRiskSignals: ['guessed-risk'] }),
    (error) => error.code === 'AICG_USAGE' && /confirmedRiskSignals/.test(error.message),
  );
});

test('routing policy is selected through routing metadata only for standard and complete', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-routing-policy-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'] };

  const definition = artifactDefinitions({ ...base, governanceDepth: 'standard' }, scan)
    .find((candidate) => candidate.path === 'docs/ai/task-routing-policy.json');
  assert.equal(definition.capability, 'routing');
  assert.equal(definition.activation, 'selected');
  assert.deepEqual(definition.routeProfiles, []);

  for (const governanceDepth of ['standard', 'complete']) {
    assert.ok(selectedArtifactDefinitions({ ...base, governanceDepth }, scan).some((candidate) => candidate.path === definition.path));
  }
  assert.equal(selectedArtifactDefinitions({ ...base, governanceDepth: 'minimal' }, scan).some((candidate) => candidate.path === definition.path), false);
});

test('generated routing policy keeps stable English fields and localizes prose', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-routing-language-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  const generate = (artifactLanguage) => buildArtifacts({ ...base, artifactLanguage }, scan);
  const english = JSON.parse(generate('en').find((artifact) => artifact.path === 'docs/ai/task-routing-policy.json').content);
  const chinese = JSON.parse(generate('zh-CN').find((artifact) => artifact.path === 'docs/ai/task-routing-policy.json').content);

  assert.deepEqual(Object.keys(english), ['schemaVersion', 'input', 'output', 'levels', 'escalation', 'pathRules']);
  assert.deepEqual(Object.keys(chinese), Object.keys(english));
  assert.deepEqual(english.input, chinese.input);
  assert.deepEqual(english.output, chinese.output);
  assert.deepEqual(english.levels.map(({ id, profile, requiredApprovals, verificationClass }) => ({ id, profile, requiredApprovals, verificationClass })),
    chinese.levels.map(({ id, profile, requiredApprovals, verificationClass }) => ({ id, profile, requiredApprovals, verificationClass })));
  assert.match(english.levels[0].description, /read-only/i);
  assert.match(chinese.levels[0].description, /只读/);
});

test('minimal keeps a short localized routing summary in AGENTS without policy materialization', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-routing-minimal-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  for (const [artifactLanguage, expected] of [['en', /L0.*read-only.*L1.*low-risk.*Escalate/s], ['zh-CN', /L0.*只读.*L1.*低风险.*升级/s]]) {
    const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'minimal', artifactLanguage }, scan);
    assert.equal(artifacts.some((artifact) => artifact.path === 'docs/ai/task-routing-policy.json'), false);
    assert.match(artifacts.find((artifact) => artifact.path === 'AGENTS.md').content, expected);
  }
});
