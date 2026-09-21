import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { governedArtifactSnapshot, runIndependentReview } from '../src/modules/governance/independent-review.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-review-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.ai-governance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-governance/config.json'), '{}');
  fs.writeFileSync(path.join(root, '.ai-governance/manifest.json'), JSON.stringify({ files: [{ path: 'docs/ai/architecture.md' }] }));
  fs.writeFileSync(path.join(root, 'docs/ai/architecture.md'), 'Modules and boundaries.\n');
  fs.writeFileSync(path.join(root, 'product.js'), 'export const value = 1;\n');
  return root;
}

function response(overrides = {}) {
  return {
    decision: 'accept',
    scores: { completeness: 90, stackAlignment: 90, architecture: 90, agentRouting: 90, evidence: 90 },
    findings: [], gaps: ['Qualified human review remains pending.'], summary: 'Governance artifacts reviewed.', ...overrides,
  };
}

function fakeCodex(answer, mutate) {
  return (_command, args) => {
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('read-only'));
    assert.ok(args.includes('--ephemeral'));
    const output = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(output, JSON.stringify(answer));
    mutate?.();
    return { status: 0 };
  };
}

test('binds an accepted Agent review to the exact governed artifacts and writes a report', (t) => {
  const root = fixture(t);
  const digest = governedArtifactSnapshot(root).digest;
  const result = runIndependentReview(root, { selectedAgents: ['codex'], commandExists: () => true, runCommand: fakeCodex(response()), lifecycle: 'existing' });
  assert.equal(result.status, 'agent-accepted');
  assert.equal(result.process.status, 'completed');
  assert.equal(result.artifactDigest, digest);
  assert.ok(result.roles.includes('business-analyst'));
  assert.ok(result.boundaries.some((line) => line.includes('not qualified human')));
  assert.deepEqual(result.unexpectedChanges, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, result.reportPath), 'utf8')).status, 'agent-accepted');
});

test('no available selected read-only Agent leaves a pending report', (t) => {
  const root = fixture(t);
  const result = runIndependentReview(root, { selectedAgents: ['claude-code'], commandExists: () => true });
  assert.equal(result.status, 'pending-unverified');
  assert.equal(result.process.status, 'not-launched');
  assert.ok(fs.existsSync(path.join(root, result.reportPath)));
});

test('successful process with low scores or severe findings is not accepted', (t) => {
  const root = fixture(t);
  const answer = response({ scores: { ...response().scores, architecture: 60 }, findings: [{ severity: 'high', path: 'docs/ai/architecture.md', message: 'No extension boundary.' }] });
  const result = runIndependentReview(root, { commandExists: () => true, runCommand: fakeCodex(answer) });
  assert.equal(result.process.status, 'completed');
  assert.equal(result.status, 'needs-revision');
});

test('reviewer mutation of an already dirty product file is detected without discarding changes', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'product.js');
  const result = runIndependentReview(root, {
    commandExists: () => true,
    runCommand: fakeCodex(response(), () => fs.writeFileSync(file, 'export const value = 2;\n')),
  });
  assert.equal(result.status, 'unsafe-changes');
  assert.deepEqual(result.unexpectedChanges, ['product.js']);
  assert.match(fs.readFileSync(file, 'utf8'), /value = 2/);
});

test('missing structured output remains unverified after successful process exit', (t) => {
  const root = fixture(t);
  const result = runIndependentReview(root, { commandExists: () => true, runCommand: () => ({ status: 0 }) });
  assert.equal(result.process.status, 'completed');
  assert.equal(result.status, 'pending-unverified');
});

test('changed governed artifact invalidates the review digest', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'docs/ai/architecture.md');
  const result = runIndependentReview(root, {
    commandExists: () => true,
    runCommand: fakeCodex(response(), () => fs.writeFileSync(file, 'Different architecture.\n')),
  });
  assert.equal(result.status, 'unsafe-changes');
  assert.ok(result.unexpectedChanges.includes('docs/ai/architecture.md'));
  assert.match(result.reason, /stale/);
});
