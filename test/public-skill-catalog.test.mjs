import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCuratedSkillRecords, loadPublicSkillCatalog } from '../src/catalogs/index.mjs';
import { discoverSkills } from '../src/skill-discovery.mjs';
import { validateRecord } from '../scripts/skill-catalog.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'bin/aicg.js');

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-catalog-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('the packaged snapshot is well formed and every record is declared by the sources manifest', () => {
  const document = loadPublicSkillCatalog();
  const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/registries/public-skill-sources.json'), 'utf8'));
  assert.equal(document.schema_version, 1);
  assert.ok(document.catalog.length > 0 && document.catalog.length <= 256);
  const declared = new Set(sources.sources.flatMap((source) => source.skills.map((skill) => `official:${source.owner}/${source.repo}/${skill.id}`)));
  for (const record of document.catalog) {
    assert.ok(declared.has(record.source), record.source);
    assert.match(record.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.contentBytes > 0);
    assert.ok(record.capabilities.includes(record.capabilityOwner));
    assert.ok(record.permissions.every((permission) => typeof permission === 'string'));
  }
  assert.equal(new Set(document.catalog.map((record) => record.capabilityOwner)).size, document.catalog.length);
});

test('curated records are detached copies and stay candidate-only metadata', () => {
  const first = loadCuratedSkillRecords();
  first[0].capabilities.push('tampered');
  first[0].decision = 'add';
  const second = loadCuratedSkillRecords();
  assert.equal(second[0].capabilities.includes('tampered'), false);
  assert.equal(second[0].decision, undefined);
  assert.equal(second[0].content, undefined);
});

test('packaged records surface through discovery only for a matching required capability', (context) => {
  const root = fixture(context);
  const records = loadCuratedSkillRecords();
  const creator = records.find((record) => record.capabilityOwner === 'skill-authoring');
  const matched = discoverSkills({ root, installedRoots: [], curatedCatalog: records, requiredCapabilities: ['skill-authoring'] });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].sourceKind, 'official-curated');
  assert.equal(matched[0].capabilityOwner, 'skill-authoring');
  assert.equal(matched[0].decision, 'discovered');
  // Freshness is derived from the pinned commit date, so assert the boundary instead of a
  // wall-clock guess that would break the test three months after this commit.
  const age = Date.now() - Date.parse(creator.verifiedAt);
  assert.equal(matched[0].availability, age <= 90 * 86400000 ? 'available' : 'refresh-due');
  const unmatched = discoverSkills({ root, installedRoots: [], curatedCatalog: records, requiredCapabilities: ['not-a-declared-capability'] });
  assert.equal(unmatched.length, 0);
});

test('the maintainer validator rejects a record the runtime would refuse', () => {
  const good = loadCuratedSkillRecords()[0];
  assert.equal(validateRecord(good, 0), good);
  assert.throws(() => validateRecord({ ...good, contentSha256: 'not-a-digest' }, 0), /contentSha256/);
  assert.throws(() => validateRecord({ ...good, capabilityOwner: 'unaligned-owner' }, 0), /capabilityOwner/);
  assert.throws(() => validateRecord({ ...good, contentBytes: 0 }, 0), /contentBytes/);
});

test('a vendored tree rebuilds the committed catalog byte for byte', { skip: !fs.existsSync(path.join(ROOT, 'vendor/skills')) }, async () => {
  const { buildCatalog } = await import('../scripts/skill-catalog.mjs');
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/registries/public-skill-catalog.json'), 'utf8'));
  assert.deepEqual(buildCatalog(), committed);
});

function adaptiveConfig(extra = {}) {
  return {
    clients: ['codex'], stacks: ['generic-unknown'], governanceDepth: 'standard', artifactLanguage: 'en',
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null },
    adaptiveGovernance: {
      installedRoots: [], curatedCatalog: [], requiredCapabilities: ['skill-authoring'],
      projectTeam: { evidence: [{ id: 'owner.scope', kind: 'user-confirmed-project' }], confirmedDomainNeeds: [], roleNeeds: [] },
      decisions: { skills: [], roles: [] }, activation: {},
      ...extra,
    },
  };
}

function preview(context, config) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-catalog-cli-'));
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root);
  const configPath = path.join(parent, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [CLI, 'init', root, '--yes', '--config', configPath, '--dry-run'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const start = result.stdout.indexOf('{\n  "dryRun"');
  return JSON.parse(start < 0 ? result.stdout : result.stdout.slice(start));
}

test('publicSkillCatalog is opt-in and never installs or preselects a third-party Skill', (context) => {
  const off = preview(context, adaptiveConfig());
  assert.equal(off.adaptiveGovernance.skills.candidates.some((entry) => entry.sourceKind === 'official-curated'), false);

  const on = preview(context, adaptiveConfig({ publicSkillCatalog: true }));
  const curated = on.adaptiveGovernance.skills.candidates.filter((entry) => entry.sourceKind === 'official-curated');
  assert.equal(curated.length, 1);
  assert.equal(curated[0].capabilityOwner, 'skill-authoring');
  assert.equal(on.adaptiveGovernance.decisions.skills.find((entry) => entry.id === curated[0].id).action, 'defer');
  assert.equal(on.files.some((entry) => /skill-creator/.test(entry.path)), false);
});

test('a non-boolean publicSkillCatalog is rejected before any plan is built', (context) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-catalog-bad-'));
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root);
  const configPath = path.join(parent, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify(adaptiveConfig({ publicSkillCatalog: 'yes' })));
  const result = spawnSync(process.execPath, [CLI, 'init', root, '--yes', '--config', configPath, '--dry-run'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /adaptiveGovernance|bounded metadata|installedRoots/i);
  assert.equal(fs.readdirSync(root).length, 0);
});
