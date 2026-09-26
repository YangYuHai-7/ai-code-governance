import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, validateConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { BROWNFIELD_ENRICHMENT_KIND, BROWNFIELD_ENRICHMENT_SKILL, buildBrownfieldEnrichmentArtifacts } from '../src/modules/governance/brownfield-enrichment.mjs';

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-enrichment-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('the enrichment preference is separate from the owner decision record', (context) => {
  const scan = scanProject(fixture(context));
  const config = defaultConfig(scan);
  assert.equal(config.features.brownfieldEnrichment, 'ask');
  assert.equal(config.brownfieldEnrichmentDecision, null);
  assert.throws(() => validateConfig({ ...config, features: { ...config.features, brownfieldEnrichment: 'maybe' } }), /brownfieldEnrichment/);
  assert.throws(() => validateConfig({ ...config, brownfieldEnrichmentDecision: { status: 'maybe', decidedBy: 'owner', decidedAt: '2026-09-24', evidenceHash: 'a'.repeat(64) } }), /brownfieldEnrichmentDecision/);
  assert.throws(() => validateConfig({ ...config, brownfieldEnrichmentDecision: { status: 'approved', decidedBy: 'owner', decidedAt: '2026-09-24', evidenceHash: 'nope' } }), /brownfieldEnrichmentDecision/);
  const ok = validateConfig({ ...config, brownfieldEnrichmentDecision: { status: 'approved', decidedBy: 'owner', decidedAt: '2026-09-24', evidenceHash: 'a'.repeat(64) } });
  assert.equal(ok.brownfieldEnrichmentDecision.status, 'approved');
});

test('the enrichment Skill ships for existing-code repositories and stops on off', (context) => {
  const scan = scanProject(fixture(context));
  const base = { ...defaultConfig(scan), governanceDepth: 'standard', initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  const on = buildBrownfieldEnrichmentArtifacts(base).artifacts;
  assert.equal(on.length, 1);
  assert.equal(on[0].path, BROWNFIELD_ENRICHMENT_SKILL);
  assert.equal(on[0].kind, BROWNFIELD_ENRICHMENT_KIND);
  assert.match(on[0].content, /## Required invariants/);
  assert.match(on[0].content, /brownfieldEnrichmentDecision/);
  assert.deepEqual(buildBrownfieldEnrichmentArtifacts({ ...base, features: { ...base.features, brownfieldEnrichment: 'off' } }).artifacts, []);
  assert.deepEqual(buildBrownfieldEnrichmentArtifacts({ ...base, governanceDepth: 'minimal' }).artifacts, []);
  assert.deepEqual(buildBrownfieldEnrichmentArtifacts({ ...base, initialization: { lifecycle: 'greenfield', source: 'config' }, projectMode: 'greenfield' }).artifacts, []);
});
