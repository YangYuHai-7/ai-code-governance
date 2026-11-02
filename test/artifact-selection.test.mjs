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
import { surfaceVerificationProfiles } from '../src/modules/repository/index.mjs';
import { remapContentPaths } from '../src/modules/governance/layout.mjs';
import { sha256, stableJson } from '../src/shared/index.mjs';

const COMPLETE_CODEX_ALLOWLIST = [
  '.agents/skills/generic-unknown/SKILL.md',
  '.agents/skills/standard-component-reuse/SKILL.md',
  '.agents/skills/standard-module-boundaries/SKILL.md',
  '.agents/skills/standard-professional-testing/SKILL.md',
  '.agents/skills/standard-proportionate-design/SKILL.md',
  '.agents/skills/standard-software-design-and-verification/SKILL.md',
  '.agents/skills/standard-standard-skill-authoring/SKILL.md',
  '.ai-governance/config.json',
  '.ai-governance/state/decision-ledger.json',
  '.ai-governance/state/delivery-loop.json',
  '.ai-governance/state/flow-state.json',
  '.ai-governance/state/stack-profile.json',
  '.ai-governance/state/task-routing-policy.json',
  '.ai-governance/state/team-roster.json',
  '.ai-governance/state/technical-standards.json',
  '.ai-governance/state/verification-profiles.yaml',
  '.gitignore',
  'AGENTS.md',
  'docs/WORKFLOW.md',
  'docs/ai/README.md',
  'docs/ai/agents/architect.md',
  'docs/ai/agents/ba.md',
  'docs/ai/agents/backend.md',
  'docs/ai/agents/designer.md',
  'docs/ai/agents/frontend.md',
  'docs/ai/agents/fullstack.md',
  'docs/ai/agents/pm.md',
  'docs/ai/agents/tester.md',
  'docs/ai/context-map.yaml',
  'docs/ai/policies/00_always.mdc',
  'docs/ai/policies/20_stack.mdc',
  'docs/ai/policies/anti-patterns.md',
  'docs/ai/routing/bootstrap-prompt.md',
  'docs/ai/skills/generic-unknown/SKILL.md',
  'docs/ai/skills/standards/component-reuse/SKILL.md',
  'docs/ai/skills/standards/module-boundaries/SKILL.md',
  'docs/ai/skills/standards/professional-testing/SKILL.md',
  'docs/ai/skills/standards/proportionate-design/SKILL.md',
  'docs/ai/skills/standards/software-design-and-verification/SKILL.md',
  'docs/ai/skills/standards/standard-skill-authoring/SKILL.md',
  'docs/development/README.md',
  'docs/development/standards/component-reuse.md',
  'docs/development/standards/module-boundaries.md',
  'docs/development/standards/professional-testing.md',
  'docs/development/standards/proportionate-design.md',
  'docs/development/standards/software-design-and-verification.md',
  'docs/development/standards/standard-skill-authoring.md',
  'docs/memory/INDEX.json',
  'docs/memory/README.md',
  'docs/memory/SCHEMA.md'
];

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-selection-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  return { root, scan, config: { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'minimal' } };
}

test('repository scan recognizes OpenSpec without treating plugin markers as workflow providers', (context) => {
  const { root } = fixture(context);
  for (const relative of [
    'openspec/config.yaml',
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), relative.endsWith('.json') ? '{}\n' : 'schema: spec-driven\n');
  }

  assert.deepEqual(scanProject(root).externalWorkflows, ['openspec-change-governance']);
});

test('legacy minimal selects the full trusted baseline with roles and guidance', (context) => {
  const { config, scan } = fixture(context);
  const paths = buildArtifacts(config, scan).map((item) => item.path).sort();
  assert.deepEqual(paths, COMPLETE_CODEX_ALLOWLIST);
  assert.ok(paths.includes('docs/ai/agents/architect.md'));
  assert.ok(paths.includes('docs/ai/skills/standards/module-boundaries/SKILL.md'));
  assert.equal(paths.some((value) => /release|surface|acceptance|reviews|reports|lifecycle/.test(value)), false);
});

test('rebaseline preserves existing project-owned seed content', (context) => {
  const { root, config, scan } = fixture(context);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const relative = 'docs/memory/README.md';
  const ownerContent = '# Owner-reviewed project memory\n';
  fs.writeFileSync(path.join(root, relative), ownerContent);

  const plan = planArtifacts(root, buildArtifacts(config, scanProject(root)), {
    replaceExisting: true,
    rebaseline: true,
  });
  const operation = plan.operations.find((item) => item.path === relative);
  assert.equal(operation.desired, ownerContent);
  assert.equal(operation.changed, false);
});

test('fresh preset fixtures enforce installed file and byte budgets including the manifest', (context) => {
  for (const [governanceDepth, expectedFiles, maxBytes] of ['minimal', 'standard', 'complete'].map(depth => [depth, COMPLETE_CODEX_ALLOWLIST.length + 1, 256 * 1024])) {
    const { root, config, scan } = fixture(context);
    const artifacts = buildArtifacts({ ...config, governanceDepth }, scan);
    const plan = planArtifacts(root, artifacts);
    applyArtifactPlan(root, plan);
    const expectedPaths = [...artifacts.map((artifact) => artifact.path), '.ai-governance/manifest.json'].sort();
    const actualPaths = [];
    const walk = (relative = '') => {
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(child);
        else actualPaths.push(child);
      }
    };
    walk();
    assert.deepEqual(actualPaths.sort(), expectedPaths, `${governanceDepth}: unexpected installed artifact`);
    assert.equal(actualPaths.length, expectedFiles);
    const bytes = actualPaths.reduce((sum, relative) => sum + fs.statSync(path.join(root, relative)).size, 0);
    assert.ok(bytes <= maxBytes, `${governanceDepth}: ${bytes} > ${maxBytes} bytes`);
    context.diagnostic(JSON.stringify({ governanceDepth, files: actualPaths.length, bytes, maxBytes, paths: actualPaths }));
  }
});

test('the full framework does not eagerly enable external evidence or lifecycle integrations', (context) => {
  const { config, scan } = fixture(context);
  for (const governanceDepth of ['minimal', 'standard', 'complete']) {
    const paths = buildArtifacts({ ...config, governanceDepth }, scan).map(item => item.path).sort();
    assert.deepEqual(paths, COMPLETE_CODEX_ALLOWLIST);
    assert.equal(paths.some(value => /release-acceptance|surface-results|acceptance-results|lifecycle/.test(value)), false);
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
  assert.deepEqual(selectArtifactDefinitions(config, scan, definitions).map((item) => item.path).sort(), COMPLETE_CODEX_ALLOWLIST);
  assert.deepEqual([...resolveGovernanceCapabilities(config, scan)], ['core', 'routing', 'policy', 'integration']);
  assert.equal(JSON.stringify({ config, scan }), before);
});

test('first-use materializes only the requested evidence family and never manufactures results', (context) => {
  const { config, scan } = fixture(context);
  for (const [usage, relative] of [
    ['release', 'docs/ai/evidence/release-acceptance-policy.json'],
    ['surface', '.ai-governance/state/surface-verification-profiles.json'],
    ['acceptance', 'docs/ai/evidence/acceptance-contract.json'],
  ]) {
    const snapshot = { ...scan, governanceUsage: [usage] };
    const paths = buildArtifacts(config, snapshot).map((item) => item.path).sort();
    assert.deepEqual(paths, [...COMPLETE_CODEX_ALLOWLIST, relative].sort());
    assert.equal(selectedArtifactDefinitions(config, snapshot).find((item) => item.path === relative).activation, 'first-use');
  }
});

test('first-use Chinese evidence artifacts localize prose and preserve every machine field', (context) => {
  const { root, config, scan } = fixture(context);
  const expected = new Map([
    ['docs/ai/evidence/release-acceptance-policy.json', fs.readFileSync('assets/policies/release-acceptance-policy.json', 'utf8')],
    ['.ai-governance/state/surface-verification-profiles.json', remapContentPaths(stableJson(surfaceVerificationProfiles()), 'compact')],
    ['docs/ai/evidence/acceptance-contract.json', remapContentPaths(fs.readFileSync('assets/contracts/acceptance-contract.json', 'utf8'), 'compact')],
  ]);
  assert.equal(sha256(expected.get('docs/ai/evidence/release-acceptance-policy.json')), 'bf8b8f04edd635455efb10334140d5b628d82f8ebebab06cbcaac42558e61e50');
  assert.equal(sha256(expected.get('.ai-governance/state/surface-verification-profiles.json')), '88aa04ba15670083cf35903d457f91ff58cac1899becd8b12fc8e7ba53d3eae1');
  assert.equal(sha256(expected.get('docs/ai/evidence/acceptance-contract.json')), 'd6c73574cb39184d254600f4154b211bf55a40204c30482f9fd835948d47b6a5');
  const proseKeys = new Set(['description', 'reason', 'claimBoundary', 'binding', 'coverage', 'applies_when', 'negative_case', 'expected_failure', 'recovery_case', 'expected_recovery', 'proves']);
  const machineFields = (value, location = [], requireChinese = false) => {
    if (typeof value === 'string' && (proseKeys.has(location.at(-1)) || ['claim_states', 'failure_policy'].includes(location.at(-2)))) {
      if (requireChinese) assert.match(value, /[\u3400-\u9fff]/u, location.join('.'));
      return '<localized-prose>';
    }
    if (Array.isArray(value)) return value.map((entry, index) => machineFields(entry, [...location, index], requireChinese));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, machineFields(entry, [...location, key], requireChinese)]));
    return value;
  };
  const snapshot = { ...scan, governanceUsage: ['release', 'surface', 'acceptance'] };
  for (const artifactLanguage of ['en', 'bilingual', 'zh-CN']) {
    const artifacts = buildArtifacts({ ...config, artifactLanguage }, snapshot);
    for (const [relative, english] of expected) {
      const content = artifacts.find((entry) => entry.path === relative).content;
      if (artifactLanguage !== 'zh-CN') assert.equal(content, english, `${artifactLanguage}: ${relative}`);
      assert.deepEqual(machineFields(JSON.parse(content), [], artifactLanguage === 'zh-CN'), machineFields(JSON.parse(english)), relative);
    }
    if (artifactLanguage === 'zh-CN') {
      applyArtifactPlan(root, planArtifacts(root, artifacts));
      assert.equal(checkProject(scanProject(root)).ok, true);
      const results = 'docs/ai/evidence/acceptance-results.json';
      fs.writeFileSync(path.join(root, results), JSON.stringify({ contract_schema_version: 2, results: [] }));
      assert.equal(checkProject(scanProject(root)).ok, false, 'localized acceptance contract must still enforce full probe coverage');
    }
  }
});

test('minimal checker passes with optional policies absent and still rejects missing kernel files', (context) => {
  const { root, config, scan } = fixture(context);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  fs.unlinkSync(path.join(root, 'docs/ai/policies/00_always.mdc'));
  const failed = checkProject(scanProject(root));
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('docs/ai/policies/00_always.mdc')));
});

test('full governance projects only the selected clients', (context) => {
  const { config, scan } = fixture(context);
  for (const clients of [['codex'], ['claude-code'], ['cursor'], ['codex', 'claude-code', 'cursor']]) {
    const paths = buildArtifacts({ ...config, clients }, scan).map(item => item.path);
    for (const [client, directory] of [['codex', '.agents/'], ['claude-code', '.claude/'], ['cursor', '.cursor/']]) {
      assert.equal(paths.some(relative => relative.startsWith(directory)), (client === 'codex' ? clients.includes('codex') || clients.includes('cursor') : clients.includes(client)), client);
    }
    assert.ok(paths.includes('docs/ai/agents/architect.md'));
  }
});

test('legacy minimal cannot downgrade the framework and retains owner-edited seeds', (context) => {
  const { root, config, scan } = fixture(context);
  const standard = { ...config, governanceDepth: 'complete' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(standard, scan)));
  const canonical = path.join(root, 'docs/ai/policies/anti-patterns.md');
  fs.appendFileSync(canonical, '\nOwner guidance.\n');
  const original = fs.readFileSync(canonical, 'utf8');
  const plan = planArtifacts(root, buildArtifacts(config, scanProject(root)));
  assert.equal(plan.operations.some((operation) => operation.remove), false);
  assert.ok(plan.operations.some((entry) => entry.path === '.ai-governance/state/stack-profile.json'));
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
  assert.match(fs.readFileSync(contextPath, 'utf8'), /required:\n      - docs\/ai\/evidence\/release-acceptance-policy.json/);
});

test('lifecycle features remain independent at every depth', (context) => {
  const { config, scan } = fixture(context);
  for (const governanceDepth of ['minimal', 'standard', 'complete']) {
    const paths = buildArtifacts({ ...config, governanceDepth, features: { ...config.features, taskRuntime: true } }, scan).map((item) => item.path);
    assert.ok(paths.includes('docs/ai/long-running/README.md'));
    assert.ok(paths.includes('docs/ai/policies/lifecycle.md'));
    assert.equal(paths.includes('docs/memory/INDEX.json'), true);
    assert.equal(paths.includes('docs/ai/integrations/hooks.md'), false);
    assert.equal(paths.includes('docs/ai/integrations/ci-integration.md'), false);
    assert.equal(paths.includes('docs/ai/integrations/workflow-integrations.yaml'), false);
  }
});

test('produced evidence and certification receipts are preserved without creating placeholders', (context) => {
  const { root, config, scan } = fixture(context);
  const resultPaths = ['docs/ai/evidence/acceptance-results.json', 'docs/ai/evidence/surface-results.json', 'docs/ai/evidence/certification-evidence.json'];
  const fresh = buildArtifacts(config, scan);
  for (const relative of resultPaths) assert.equal(fresh.some((item) => item.path === relative), false);
  fs.mkdirSync(path.join(root, 'docs/ai/evidence'), { recursive: true });
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
      business: ['docs/ai/policies/business-constraints.json', 'docs/ai/skills/business-constraints/SKILL.md'],
      architecture: ['.ai-governance/state/architecture-profile.json', 'docs/ai/policies/15_architecture.mdc'],
      stack: ['.ai-governance/state/stack-profile.json', 'docs/ai/policies/20_stack.mdc', '.ai-governance/state/technical-standards.json', 'docs/ai/skills/standards/software-design-and-verification/SKILL.md'],
    }[scenario.startsWith('architecture-') ? 'architecture' : scenario];
    for (const relative of expected) {
      assert.ok(map.includes(`        - ${relative}\n`), `missing route ${relative}`);
      assert.equal(fs.existsSync(path.join(root, relative)), true);
    }
    assert.equal(checkProject(scanProject(root)).ok, true);
  });
}


function makeLegacyConditionalRoute(target) {
  const text = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, text.replace(/  behavior_change:[\s\S]*?(?=  bugfix:)/, '  behavior_change:\n    extends: ordinary\n    required: []\n    conditional: {}\n'));
}

test('conditional upgrade preserves custom conditions comments order and CRLF bytes', (context) => {
  const { root, config, scan } = fixture(context);
  config.features.knowledge = false;
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const target = path.join(root, 'docs/ai/context-map.yaml');
  makeLegacyConditionalRoute(target);
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
  for (const scenario of ['foreign', 'duplicate', 'inline-map']) {
    const { root, config, scan } = fixture(context);
    config.features.knowledge = false;
    applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
    const target = path.join(root, 'docs/ai/context-map.yaml');
  makeLegacyConditionalRoute(target);
    const manifestPath = path.join(root, '.ai-governance/manifest.json');
    if (scenario === 'foreign') {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.generatedBy = 'foreign-owner';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    } else {
      const replacement = {
        duplicate: '    conditional: {}\n    conditional: {}',
        'inline-map': '    conditional: {stack: [docs/owner.md]}',
      }[scenario];
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('    conditional: {}', replacement));
    }
    const before = [target, manifestPath, path.join(root, '.ai-governance/config.json')].map((file) => [file, fs.readFileSync(file, 'utf8')]);
    const upgraded = { ...config, domainConstraints: ['Keep owner data scoped.'] };
    const plan = planArtifacts(root, buildArtifacts(upgraded, scanProject(root)));
    assert.throws(() => applyArtifactPlan(root, plan, { transactional: true, verify: () => checkProject(scanProject(root)) }));
    for (const [file, bytes] of before) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(root, '.ai-governance/state/technical-standards.json')), true);
  }
});

test('a trusted conditional upgrade appends generated paths to an existing owner route', (context) => {
  const { root, config, scan } = fixture(context);
  config.features.knowledge = false;
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const target = path.join(root, 'docs/ai/context-map.yaml');
  makeLegacyConditionalRoute(target);
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(
    '    conditional: {}',
    '    conditional:\n      stack:\n        - docs/owner.md',
  ));
  const upgraded = { ...config, governanceDepth: 'standard' };
  const plan = planArtifacts(root, buildArtifacts(upgraded, scanProject(root)));
  assert.deepEqual(plan.conflicts, []);
  applyArtifactPlan(root, plan, { transactional: true, verify: () => checkProject(scanProject(root)) });
  const after = fs.readFileSync(target, 'utf8');
  assert.match(after, /stack:\n        - docs\/owner\.md\n        - .ai-governance\/state\/stack-profile\.json/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('trusted stack routing appends a newly detected standard without replacing prior routes', (context) => {
  const { root, config, scan } = fixture(context);
  config.features.knowledge = false;
  config.governanceDepth = 'standard';
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const target = path.join(root, 'docs/ai/context-map.yaml');
  const before = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vue: '3.5.0' } }));
  const current = scanProject(root);
  const plan = planArtifacts(root, buildArtifacts({ ...config, projectMode: current.projectMode }, current));
  assert.deepEqual(plan.conflicts, []);
  applyArtifactPlan(root, plan, { transactional: true, verify: () => checkProject(scanProject(root)) });
  const after = fs.readFileSync(target, 'utf8');
  assert.ok(after.includes('docs/ai/skills/standards/vue-component-composition/SKILL.md'));
  for (const line of before.split('\n').filter((entry) => entry.startsWith('        - '))) assert.ok(after.includes(line));
});
