import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initCommand, prepareInit } from '../src/cli/commands/init.mjs';
import { checkProject } from '../src/checker.mjs';
import { loadExistingConfig } from '../src/cli/shared.mjs';
import { scanProject } from '../src/scanner.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
}

const FOREIGN_SKILL = 'docs/ai/skills/house-style/SKILL.md';
const FOREIGN_CONTEXT_MAP = [
  'version: 1',
  'status: canonical',
  'purpose: "Existing owner-authored routing that predates AICG."',
  'default_start:',
  '  - docs/ai/README.md',
  '',
  'profiles:',
  '  house-style:',
  '    description: Owner-authored routing profile that must survive adoption.',
  '    required:',
  '      - docs/ai/skills/house-style/SKILL.md',
  '    verify:',
  '      - npm run lint',
  '',
].join('\n');

const BROWNFIELD_CONFIG = {
  schemaVersion: 1,
  stacks: ['backend-node'],
  governanceDepth: 'standard',
  artifactLanguage: 'en',
  initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
  clientSupport: { mode: 'selected', selectedClients: ['codex'], source: 'config' },
  clients: ['codex'],
};

function seedForeignGovernance(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'foreign-fixture', version: '1.0.0', type: 'module' }, null, 2));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/index.js'), 'export const value = 1;\n');
  const skillDir = path.join(root, 'docs/ai/skills/house-style');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: house-style\ndescription: Existing project skill.\n---\n\n# House Style\n');
  fs.writeFileSync(path.join(root, 'docs/ai/context-map.yaml'), FOREIGN_CONTEXT_MAP);
  fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify(BROWNFIELD_CONFIG, null, 2));
}

test('existing foreign executable governance blocks with one actionable root cause', async (t) => {
  const root = fixture('foreign-block');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedForeignGovernance(root);

  const prepared = await prepareInit(root, { yes: true, 'dry-run': true }, { allowDefaults: true, suppliedConfig: BROWNFIELD_CONFIG });
  assert.equal(prepared.plan.conflicts.length, 1, prepared.plan.conflicts.join('\n'));
  assert.match(prepared.plan.conflicts[0], /--adopt-foreign-governance/);
  assert.match(prepared.plan.conflicts[0], /house-style/);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  assert.equal(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), FOREIGN_CONTEXT_MAP);
});

test('replaceExisting alone still refuses instead of overwriting foreign governance', async (t) => {
  const root = fixture('foreign-replace');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedForeignGovernance(root);

  const prepared = await prepareInit(root, { yes: true, 'dry-run': true, replaceExisting: true }, { allowDefaults: true, suppliedConfig: BROWNFIELD_CONFIG });
  assert.equal(prepared.plan.conflicts.length, 1, prepared.plan.conflicts.join('\n'));
  assert.match(prepared.plan.conflicts[0], /--adopt-foreign-governance/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), FOREIGN_CONTEXT_MAP);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
});

test('adopt preserves owner files, records them, and passes check plus a second run', async (t) => {
  const root = fixture('foreign-adopt');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedForeignGovernance(root);

  await initCommand(root, { yes: true, config: path.join(root, 'answers.json'), 'adopt-foreign-governance': true });

  const config = loadExistingConfig(root);
  assert.equal(config.externalGovernance.strategy, 'adopt');
  assert.deepEqual(config.externalGovernance.adopted, [FOREIGN_SKILL]);

  // The owner's file and profile survive; AICG's required routing is appended, not swapped in.
  assert.equal(fs.existsSync(path.join(root, FOREIGN_SKILL)), true);
  const merged = fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8');
  assert.match(merged, /house-style:/);
  assert.match(merged, /^base:/m);
  assert.match(merged, /^  ordinary:$/m);
  assert.match(merged, /^  behavior_change:$/m);
  assert.match(merged, /^  release:$/m);

  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.orphans.count, 0, JSON.stringify(checked.orphans));

  // A second run is idempotent and still keeps the adopted file out of the orphan report.
  await initCommand(root, { yes: true, config: path.join(root, 'answers.json'), 'adopt-foreign-governance': true });
  const rechecked = checkProject(scanProject(root));
  assert.equal(rechecked.ok, true, JSON.stringify(rechecked.errors));
  assert.equal(rechecked.orphans.count, 0, JSON.stringify(rechecked.orphans));
});
