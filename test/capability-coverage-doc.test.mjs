import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COVERAGE_SUMMARY_END, COVERAGE_SUMMARY_START, renderCapabilityCoverageSummary } from '../src/modules/capabilities/coverage.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(testRoot, '..', 'assets/registries/capability-pack-registry.json'), 'utf8'));

function documentedBlock() {
  const document = fs.readFileSync(path.join(testRoot, '..', 'docs/internal/reference/capability-packs.md'), 'utf8');
  const start = document.indexOf(COVERAGE_SUMMARY_START);
  const end = document.indexOf(COVERAGE_SUMMARY_END);
  assert.ok(start !== -1 && end > start, 'the generated coverage block is present');
  return document.slice(start, end + COVERAGE_SUMMARY_END.length);
}

test('the documented coverage summary matches the generated summary byte for byte', () => {
  assert.equal(documentedBlock(), renderCapabilityCoverageSummary({ registry }).trimEnd());
});

test('the generated summary lists every pack and declares its gaps', () => {
  const rendered = renderCapabilityCoverageSummary({ registry });
  for (const entry of registry.packs) assert.ok(rendered.includes(`\`${entry.id}\``), entry.id);
  assert.ok(rendered.includes(COVERAGE_SUMMARY_START));
  assert.ok(rendered.trimEnd().endsWith(COVERAGE_SUMMARY_END));
});
