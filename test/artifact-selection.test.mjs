import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { checkProject } from '../src/checker.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { artifactDefinitions, selectedArtifactDefinitions } from '../src/modules/governance/compiler.mjs';
import { resolveGovernanceCapabilities, selectArtifactDefinitions } from '../src/modules/governance/artifact-selection.mjs';

const MINIMAL_CODEX_ALLOWLIST = [
  '.ai-governance/config.json',
  'AGENTS.md',
  'docs/ai/README.md',
  'docs/ai/context-map.yaml',
  'docs/ai/rules/00_always.mdc',
];

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-selection-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  return { root, scan, config: { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'minimal' } };
}

test('Codex-only minimal emits only the trusted kernel', (context) => {
  const { config, scan } = fixture(context);
  const paths = buildArtifacts(config, scan).map((item) => item.path).sort();
  assert.deepEqual(paths, MINIMAL_CODEX_ALLOWLIST);
  assert.ok(paths.length + 1 <= 10, 'including the apply-generated manifest');
  assert.equal(paths.some((value) => /release|surface|acceptance|reviews|reports|lifecycle/.test(value)), false);
});

test('standard and complete do not eagerly enable evidence or lifecycle features', (context) => {
  const { config, scan } = fixture(context);
  for (const governanceDepth of ['standard', 'complete']) {
    const paths = buildArtifacts({ ...config, governanceDepth }, scan).map((item) => item.path).sort();
    const policy = ['docs/ai/anti-patterns.md', 'docs/ai/stack-profile.json', 'docs/ai/rules/20_stack.mdc', 'docs/ai/technical-standards.json', 'docs/ai/skills/standards/software-design-and-verification/SKILL.md', '.agents/skills/standards/software-design-and-verification/SKILL.md'];
    const routing = ['.gitignore', 'reviews/.gitkeep', 'reports/.gitkeep', 'docs/ai/bootstrap-prompt.md', 'docs/ai/decision-ledger.json', 'docs/ai/verification-profiles.yaml'];
    const skills = governanceDepth === 'complete' ? ['docs/ai/skills/generic-unknown/SKILL.md', '.agents/skills/generic-unknown/SKILL.md'] : [];
    assert.deepEqual(paths, [...MINIMAL_CODEX_ALLOWLIST, ...routing, ...policy, ...skills].sort());
    assert.ok(paths.length + 1 <= (governanceDepth === 'standard' ? 20 : 26));
  }
});

test('selection is pure and never calls builders for dormant definitions', (context) => {
  const { config, scan } = fixture(context);
  const before = JSON.stringify({ config, scan });
  const definitions = artifactDefinitions(config, scan);
  for (const definition of definitions) {
    assert.deepEqual(Object.keys(definition).sort(), ['id', 'path', 'capability', 'activation', 'requires', 'ownership', 'routeProfiles', 'gateAssertions', 'build'].sort());
    definition.build = () => { throw new Error('selection must not render'); };
  }
  assert.deepEqual(selectArtifactDefinitions(config, scan, definitions).map((item) => item.path).sort(), MINIMAL_CODEX_ALLOWLIST);
  assert.deepEqual([...resolveGovernanceCapabilities(config, scan)], ['core', 'integration']);
  assert.equal(JSON.stringify({ config, scan }), before);
});

test('first-use materializes only the requested evidence family and never manufactures results', (context) => {
  const { config, scan } = fixture(context);
  for (const [usage, relative] of [
    ['release', 'docs/ai/release-acceptance-policy.json'],
    ['surface', 'docs/ai/surface-verification-profiles.json'],
    ['acceptance', 'docs/ai/acceptance-contract.json'],
  ]) {
    const snapshot = { ...scan, governanceUsage: [usage] };
    const paths = buildArtifacts(config, snapshot).map((item) => item.path).sort();
    assert.deepEqual(paths, [...MINIMAL_CODEX_ALLOWLIST, relative].sort());
    assert.equal(selectedArtifactDefinitions(config, snapshot).find((item) => item.path === relative).activation, 'first-use');
  }
});

test('minimal checker passes with optional policies absent and still rejects missing kernel files', (context) => {
  const { root, config, scan } = fixture(context);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  fs.unlinkSync(path.join(root, 'docs/ai/rules/00_always.mdc'));
  const failed = checkProject(scanProject(root));
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('docs/ai/rules/00_always.mdc')));
});

test('selected clients receive only their native adapters at minimal depth', (context) => {
  const { config, scan } = fixture(context);
  for (const [clients, adapters] of [
    [['codex'], []],
    [['claude-code'], ['CLAUDE.md']],
    [['cursor'], ['.cursor/rules/ai-code-governance.mdc']],
    [['codex', 'claude-code', 'cursor'], ['CLAUDE.md', '.cursor/rules/ai-code-governance.mdc']],
  ]) {
    assert.deepEqual(buildArtifacts({ ...config, clients }, scan).map((item) => item.path).sort(), [...MINIMAL_CODEX_ALLOWLIST, ...adapters].sort());
  }
});

test('downgrading to minimal retains former managed and seed artifacts without deletion', (context) => {
  const { root, config, scan } = fixture(context);
  const standard = { ...config, governanceDepth: 'complete' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(standard, scan)));
  const canonical = path.join(root, 'docs/ai/anti-patterns.md');
  fs.appendFileSync(canonical, '\nOwner guidance.\n');
  const original = fs.readFileSync(canonical, 'utf8');
  const plan = planArtifacts(root, buildArtifacts(config, scanProject(root)));
  assert.equal(plan.operations.some((operation) => operation.remove), false);
  assert.ok(plan.retained.some((entry) => entry.path === 'docs/ai/stack-profile.json'));
  applyArtifactPlan(root, plan);
  assert.equal(fs.readFileSync(canonical, 'utf8'), original);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('first release use extends an existing empty release route and preserves user routes', (context) => {
  const { root, config, scan } = fixture(context);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const contextPath = path.join(root, 'docs/ai/context-map.yaml');
  fs.appendFileSync(contextPath, '  owner_notes:\n    description: Keep this user route.\n    required: []\n');
  const firstUse = { ...scanProject(root), governanceUsage: ['release'] };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, firstUse)), {
    transactional: true,
    verify: () => checkProject(scanProject(root)),
  });
  assert.match(fs.readFileSync(contextPath, 'utf8'), /Keep this user route/);
  assert.match(fs.readFileSync(contextPath, 'utf8'), /required:\n      - docs\/ai\/release-acceptance-policy.json/);
});

test('lifecycle features remain independent at every depth', (context) => {
  const { config, scan } = fixture(context);
  for (const governanceDepth of ['minimal', 'standard', 'complete']) {
    const paths = buildArtifacts({ ...config, governanceDepth, features: { ...config.features, taskRuntime: true } }, scan).map((item) => item.path);
    assert.ok(paths.includes('docs/ai/long-running/README.md'));
    assert.ok(paths.includes('docs/ai/lifecycle.md'));
    assert.equal(paths.includes('docs/memory/INDEX.md'), false);
    assert.equal(paths.includes('docs/ai/hooks.md'), false);
    assert.equal(paths.includes('docs/ai/ci-integration.md'), false);
    assert.equal(paths.includes('docs/ai/workflow-integrations.yaml'), false);
  }
});

test('produced evidence and certification receipts are preserved without creating placeholders', (context) => {
  const { root, config, scan } = fixture(context);
  const resultPaths = ['docs/ai/acceptance-results.json', 'docs/ai/surface-results.json', 'docs/ai/certification-evidence.json'];
  const fresh = buildArtifacts(config, scan);
  for (const relative of resultPaths) assert.equal(fresh.some((item) => item.path === relative), false);
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  const receipt = '{"ownerEvidence":"verbatim"}\n';
  for (const relative of resultPaths) fs.writeFileSync(path.join(root, relative), receipt);
  const snapshot = scanProject(root);
  const selected = selectedArtifactDefinitions(config, snapshot);
  for (const relative of resultPaths) {
    assert.equal(selected.find((item) => item.path === relative)?.activation, 'evidence-produced');
    assert.equal(buildArtifacts(config, snapshot).find((item) => item.path === relative)?.content, receipt);
  }
});
