import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

// These are documentation contracts requested for the adaptive-flow migration;
// they prove discoverable guidance, never actual client execution.
test('installation documentation exposes adaptive routing and independent artifact language', () => {
  for (const relative of ['README.md', 'SKILL.md', 'references/initializer.md']) {
    const doc = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
    assert.match(doc, /Agent-first/);
    assert.match(doc, /artifact-language-second/);
    assert.match(doc, /artifactLanguage.{0,40}en/);
    assert.match(doc, /zh-CN/);
    assert.match(doc, /L0[\s\S]*L1[\s\S]*L2[\s\S]*L3/);
    assert.match(doc, /sync \. --prune --dry-run/);
    assert.match(doc, /sync \. --prune --approve <planHash>/);
    assert.doesNotMatch(doc, /自动完整模式|每个有行为变化的任务.*自动运行|用户当前语言作为交互与产物语言/);
  }
});

test('evolution documentation keeps verified completion candidate-only and promotion explicit', () => {
  const doc = fs.readFileSync(new URL('../references/continuous-skill-evolution.md', import.meta.url), 'utf8');
  assert.match(doc, /verified/);
  assert.match(doc, /candidate-only/);
  assert.match(doc, /no automatic promotion/i);
  assert.match(doc, /not-applicable/);
  assert.match(doc, /no-skill-with-reason/);
  assert.doesNotMatch(doc, /自动晋升判据|每次有行为变化的任务完成前自动执行|生成或升级 Skill.*才能 complete/);
});

test('every preset retains the same bounded ordinary context closure', (context) => {
  const root = fixture('presets');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  for (const governanceDepth of ['minimal', 'standard', 'complete']) {
    const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth }, scan);
    const closure = contextClosure(artifacts, 'ordinary');
    const text = closure.join('\n');
    assert.equal(closure.length, 3);
    assert.ok(closure.every(Boolean));
    assert.ok(Buffer.byteLength(text) <= 3600, `${governanceDepth}: ordinary byte budget`);
    assert.ok(Math.ceil(text.length / 4) <= 900, `${governanceDepth}: ordinary token estimate`);
    assert.doesNotMatch(text, /release-check|harvest|promote|reviews\/|reports\/|technical-standards|hooks?/i);
  }
});

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-context-budget-${name}-`));
}

function content(artifacts, relative) {
  return artifacts.find((artifact) => artifact.path === relative)?.content ?? '';
}

function profileBlock(contextMap, profile) {
  const lines = contextMap.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${profile}:`);
  if (start === -1) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function ordinaryProfile(contextMap) {
  return [
    contextMap.slice(0, contextMap.indexOf('profiles:')),
    profileBlock(contextMap, 'ordinary'),
  ].join('\n');
}

function requiredPaths(block) {
  const required = block.match(/^ {2,4}required:\s*\n((?: {4,6}-\s+[^\n]+\n?)*)/m)?.[1] ?? '';
  return [...required.matchAll(/^ {4,6}-\s+([A-Za-z0-9._/-]+)\s*$/gm)].map((match) => match[1]);
}

function contextClosure(artifacts, profile) {
  const contextMap = content(artifacts, 'docs/ai/context-map.yaml');
  const baseText = contextMap.slice(contextMap.indexOf('base:'), contextMap.indexOf('profiles:'));
  const profiles = [];
  const paths = [];
  const visit = (name) => {
    if (name === 'base') {
      paths.push(...requiredPaths(baseText));
      return;
    }
    const block = profileBlock(contextMap, name);
    const parent = block.match(/^    extends:\s+([A-Za-z0-9_-]+)\s*$/m)?.[1];
    if (parent) visit(parent);
    profiles.push(block);
    paths.push(...requiredPaths(block));
  };
  visit(profile);
  const selectedMap = `${contextMap.slice(0, contextMap.indexOf('base:'))}${baseText}profiles:\n${profiles.join('\n')}\n`;
  const uniquePaths = [...new Set(paths)];
  return [content(artifacts, 'AGENTS.md'), selectedMap, ...uniquePaths.map((relative) => content(artifacts, relative))];
}

test('ordinary context excludes release harvest hooks and full standards', (context) => {
  const root = fixture('ordinary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({
    ...defaultConfig(scan),
    governanceDepth: 'standard',
    features: {
      ...defaultConfig(scan).features,
      hooks: true,
    },
  }, scan);
  const agents = content(artifacts, 'AGENTS.md');
  const always = content(artifacts, 'docs/ai/rules/00_always.mdc');
  const contextMap = content(artifacts, 'docs/ai/context-map.yaml');

  for (const value of [agents, always, ordinaryProfile(contextMap)]) {
    assert.doesNotMatch(value, /release-check|harvest|promote|reviews\/|reports\/|capability-evolution|technical-standards|hooks?/i);
  }
});

test('ordinary behavior and release profiles form an incremental context map', (context) => {
  const root = fixture('incremental');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const scan = scanProject(root);
  scan.governanceUsage = ['release'];
  const artifacts = buildArtifacts({
    ...defaultConfig(scan),
    governanceDepth: 'standard',
    domainConstraints: ['Only active members may edit a project.'],
  }, scan);
  const contextMap = content(artifacts, 'docs/ai/context-map.yaml');
  const ordinary = profileBlock(contextMap, 'ordinary');
  const behavior = profileBlock(contextMap, 'behavior_change');
  const release = profileBlock(contextMap, 'release');

  assert.match(contextMap, /^base:\n  required:\n    - docs\/ai\/rules\/00_always\.mdc$/m);
  assert.match(ordinary, /^  ordinary:\n    extends: base\n    required: \[\]$/m);
  assert.match(behavior, /conditional:/);
  assert.doesNotMatch(behavior, /architecture-profile/, 'unconfirmed architecture does not enter a route');
  assert.match(behavior, /stack:\n        - docs\/ai\/stack-profile\.json\n        - docs\/ai\/rules\/20_stack\.mdc\n        - docs\/ai\/technical-standards\.json/);
  assert.match(behavior, /docs\/ai\/skills\/standards\/react-component-purity\/SKILL\.md/);
  assert.match(behavior, /business:\n        - docs\/ai\/business-constraints\.json\n        - docs\/ai\/skills\/business-constraints\/SKILL\.md/);
  assert.doesNotMatch(behavior, /release-acceptance-policy/);
  assert.match(release, /required:\n      - docs\/ai\/release-acceptance-policy\.json/);
  assert.doesNotMatch(release, /technical-standards|business-constraints|architecture-profile/);

  const ordinaryClosure = contextClosure(artifacts, 'ordinary');
  assert.equal(ordinaryClosure.length, 3);
  assert.ok(ordinaryClosure.every(Boolean));
  assert.doesNotMatch(ordinaryClosure.join('\n'), /release-check|harvest|promote|reviews\/|reports\/|capability-evolution|technical-standards|hooks?/i);
  assert.equal(contextClosure(artifacts, 'release').length, 4);
});

test('explicitly selected capabilities remain available outside ordinary context', (context) => {
  const root = fixture('retained');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  scan.governanceUsage = ['release'];
  const artifacts = buildArtifacts({
    ...defaultConfig(scan),
    governanceDepth: 'complete',
    features: {
      ...defaultConfig(scan).features,
      hooks: true,
      knowledge: true,
    },
  }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));

  for (const relative of [
    'reviews/.gitkeep',
    'reports/.gitkeep',
    'docs/ai/hooks.md',
    'docs/ai/release-acceptance-policy.json',
    'docs/ai/technical-standards.json',
    'docs/memory/INDEX.json',
    'docs/memory/SCHEMA.md',
  ]) {
    assert.ok(paths.has(relative), `missing dormant artifact ${relative}`);
  }
  assert.equal(paths.has('docs/ai/capability-evolution.json'), false);
  assert.equal(paths.has('docs/ai/lifecycle.md'), false);
  assert.doesNotMatch(contextClosure(artifacts, 'ordinary').join('\n'), /docs\/memory\/|project-conventions/);
});
