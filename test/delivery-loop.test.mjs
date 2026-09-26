import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';
import { allBuiltInClientIds, clientGovernanceHomeDirectories, inferClientScopeFromRepository, loadAgentRegistry, selectedSkillDirectories, declaredSkillDirectories, governanceRoots } from '../src/catalogs/index.mjs';
import { SUPPORTED_CLIENTS } from '../src/constants.mjs';
import { isProductionScopePath } from '../src/modules/repository/production-scope.mjs';
import { buildDeliveryLoopArtifacts, DELIVERY_PHASES, DELIVERY_LOOP_LEDGER } from '../src/modules/governance/delivery-loop.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('every supported client resolves to a Skill directory declared by the agent registry', () => {
  const registry = loadAgentRegistry();
  assert.deepEqual(registry.agents.map((agent) => agent.id), [...SUPPORTED_CLIENTS]);
  const directories = declaredSkillDirectories();
  assert.deepEqual(directories, ['.agents/skills', '.claude/skills', '.github/skills', '.dsh/skills']);
  assert.deepEqual(selectedSkillDirectories(['codex', 'cursor', 'generic']), ['.agents/skills']);
  assert.deepEqual(selectedSkillDirectories(['claude-code']), ['.claude/skills']);
  assert.deepEqual(selectedSkillDirectories(['deepseek']), ['.dsh/skills']);
  assert.deepEqual(selectedSkillDirectories(['deepseek', 'claude-code']), ['.claude/skills', '.dsh/skills']);
});

test('a newly registered client directory is governance, not production source', () => {
  for (const directory of declaredSkillDirectories()) {
    assert.equal(isProductionScopePath(`${directory}/sample/SKILL.md`), false, directory);
  }
  assert.ok(governanceRoots().includes('.dsh/skills'));
});

test('DeepSeek Harness stays selectable-only and reads its own project Skill root', () => {
  assert.equal(allBuiltInClientIds().includes('deepseek'), false);
  const deepseek = loadAgentRegistry().agents.find((agent) => agent.id === 'deepseek');
  assert.equal(deepseek.built_in, false);
  assert.deepEqual(deepseek.detect_commands, ['dsh']);
  assert.equal(deepseek.instruction_entry, 'AGENTS.md');
  assert.deepEqual(deepseek.skill_directories, ['.dsh/skills']);
  assert.deepEqual(deepseek.assist, { command: 'dsh', args: ['--profile', 'headless', '{prompt}'] });
  assert.deepEqual(inferClientScopeFromRepository(['.dsh/skills/standards/SKILL.md']).clients, ['deepseek']);
});

test('client governance homes derive from the agent registry instead of client names', () => {
  assert.deepEqual(clientGovernanceHomeDirectories(), ['.agents', '.claude', '.cursor', '.dsh', '.github']);
  const synthetic = {
    schema_version: 1,
    agents: [{ id: 'future', label: 'Future', built_in: false, detect_commands: [], instruction_entry: 'AGENTS.md', skill_directories: ['.future/skills'], rule_directories: [] }],
  };
  assert.deepEqual(clientGovernanceHomeDirectories(synthetic), ['.future']);
});

test('DeepSeek Harness adapters land in .dsh/skills and leave other client directories untouched', (context) => {
  const root = fixture(context, 'deepseek-client');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['deepseek'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.ok(fs.existsSync(path.join(root, '.dsh', 'skills', 'standards')));
  assert.equal(fs.existsSync(path.join(root, '.agents')), false);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('the delivery loop ships as a runtime ledger and stays out of Minimal', (context) => {
  const root = fixture(context, 'delivery-loop-flag');
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['deepseek'], governanceDepth: 'standard' };
  assert.equal(base.features.deliveryLoop, true);
  const on = buildArtifacts(base, scan).map((entry) => entry.path);
  assert.ok(on.includes('.ai-governance/state/delivery-loop.json'));
  // The loop is a ledger plus the shared workflow document, never one Skill per phase.
  assert.equal(on.some((entry) => entry.includes('skills/delivery-')), false);

  const declined = { ...base, features: { ...base.features, deliveryLoop: false } };
  const off = buildArtifacts(declined, scan).map((entry) => entry.path);
  assert.equal(off.some((entry) => entry.includes('delivery-loop.json')), false);

  const minimal = { ...base, governanceDepth: 'minimal' };
  assert.equal(buildArtifacts(minimal, scan).map((entry) => entry.path).some((entry) => entry.includes('delivery')), false);

  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(base, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/state/delivery-loop.json'), 'utf8'));
  assert.equal(ledger.phase, 'decomposition');
  assert.deepEqual(ledger.phases, DELIVERY_PHASES);
  assert.equal(ledger.iterations.used, 0);
  assert.deepEqual(ledger.runs, []);
  assert.deepEqual(ledger.classification, { business: null, by: null, reason: null });
  assert.deepEqual(ledger.blockedOnOwner, []);
});

test('the delivery loop artifact is exactly one ledger in both languages', () => {
  for (const artifactLanguage of ['zh-CN', 'en']) {
    const { artifacts } = buildDeliveryLoopArtifacts({ artifactLanguage });
    assert.equal(artifacts.length, 1, artifactLanguage);
    assert.equal(artifacts[0].path, DELIVERY_LOOP_LEDGER);
    assert.equal(artifacts[0].ownership, 'seed');
    assert.equal(artifacts[0].kind, 'delivery-loop-ledger');
  }
});
