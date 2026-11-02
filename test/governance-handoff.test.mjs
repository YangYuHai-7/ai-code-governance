import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildGovernanceHandoff } from '../src/modules/governance/handoff-prompt.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageRoot, 'bin/aicg.js');

function config(overrides = {}) {
  return {
    interactionLanguage: 'zh-CN',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
    clients: ['codex', 'deepseek'],
    stacks: ['backend-java', 'generic-unknown'],
    technologyPackages: ['org.springframework.boot:spring-boot-starter-webmvc', 'vendor:new-runtime'],
    ...overrides,
  };
}

test('handoff treats every selected technology as live research work and keeps bootstrap honest', () => {
  const handoff = buildGovernanceHandoff({ root: '/sample/member-app', config: config(), phase: 'configured', configPath: 'aicg.config.json' });

  assert.equal(handoff.schemaVersion, 1);
  assert.equal(handoff.status, 'handoff-ready');
  assert.equal(handoff.frameworkStatus, 'bootstrap-only');
  assert.equal(handoff.research.status, 'unverified');
  assert.equal(handoff.research.scope, 'all-selected-technologies');
  assert.deepEqual(handoff.technologies, [
    'backend-java',
    'generic-unknown',
    'org.springframework.boot:spring-boot-starter-webmvc',
    'vendor:new-runtime',
  ]);

  for (const required of [
    '真实仓库',
    '所有已选择和实际发现的技术',
    '官方文档或其他一手资料',
    '目录结构',
    '架构备选',
    '开发、测试、安全、运维和迁移',
    '许可证',
    '付费 SDK',
    '外部成本',
    '固定模板只用于启动',
    'research-required',
    'unverified',
    'handoff-ready',
    'aicg check . --json --enforce',
  ]) assert.match(handoff.prompt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(handoff.prompt, /backend-java、generic-unknown、org\.springframework\.boot:spring-boot-starter-webmvc、vendor:new-runtime/);
  assert.match(handoff.prompt, /aicg init \. --config aicg\.config\.json --dry-run/);
  assert.match(handoff.prompt, /不能称为“治理框架已完成”/);
});

test('applied and configured handoffs share the same research contract while changing only the setup step', () => {
  const configured = buildGovernanceHandoff({ root: '/sample/member-app', config: config(), phase: 'configured' });
  const applied = buildGovernanceHandoff({ root: '/sample/member-app', config: config(), phase: 'applied' });

  assert.deepEqual(applied.research, configured.research);
  assert.deepEqual(applied.technologies, configured.technologies);
  assert.match(applied.prompt, /不要重新运行 aicg init/);
  assert.doesNotMatch(applied.prompt, /aicg init \. --config/);
  assert.match(applied.prompt, /aicg check \. --json --enforce/);
});

test('handoff CLI emits the same structured contract from a saved base configuration', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-handoff-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'aicg.config.json'), JSON.stringify(config()));

  const result = spawnSync(process.execPath, [bin, 'handoff', root, '--config', 'aicg.config.json', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const handoff = JSON.parse(result.stdout);
  assert.equal(handoff.status, 'handoff-ready');
  assert.equal(handoff.phase, 'configured');
  assert.equal(handoff.configPath, 'aicg.config.json');
  assert.match(handoff.prompt, /所有已选择和实际发现的技术/);
});

test('CLI configuration validation returns the same handoff without a second authoring flow', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-config-handoff-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'aicg.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config()));

  const result = spawnSync(process.execPath, [bin, 'config', 'validate', root, '--config', configPath, '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
  assert.equal(payload.handoff.status, 'handoff-ready');
  assert.equal(payload.handoff.phase, 'configured');
  assert.match(payload.handoff.prompt, /固定模板只用于启动/);
});
