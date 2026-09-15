import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

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
  assert.match(behavior, /architecture:\n        - docs\/ai\/architecture-profile\.json\n        - docs\/ai\/rules\/15_architecture\.mdc/);
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

test('context slimming keeps dormant governance artifacts available', (context) => {
  const root = fixture('retained');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({
    ...defaultConfig(scan),
    governanceDepth: 'complete',
    features: {
      ...defaultConfig(scan).features,
      hooks: true,
    },
  }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));

  for (const relative of [
    'reviews/.gitkeep',
    'reports/.gitkeep',
    'docs/ai/hooks.md',
    'docs/ai/release-acceptance-policy.json',
    'docs/ai/technical-standards.json',
    'docs/ai/capability-evolution.json',
    'docs/ai/lifecycle.md',
  ]) {
    assert.ok(paths.has(relative), `missing dormant artifact ${relative}`);
  }
});
