import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { loadTechnicalStandardRegistry, selectTechnicalStandards, technicalStandardsSummary, validateTechnicalStandardRegistry } from '../src/technical-standards.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-technical-standards-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('detects the Labrix technology set and generates traceable standard Skills', (context) => {
  const root = fixture('labrix');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: {
      react: '19.0.0',
      '@mantine/core': '9.6.0',
      '@mantine/form': '9.6.0',
      '@nestjs/core': '11.0.0',
      '@nestjs/platform-fastify': '11.0.0',
      fastify: '5.12.1',
      'drizzle-orm': '0.44.0',
      pg: '8.16.0',
      'socket.io': '4.8.0',
      'livekit-server-sdk': '2.13.0',
      ioredis: '5.7.0',
      bullmq: '5.58.0'
    },
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' }
  }));
  const scan = scanProject(root);
  assert.equal(scan.packageDependencies['@mantine/core'].versions[0], '9.6.0');
  assert.deepEqual(scan.packageDependencies.bullmq.sections, ['dependencies']);
  const config = { ...defaultConfig(scan), clients: ['codex'] };
  const artifacts = buildArtifacts(config, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  for (const id of [
    'software-design-and-verification',
    'react-component-purity',
    'mantine-ui-composition',
    'nestjs-module-boundaries',
    'fastify-contracts-and-serialization',
    'critical-api-integrity-and-replay',
    'drizzle-transaction-boundaries',
    'postgresql-concurrency-invariants',
    'socketio-realtime-contracts',
    'livekit-token-boundaries',
    'redis-delivery-semantics',
    'bullmq-idempotent-jobs',
  ]) {
    assert.ok(paths.has(`docs/ai/skills/standards/${id}/SKILL.md`), `missing standard Skill ${id}`);
    assert.ok(paths.has(`.agents/skills/standards/${id}/SKILL.md`), `missing Codex adapter Skill ${id}`);
  }
  const integritySkill = artifacts.find((artifact) => artifact.path.endsWith('critical-api-integrity-and-replay/SKILL.md'));
  assert.match(integritySkill.content, /RFC 9421/);
  assert.match(integritySkill.content, /concurrent duplicate submissions/);
  const sourceManifest = JSON.parse(artifacts.find((artifact) => artifact.path === 'docs/ai/technical-standards.json').content);
  assert.equal(sourceManifest.status, 'reviewed-offline-snapshot');
  assert.equal(sourceManifest.skills.find((skill) => skill.id === 'bullmq-idempotent-jobs').claimState, 'stated');
  assert.deepEqual(sourceManifest.technologyEvidence.installedPackages.includes('bullmq'), true);

  applyArtifactPlan(root, planArtifacts(root, artifacts), {
    transactional: true,
    verify: () => checkProject(scanProject(root)),
  });
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('a greenfield user-confirmed package selection produces the matching Skills without pretending packages are installed', (context) => {
  const root = fixture('declared');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan),
    clients: ['generic'],
    technologyPackages: ['react', '@mantine/core', '@nestjs/core', '@nestjs/platform-fastify', 'drizzle-orm', 'pg'],
  };
  const summary = technicalStandardsSummary(scan, config);
  assert.deepEqual(summary.technologyEvidence.installedPackages, []);
  assert.deepEqual(summary.technologyEvidence.configuredPackages, ['@mantine/core', '@nestjs/core', '@nestjs/platform-fastify', 'drizzle-orm', 'pg', 'react']);
  assert.equal(summary.skills.find((skill) => skill.id === 'react-component-purity').applicability.kind, 'declared-technology');
  assert.equal(summary.skills.find((skill) => skill.id === 'fastify-contracts-and-serialization').applicability.kind, 'declared-technology');
});

test('minimal governance does not route to technical standard artifacts it did not generate', (context) => {
  const root = fixture('minimal');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), governanceDepth: 'minimal' }, scan);
  assert.equal(artifacts.some((artifact) => artifact.path === 'docs/ai/technical-standards.json'), false);
  const contextMap = artifacts.find((artifact) => artifact.path === 'docs/ai/context-map.yaml').content;
  assert.doesNotMatch(contextMap, /technical-standards/);
  assert.equal([...contextMap.matchAll(/^profiles:$/gm)].length, 1);
  assert.doesNotMatch(artifacts.find((artifact) => artifact.path === 'docs/ai/rules/00_always.mdc').content, /technical-standards/);
});

test('technical standards CLI and exact chat preview are read-only', (context) => {
  const root = fixture('preview');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const direct = run(['standards', root, '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).mode, 'read-only-preview');
  assert.ok(JSON.parse(direct.stdout).skills.some((skill) => skill.id === 'react-component-purity'));
  const chat = run(['request', root, '--text', '生成技术规范预览', '--json']);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).intent.id, 'technical-standards.preview');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});

test('the technical standard registry rejects a duplicate source id', () => {
  const registry = structuredClone(loadTechnicalStandardRegistry());
  registry.standards[1].sources[0].id = registry.standards[0].sources[0].id;
  assert.throws(() => validateTechnicalStandardRegistry(registry), /duplicate source id/);
});

test('broad stack evidence and similar package names never select a technical standard', (context) => {
  const root = fixture('exact-match');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'react-router': '7.0.0' } }));
  const scan = scanProject(root);
  assert.ok(scan.stacks.some((stack) => stack.id === 'frontend-react'));
  const summary = technicalStandardsSummary(scan, defaultConfig(scan));
  assert.equal(summary.skills.some((skill) => skill.id === 'react-component-purity'), false);

  const registry = structuredClone(loadTechnicalStandardRegistry());
  registry.standards.push({
    id: 'unsafe-broad-stack-match',
    title: 'Unsafe broad stack match',
    appliesTo: { packsAny: ['frontend-react'] },
    sources: [{ id: 'unsafe-broad-stack-source', kind: 'official-documentation', title: 'Example', url: 'https://example.com/', retrievedAt: '2026-09-08' }],
    practices: ['Do not use this test-only standard.'],
    verification: ['Do not use this test-only standard.'],
    boundaries: ['Do not use this test-only standard.'],
  });
  assert.throws(() => validateTechnicalStandardRegistry(registry), /exact package selectors/);
  assert.equal(selectTechnicalStandards(scan, defaultConfig(scan), registry).selected.some((entry) => entry.standard.id === 'unsafe-broad-stack-match'), false);
});
