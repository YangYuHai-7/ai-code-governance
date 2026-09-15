import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { artifactDefinitions, selectedArtifactDefinitions } from '../src/modules/governance/compiler.mjs';
import { classifyTaskRoute, minimumTaskLevelFromPaths, taskRoutingPolicy } from '../src/modules/governance/index.mjs';
import { matchSimpleGlob } from '../src/shared/index.mjs';
import * as routing from '../src/modules/governance/task-routing.mjs';

test('completion routes compare declarations with canonical path and owner risk minimums', () => {
  for (const [paths, config, declaredLevel, minimumLevel, status] of [
    [[], {}, 'L0', 'L0', 'verified'],
    [['README.md'], {}, 'L0', 'L1', 'upgrade-required'],
    [['src/widget.mjs'], {}, 'L1', 'L2', 'upgrade-required'],
    [['apps/web/widget.mjs', 'apps/api/widget.mjs'], {}, 'L2', 'L3', 'upgrade-required'],
    [['docs/guide.md'], { confirmedRiskSignals: ['external-side-effect'] }, 'L2', 'L3', 'upgrade-required'],
    [['src/payment.mjs'], {}, 'L3', 'L3', 'verified'],
    [['src/widget.mjs'], {}, null, 'L2', 'unverified-declaration'],
  ]) {
    const result = routing.evaluateCompletionTaskRoute(paths, config, declaredLevel);
    assert.equal(result.declaredLevel, declaredLevel);
    assert.equal(result.minimumLevel, minimumLevel);
    assert.equal(result.status, status);
    assert.ok(result.reasons.length > 0);
  }
});

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

test('task route accepts only primitive strings for every enum field', () => {
  const valid = { mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' };
  for (const field of ['mutation', 'scope', 'risk', 'clarity']) {
    for (const value of [[valid[field]], new String(valid[field]), null, 1, true, {}]) {
      assert.throws(
        () => classifyTaskRoute({ ...valid, [field]: value }),
        (error) => error.code === 'AICG_USAGE' && error.message.includes(field),
      );
    }
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

test('ordinary documentation and tests take precedence over incidental risk and surface names', () => {
  for (const paths of [
    ['docs/payments/guide.md'],
    ['docs/api/guide.md'],
    ['docs/deploy/guide.md'],
    ['docs/infra/guide.md'],
    ['docs/schema.md'],
    ['src/__tests__/widget.test.mjs'],
    ['src/payments/widget.test.mjs'],
    ['test/deploy/deploy.test.mjs'],
    ['test/infra/infra.test.mjs'],
    ['test/openapi.test.mjs'],
    ['docs/web/guide.md', 'docs/api/guide.md'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths(paths, { confirmedRiskSignals: [] }), 'L1', paths.join(', '));
  }
});

test('migration directories elevate non-document artifacts across supported source ecosystems', () => {
  for (const relative of [
    'db/migrations/001-add-account.php',
    'db/migrations/002-add-account.cs',
    'db/migrations/003-add-account.mjs',
    'db/migrations/004-add-account.kt',
    'db/migrations/005-add-account.yaml',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L3', relative);
  }
  for (const relative of [
    'db/migrations/README.md',
    'docs/migrations/guide.md',
    'test/migrations/runner.test.mjs',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L1', relative);
  }
});

test('machine SQL schemas require L2 without lowering SQL migrations or ordinary documentation', () => {
  for (const relative of [
    'schema.sql',
    'test/fixtures/schema.sql',
    'test/fixtures/account.schema.sql',
    'contract.sql',
    'test/fixtures/account.contract.sql',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L2', relative);
  }
  for (const [relative, expected] of [
    ['db/migrations/schema.sql', 'L3'],
    ['docs/schema.md', 'L1'],
    ['docs/contract.md', 'L1'],
    ['test/schema.test.sql', 'L1'],
    ['queries/schematics.sql', 'L1'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), expected, relative);
  }
});

for (const relative of [
  'src/payment.schema.sql',
  'payment/schema.sql',
  'db/account.migration.schema.sql',
  'infra/schema.sql',
  'scripts/deploy/schema.sql',
]) {
  test(`SQL schema matching does not lower L3 risk for ${relative}`, () => {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L3');
  });
}

test('sensitive tokens recognize delimited filenames without substring false positives', () => {
  for (const relative of [
    'src/auth.ts',
    'config/auth.yaml',
    'src/auth-session.mjs',
    'config/auth_policy.yml',
    'src/check-permission.ts',
    'scripts/process-payment.mjs',
    'config/session-authorization.yaml',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L3', relative);
  }
  for (const [relative, expected] of [
    ['src/author.ts', 'L2'],
    ['src/oauth.ts', 'L2'],
    ['config/authorize.yaml', 'L1'],
    ['src/author-helper.ts', 'L2'],
    ['src/oauth-session.ts', 'L2'],
    ['config/authorize-session.yaml', 'L1'],
    ['src/permissionless.ts', 'L2'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), expected, relative);
  }
});

test('deployment and publishing scripts elevate only at explicit token boundaries', () => {
  for (const relative of [
    'scripts/deploy.sh',
    'deploy.sh',
    'scripts/publish-package.mjs',
    'services/foo/deploy/run.sh',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L3', relative);
  }
  for (const [relative, expected] of [
    ['scripts/redeployment.sh', 'L1'],
    ['src/deployment.ts', 'L2'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), expected, relative);
  }
});

test('machine-sensitive contract schema migration and security fixtures override ordinary test paths', () => {
  for (const [paths, expected] of [
    [['test/fixtures/contracts/openapi.yaml'], 'L2'],
    [['test/fixtures/schemas/account.schema.json'], 'L2'],
    [['test/fixtures/migrations/001-add-account.sql'], 'L3'],
    [['test/fixtures/risk-evidence/authorization-policy.json'], 'L3'],
    [['fixtures/security/policy.json'], 'L3'],
    [['config/authorization/policy.yaml'], 'L3'],
  ]) {
    assert.equal(minimumTaskLevelFromPaths(paths, { confirmedRiskSignals: [] }), expected, paths.join(', '));
  }
});

test('supported ecosystem dependency manifests and lockfiles require L2', () => {
  for (const relative of [
    'uv.lock',
    'packages.lock.json',
    'manage.py',
    'artisan',
    'angular.json',
    'svelte.config.js',
    'settings.gradle.kts',
    'go.work',
    'symfony.lock',
    'global.json',
    'Directory.Packages.props',
    'AndroidManifest.xml',
    'Example.xcodeproj/project.pbxproj',
    'capacitor.config.ts',
    'pubspec.yaml',
    'src-tauri/tauri.conf.json',
    'CMakeLists.txt',
    'meson.build',
    'Makefile',
    'platformio.ini',
    'conanfile.py',
    'vcpkg.json',
  ]) {
    assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L2', relative);
  }
  assert.equal(minimumTaskLevelFromPaths(['notes.todo'], { confirmedRiskSignals: [] }), 'L1');
});

test('machine policy examples are evaluated by the canonical path rules', () => {
  const policy = taskRoutingPolicy({ artifactLanguage: 'en' });
  assert.equal(policy.escalation.pathLevelMerge, 'maximum-of-matching-rules');
  assert.equal(policy.escalation.ordinaryPathExclusion, 'first-matching-rule:ordinary-documentation-or-test');
  for (const rule of policy.pathRules) {
    assert.ok(rule.patterns.length > 0 || (rule.tokens ?? []).length > 0, `${rule.id} needs executable patterns or tokens`);
    assert.ok(rule.examples.length > 0, `${rule.id} needs executable examples`);
    for (const relative of rule.examples) {
      const ownsByPattern = rule.patterns.some((pattern) => matchSimpleGlob(relative.toLowerCase(), pattern));
      assert.ok(ownsByPattern || (rule.tokens ?? []).length > 0, `${rule.id} owns ${relative}`);
      assert.equal(rule.excludePatterns.some((pattern) => matchSimpleGlob(relative.toLowerCase(), pattern)), false, `${rule.id} excludes ${relative}`);
      assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), rule.level, `${rule.id}: ${relative}`);
    }
  }
  const sensitive = policy.pathRules.find((rule) => rule.id === 'security-and-money');
  assert.equal(sensitive.tokenBoundary, 'path-segment-or-dot-dash-underscore');
  assert.ok(sensitive.tokens.includes('permission'));
  assert.ok(policy.pathRules.find((rule) => rule.id === 'deployment-and-publishing').patterns.includes('**/deploy/**'));
  assert.equal(minimumTaskLevelFromPaths(['services/foo/deploy/run.sh'], { confirmedRiskSignals: [] }), 'L3');
  for (const surface of policy.escalation.surfaceGroups) {
    for (const relative of surface.examples) {
      assert.equal(minimumTaskLevelFromPaths([relative], { confirmedRiskSignals: [] }), 'L2', `${surface.id}: ${relative}`);
    }
  }
  for (const paths of policy.escalation.multiSurfaceExamples) {
    assert.equal(minimumTaskLevelFromPaths(paths, { confirmedRiskSignals: [] }), 'L3', paths.join(', '));
  }
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
