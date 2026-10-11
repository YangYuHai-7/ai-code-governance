import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.join(testRoot, '..', '.github/workflows/ci.yml'), 'utf8');

test('CI runs layered on pull requests, main pushes, and release tags', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:\s*\[?\s*main/);
  assert.match(workflow, /tags:\s*\[?\s*'v\*'/);
  assert.match(workflow, /workflow_dispatch:/);
});

test('platform state is published from current run evidence with Windows preview-only', () => {
  assert.match(workflow, /platform-state/);
  assert.match(workflow, /needs:\s*\[?\s*fast/);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /preview-only/i);
  assert.match(workflow, /continue-on-error:\s*\$\{\{\s*matrix\.os == 'windows-latest'\s*\}\}/);
  assert.doesNotMatch(workflow, /dangerously|--full-auto|--yolo/);
});

test('the required fast layer is never softened and node stays above the 24 floor for the required layer', () => {
  const fastJob = workflow.slice(workflow.indexOf('  fast:'), workflow.indexOf('  full:'));
  assert.doesNotMatch(fastJob, /continue-on-error/);
  assert.match(fastJob, /node-version:\s*24/);
});
test('published platform state is derived from the legs the run produced, not from a literal list', () => {
  assert.doesNotMatch(workflow, /"verifiedPlatforms":\["linux","darwin"\]/);
  assert.match(workflow, /pattern:\s*platform-leg-\*/);
  assert.match(workflow, /supportedFailures/);
  assert.match(workflow, /verifiedPlatforms = \[\.\.\.new Set\(legs\.filter/);
  assert.match(workflow, /platform-leg\.json/);
  assert.match(workflow, /if:\s*always\(\)/);
});

test('every matrix leg records its own real status before the state job reads it', () => {
  const fullJob = workflow.slice(workflow.indexOf('full:'), workflow.indexOf('platform-state:'));
  assert.match(fullJob, /status:\s*'\$\{\{\s*job\.status\s*\}\}'/);
  assert.match(fullJob, /if:\s*always\(\)/);
  assert.match(workflow, /previewOnly:\s*\['win32'\]/);
});
