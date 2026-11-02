import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';
import { buildGreenfieldLayoutArtifacts, greenfieldDevelopmentUnits, resolveGreenfieldDevelopmentUnits } from '../src/modules/repository/greenfield-layout.mjs';
import { scanProject } from '../src/scanner.mjs';

test('selected frontend and backend stacks produce isolated production-oriented child projects', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-layout-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-react', 'backend-node'],
    governanceDepth: 'standard',
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' },
  };
  const artifacts = buildArtifacts(config, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  const ledger = JSON.parse(artifacts.find((artifact) => artifact.path === '.ai-governance/state/decision-ledger.json').content);
  assert.equal(ledger.pendingArchitectureDecision?.status, 'not-adopted');
  for (const prefix of ['apps/web', 'apps/server']) {
    for (const file of ['AGENTS.md', 'docs/ai/rules/architecture.md',
      'src/modules/README.md', 'src/shared/README.md']) {
      assert.ok(paths.has(`${prefix}/${file}`), `${prefix}/${file}`);
    }
  }
  assert.ok(paths.has('apps/web/docs/ai/skills/frontend-react-architecture/SKILL.md'));
  assert.ok(paths.has('apps/web/.agents/skills/frontend-react-architecture/SKILL.md'));
  assert.ok(paths.has('apps/server/docs/ai/skills/backend-node-architecture/SKILL.md'));
  assert.ok(paths.has('apps/server/.agents/skills/backend-node-architecture/SKILL.md'));
  assert.ok(paths.has('docs/development/cross-project-contracts.md'));
  const design = artifacts.find((artifact) => artifact.path === 'docs/development/units/backend-node.md').content;
  assert.doesNotMatch(design, /domain\/|infrastructure\/|plugins\//);
  assert.match(design, /shared-architecture.md/);
  assert.equal([...paths].some((entry) => entry.endsWith('/plugins/README.md')), false);
  const prepared = await prepareInit(root, { yes: true, 'dry-run': true }, { suppliedConfig: config });
  assert.ok(prepared.plan.operations.some((operation) => operation.path === 'apps/server/AGENTS.md'));
});

test('one selected stack uses root project boundary', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-one-stack-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-vue'],
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  assert.ok(paths.has('docs/development/README.md'));
  assert.ok(paths.has('src/modules/README.md'));
  assert.ok(paths.has('docs/ai/skills/frontend-vue-architecture/SKILL.md'));
  assert.equal([...paths].some((relative) => relative.startsWith('apps/')), false);
});

test('planned and roadmap stacks receive explicit provisional coverage instead of silently disappearing', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-provisional-stack-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-svelte', 'platform-android', 'backend-java'],
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  assert.ok(paths.has('apps/web/src/modules/README.md'));
  assert.ok(paths.has('apps/platform-android/app/src/main/modules/README.md'));
  assert.ok(paths.has('apps/server/src/main/java/README.md'));
  assert.equal(paths.has('apps/server/src/main/java/modules/README.md'), false);
  const index = JSON.parse(artifacts.find((artifact) => artifact.path === 'docs/ai/development/index.json').content);
  assert.deepEqual(index.units.map((unit) => unit.coverage), ['planned-template', 'roadmap-template', 'active-template']);
});

const greenfieldConfig = (stacks) => ({ stacks, clients: ['codex'], governanceDepth: 'standard', initialization: { lifecycle: 'greenfield', source: 'config', existingCodeStrategy: null } });

test('layout units distinguish same-kind stacks and keep stack IDs separate from roots', () => {
  const units = greenfieldDevelopmentUnits(greenfieldConfig(['frontend-vue', 'frontend-react', 'backend-java', 'backend-node']));
  assert.deepEqual(units.map(({stack, root}) => [stack, root]), [
    ['frontend-vue', 'apps/web-vue'], ['frontend-react', 'apps/web-react'],
    ['backend-java', 'apps/server-java'], ['backend-node', 'apps/server-node'],
  ]);
  assert.equal(new Set(units.map((unit) => unit.root)).size, units.length);
});

test('previously generated roots survive subsequent compilation without migration', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-retained-layout-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'docs/ai/development'), {recursive: true});
  fs.writeFileSync(path.join(root, 'docs/ai/development/index.json'), JSON.stringify({schemaVersion: 1, units: [
    {stack: 'frontend-vue', path: 'apps/frontend-vue'}, {stack: 'backend-java', path: 'services/backend-java'},
  ]}));
  const scan = scanProject(root);
  const config = greenfieldConfig(['frontend-vue', 'backend-java']);
  assert.deepEqual(resolveGreenfieldDevelopmentUnits(config, scan).map((unit) => unit.root), ['apps/frontend-vue', 'services/backend-java']);
  const paths = buildGreenfieldLayoutArtifacts(config, scan).artifacts.map((artifact) => artifact.path);
  assert.ok(paths.includes('services/backend-java/AGENTS.md'));
  assert.equal(paths.some((entry) => entry.startsWith('apps/server/')), false);
  const compiled = buildArtifacts({...defaultConfig(scan), ...config}, scan);
  assert.ok(compiled.some((artifact) => artifact.path === 'services/backend-java/AGENTS.md'));
});

test('recorded layout paths reject escapes, duplicates and overlapping roots', () => {
  for (const root of ['../outside', '/tmp/outside', 'apps/../outside', './src', 'apps//web', 'apps/web/', 'apps\\outside']) {
    assert.throws(() => greenfieldDevelopmentUnits({...greenfieldConfig(['frontend-vue']), developmentUnits: [{stack: 'frontend-vue', path: root}]}), /layout|root|path/i);
  }
  assert.throws(() => greenfieldDevelopmentUnits({...greenfieldConfig(['frontend-vue', 'backend-java']), developmentUnits: [
    {stack: 'frontend-vue', path: 'apps/web'}, {stack: 'backend-java', path: 'apps/web/server'},
  ]}), /overlap|root/i);
});

test('existing repositories produce no greenfield placeholders', () => {
  assert.deepEqual(buildGreenfieldLayoutArtifacts({...greenfieldConfig(['frontend-vue', 'backend-java']), initialization: {lifecycle: 'existing'}}), {units: [], artifacts: []});
});

test('every generated development markdown link resolves to a generated artifact', () => {
  for (const stacks of [['frontend-vue'], ['frontend-vue', 'backend-java']]) {
    const artifacts = buildGreenfieldLayoutArtifacts(greenfieldConfig(stacks)).artifacts;
    const paths = new Set(artifacts.map((artifact) => artifact.path));
    for (const artifact of artifacts.filter((item) => item.kind === 'greenfield-development-document' || item.kind === 'greenfield-architecture-rule')) {
      for (const match of artifact.content.matchAll(/\]\(([^)]+)\)/g)) {
        assert.ok(paths.has(path.posix.normalize(path.posix.join(path.posix.dirname(artifact.path), match[1]))), `${artifact.path}: ${match[1]}`);
      }
    }
  }
});

test('malformed recorded index fails closed instead of choosing new paths', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-broken-layout-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'docs/ai/development'), {recursive: true});
  fs.writeFileSync(path.join(root, 'docs/ai/development/index.json'), '{');
  assert.throws(() => resolveGreenfieldDevelopmentUnits(greenfieldConfig(['frontend-vue']), scanProject(root)), /index cannot be read/);
});

test('legacy stack roots remain discoverable when their index is absent', () => {
  const units = resolveGreenfieldDevelopmentUnits(greenfieldConfig(['frontend-vue', 'backend-java']), {files: [
    {relative: 'apps/frontend-vue/package.json', type: 'file'},
    {relative: 'services/backend-java/pom.xml', type: 'file'},
  ]});
  assert.deepEqual(units.map((unit) => unit.root), ['apps/frontend-vue', 'services/backend-java']);
});

test('layout resolution rejects a linked index or its linked ancestor', () => {
  for (const relative of ['docs', 'docs/ai', 'docs/ai/development', 'docs/ai/development/index.json']) {
    assert.throws(() => resolveGreenfieldDevelopmentUnits(greenfieldConfig(['frontend-vue']), {files: [{relative, type: 'link'}]}), /index.*link|link.*index/i);
  }
});

test('existing compilation does not resolve an inactive greenfield layout index', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-inactive-layout-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'docs/ai/development'), {recursive: true});
  fs.writeFileSync(path.join(root, 'docs/ai/development/index.json'), '{');
  const scan = scanProject(root);
  const artifacts = buildArtifacts({...defaultConfig(scan), stacks: ['frontend-vue', 'backend-java'],
    initialization: {lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config'}}, scan);
  assert.equal(artifacts.some((artifact) => artifact.kind?.startsWith('greenfield-')), false);
});

test('Chinese layout guidance preserves localized prose and stable machine identifiers', () => {
  const artifacts = buildGreenfieldLayoutArtifacts({...greenfieldConfig(['frontend-vue', 'backend-java']), artifactLanguage: 'zh-CN'}).artifacts;
  const design = artifacts.find((item) => item.path === 'docs/development/units/backend-java.md').content;
  const shared = artifacts.find((item) => item.kind === 'greenfield-shared-architecture').content;
  assert.match(design, /技术栈.*backend-java/);
  assert.match(design, /工程根目录.*apps\/server/);
  assert.match(design, /模板覆盖状态.*active-template/);
  assert.match(design, /共享架构指南/);
  assert.match(design, /跨工程契约/);
  assert.match(design, /从实际构建清单确认/);
  assert.match(shared, /共享架构指南/);
  assert.match(shared, /不要生成空的 domain\/application\/infrastructure 目录/);
  assert.match(shared, /异步结果的身份一致性/);
  assert.doesNotMatch(design, /Project root:|Confirm framework versions|Cross-project schemas follow/);
  assert.doesNotMatch(shared, /Status: proposal|A business module owns/);
});


test('Java guidance models a selected base package without creating placeholder packages', () => {
  const {artifacts} = buildGreenfieldLayoutArtifacts(greenfieldConfig(['frontend-vue', 'backend-java']));
  const paths = artifacts.map((item) => item.path);
  const design = artifacts.find((item) => item.path === 'docs/development/units/backend-java.md').content;
  assert.match(design, /src\/main\/java\/<base-package>\//);
  assert.match(design, /project selects its base package/);
  assert.ok(paths.includes('apps/server/src/main/java/README.md'));
  assert.equal(paths.some((entry) => /src\/main\/java\/(application|modules|shared|<base-package>)\//.test(entry)), false);
});
