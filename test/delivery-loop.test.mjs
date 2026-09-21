import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';
import { loadAgentRegistry, selectedSkillDirectories, declaredSkillDirectories, governanceRoots } from '../src/catalogs/index.mjs';
import { SUPPORTED_CLIENTS } from '../src/constants.mjs';
import { auditSkillQuality } from '../src/modules/standards/skill-quality.mjs';
import { isProductionScopePath } from '../src/modules/repository/production-scope.mjs';
import {
  buildDeliveryLoopArtifacts, DELIVERY_PHASES, DELIVERY_LOOP_ENTRY_KIND, DELIVERY_LOOP_LEDGER, DELIVERY_LOOP_PHASE_KIND,
} from '../src/modules/governance/delivery-loop.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('every supported client resolves to a Skill directory declared by the agent registry', () => {
  const registry = loadAgentRegistry();
  assert.deepEqual(registry.agents.map((agent) => agent.id), [...SUPPORTED_CLIENTS]);
  const directories = declaredSkillDirectories();
  assert.deepEqual(directories, ['.agents/skills', '.claude/skills', '.workbuddy/skills']);
  // Clients that share a directory must resolve to it once, not once per client.
  assert.deepEqual(selectedSkillDirectories(['codex', 'cursor', 'generic']), ['.agents/skills']);
  assert.deepEqual(selectedSkillDirectories(['claude-code']), ['.claude/skills']);
  assert.deepEqual(selectedSkillDirectories(['workbuddy']), ['.workbuddy/skills']);
  assert.deepEqual(selectedSkillDirectories(['workbuddy', 'claude-code']), ['.claude/skills', '.workbuddy/skills']);
});

test('a newly registered client directory is governance, not production source', () => {
  // The scanner must not count a client adapter directory as product code, or every governed
  // repository would report the generated Skills as unowned production files.
  for (const directory of declaredSkillDirectories()) {
    assert.equal(isProductionScopePath(`${directory}/sample/SKILL.md`), false, directory);
  }
  assert.ok(governanceRoots().includes('.workbuddy/skills'));
});

test('WorkBuddy is written to its own Skill directory and leaves other client directories untouched', (context) => {
  const root = fixture(context, 'workbuddy-client');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['workbuddy'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.ok(fs.existsSync(path.join(root, '.workbuddy', 'skills', 'standards')));
  assert.equal(fs.existsSync(path.join(root, '.agents')), false);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('the delivery loop ships by default in Standard and Complete and stays out of Minimal', (context) => {
  const root = fixture(context, 'delivery-loop-flag');
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['workbuddy'], governanceDepth: 'standard' };
  // The requirement-to-convergence workflow is part of what "governed" means, so Standard and
  // Complete carry it by default rather than requiring the owner to opt in.
  assert.equal(base.features.deliveryLoop, true);
  const on = buildArtifacts(base, scan).map((entry) => entry.path);
  assert.ok(on.includes(DELIVERY_LOOP_LEDGER));
  for (const phase of DELIVERY_PHASES) {
    assert.ok(on.includes(`.workbuddy/skills/delivery-${phase}/SKILL.md`), phase);
  }

  // An owner who declines it must keep their exact previous artifact set, and therefore their
  // exact previous recorded approval.
  const declined = { ...base, features: { ...base.features, deliveryLoop: false } };
  const off = buildArtifacts(declined, scan).map((entry) => entry.path);
  assert.equal(off.some((entry) => entry.includes('delivery')), false);

  // Minimal is the bootstrap-only kernel and never carries the loop, even by default.
  const minimal = { ...base, governanceDepth: 'minimal' };
  assert.equal(buildArtifacts(minimal, scan).map((entry) => entry.path).some((entry) => entry.includes('delivery')), false);

  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(base, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, DELIVERY_LOOP_LEDGER), 'utf8'));
  assert.equal(ledger.phase, 'decomposition');
  assert.deepEqual(ledger.phases, DELIVERY_PHASES);
  assert.equal(ledger.iterations.used, 0);
  assert.deepEqual(ledger.runs, []);
});

test('every delivery Skill satisfies the Skill quality contract in both languages', () => {
  for (const artifactLanguage of ['zh-CN', 'en']) {
    const { artifacts } = buildDeliveryLoopArtifacts({ artifactLanguage });
    const skills = artifacts.filter((artifact) => artifact.path.endsWith('SKILL.md'));
    assert.equal(skills.length, DELIVERY_PHASES.length + 1);
    for (const skill of skills) {
      const id = skill.path.split('/').slice(-2)[0];
      const report = auditSkillQuality(skill.content, { profile: 'workflow', id });
      assert.deepEqual(report.issues, [], `${artifactLanguage} ${id}`);
    }
  }
});

test('the ledger names a phase for every phase Skill and the dispatch table reaches each one', () => {
  const { artifacts } = buildDeliveryLoopArtifacts({ artifactLanguage: 'en' });
  const entry = artifacts.find((artifact) => artifact.kind === DELIVERY_LOOP_ENTRY_KIND);
  const phases = artifacts.filter((artifact) => artifact.kind === DELIVERY_LOOP_PHASE_KIND).map((artifact) => path.basename(path.dirname(artifact.path)));
  assert.deepEqual(phases, DELIVERY_PHASES.map((phase) => `delivery-${phase}`));
  // A phase the entry does not dispatch to would be unreachable, which is the whole point of
  // keeping the entry small instead of inlining every phase. The row names the Skill id first so
  // an agent can resolve it without pattern-matching prose.
  for (const phase of DELIVERY_PHASES) {
    assert.match(entry.content, new RegExp(`\\| \`${phase}\` \\| \`delivery-${phase}\` — `));
  }
});

test('delivery budgets separate the always-on entry from the on-demand phases', () => {
  const { artifacts } = buildDeliveryLoopArtifacts({ artifactLanguage: 'en' });
  const entry = artifacts.find((artifact) => artifact.kind === DELIVERY_LOOP_ENTRY_KIND);
  const phaseBytes = artifacts
    .filter((artifact) => artifact.kind === DELIVERY_LOOP_PHASE_KIND)
    .reduce((sum, artifact) => sum + Buffer.byteLength(artifact.content), 0);
  // The entry is read once per delivery; the phases are read one at a time. Folding both into
  // one ceiling is what made the always-on Skill management budget the wrong place for it.
  assert.ok(Math.ceil(Buffer.byteLength(entry.content) / 4) <= 1000, 'entry token ceiling');
  assert.ok(phaseBytes <= 24 * 1024, 'on-demand phase byte ceiling');
  assert.ok(Buffer.byteLength(entry.content) < phaseBytes, 'the entry must be the smaller surface');
});
