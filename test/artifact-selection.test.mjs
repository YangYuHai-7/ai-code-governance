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
import { deriveArchitectureDecision } from '../src/modules/architecture/index.mjs';

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

for (const scenario of ['business', 'architecture-active', 'architecture-advisory', 'stack']) {
  test(`minimal to standard materializes and routes selected ${scenario} policy`, (context) => {
    const { root, config, scan } = fixture(context);
    applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
    const upgraded = { ...config, governanceDepth: 'standard' };
    if (scenario === 'business') upgraded.domainConstraints = ['Only the owner can close an account.'];
    if (scenario.startsWith('architecture-')) {
      upgraded.initialization = scenario === 'architecture-active'
        ? { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' }
        : { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' };
      upgraded.architecture = deriveArchitectureDecision(scan, upgraded);
      assert.equal(upgraded.architecture.status, scenario.slice('architecture-'.length));
    }
    const plan = planArtifacts(root, buildArtifacts(upgraded, scanProject(root)));
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.operations.some((item) => item.remove), false);
    applyArtifactPlan(root, plan, { transactional: true, verify: () => checkProject(scanProject(root)) });
    const map = fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8');
    const expected = {
      business: ['docs/ai/business-constraints.json', 'docs/ai/skills/business-constraints/SKILL.md'],
      architecture: ['docs/ai/architecture-profile.json', 'docs/ai/rules/15_architecture.mdc'],
      stack: ['docs/ai/stack-profile.json', 'docs/ai/rules/20_stack.mdc', 'docs/ai/technical-standards.json', 'docs/ai/skills/standards/software-design-and-verification/SKILL.md'],
    }[scenario.startsWith('architecture-') ? 'architecture' : scenario];
    for (const relative of expected) {
      assert.ok(map.includes(`        - ${relative}\n`), `missing route ${relative}`);
      assert.equal(fs.existsSync(path.join(root, relative)), true);
    }
    assert.equal(checkProject(scanProject(root)).ok, true);
  });
}

test('conditional upgrade preserves custom conditions comments order and CRLF bytes', (context) => {
  const { root, config, scan } = fixture(context);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const target = path.join(root, 'docs/ai/context-map.yaml');
  const custom = '    conditional:\n      # Owner route before generated additions.\n      local_operations:\n        - docs/owner-runbook.md\n      # Keep this trailing comment.\n';
  const original = fs.readFileSync(target, 'utf8').replace('    conditional: {}\n', custom).replaceAll('\n', '\r\n');
  fs.writeFileSync(target, original);
  const upgraded = { ...config, governanceDepth: 'standard', domainConstraints: ['Keep owner data scoped.'] };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(upgraded, scanProject(root))), { transactional: true, verify: () => checkProject(scanProject(root)) });
  const after = fs.readFileSync(target, 'utf8');
  assert.ok(after.includes(custom.replaceAll('\n', '\r\n')));
  assert.equal(/(?<!\r)\n/.test(after), false);
  let offset = 0;
  for (const line of original.split('\r\n')) {
    const next = after.indexOf(line, offset);
    assert.notEqual(next, -1, `lost or reordered user line ${line}`);
    offset = next + line.length;
  }
});

test('untrusted and ambiguous conditional upgrades fail closed without changing files', (context) => {
  for (const scenario of ['foreign', 'duplicate', 'inline-map', 'conflicting-stack']) {
    const { root, config, scan } = fixture(context);
    applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
    const target = path.join(root, 'docs/ai/context-map.yaml');
    const manifestPath = path.join(root, '.ai-governance/manifest.json');
    if (scenario === 'foreign') {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.generatedBy = 'foreign-owner';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    } else {
      const replacement = {
        duplicate: '    conditional: {}\n    conditional: {}',
        'inline-map': '    conditional: {stack: [docs/owner.md]}',
        'conflicting-stack': '    conditional:\n      stack:\n        - docs/owner.md',
      }[scenario];
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('    conditional: {}', replacement));
    }
    const before = [target, manifestPath, path.join(root, '.ai-governance/config.json')].map((file) => [file, fs.readFileSync(file, 'utf8')]);
    const upgraded = { ...config, governanceDepth: 'standard' };
    const plan = planArtifacts(root, buildArtifacts(upgraded, scanProject(root)));
    assert.throws(() => applyArtifactPlan(root, plan, { transactional: true, verify: () => checkProject(scanProject(root)) }));
    for (const [file, bytes] of before) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(root, 'docs/ai/technical-standards.json')), false);
  }
});
