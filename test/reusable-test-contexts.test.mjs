import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as testing from '../src/testing.mjs';
import { sha256 } from '../src/shared/index.mjs';

const cli = path.resolve('bin/aicg.js');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-reuse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [cli, 'delivery', 'test-case', args[0], root, ...args.slice(1)], { encoding: 'utf8' });
  assert.equal(run('init', '--scope', 'MODULE', '--output', 'qa', '--yes').status, 0);
  const file = 'qa/MODULE-test-cases.json';
  const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  manifest.cases = [{
    id: 'MODULE-TC-001', title: 'Read module status', priority: 'P1', layer: 'acceptance',
    tags: ['smoke'], sourceIds: ['REQ-STATUS'], ctx: { actor: 'reader', environment: 'mac', data: ['workspace'] },
    pre: [], steps: [{ do: 'observe', target: 'status', see: ['Ready'] }], final: [], evidence: [], cleanup: [],
    automation: { kind: 'agent', runPolicy: 'auto', driver: 'terminal' },
  }];
  const shared = {
    actors: { reader: { role: 'reader', goal: 'read status', authority: 'read-only', familiarity: 'regular', platform: 'terminal', accessibility: 'keyboard' }, unused: { role: 'unused', goal: 'unused', authority: 'none', familiarity: 'none', platform: 'terminal', accessibility: 'keyboard' } },
    environments: { mac: { platform: 'macOS', entry: 'terminal', requirements: [] } },
    data: { workspace: { description: 'Isolated workspace', secretEnv: [] } },
  };
  const content = JSON.stringify({ schemaVersion: 1, shared });
  fs.writeFileSync(path.join(root, 'qa/shared.json'), content);
  manifest.imports = [{ path: 'qa/shared.json', sha256: sha256(content) }];
  fs.writeFileSync(path.join(root, file), JSON.stringify(manifest));
  return { root, manifest, shared, file, run };
}

test('CLI initializes, selects and records digest-bound imported module context', (t) => {
  const { root, file, run } = fixture(t);
  const selected = run('select', '--manifest', file, '--output', 'qa/packet.json');
  assert.equal(selected.status, 0, selected.stderr);
  const packet = JSON.parse(fs.readFileSync(path.join(root, 'qa/packet.json'), 'utf8'));
  assert.deepEqual(Object.keys(packet.shared.actors), ['reader']);
  assert.equal(packet.shared.environments.mac.platform, 'macOS');
  fs.writeFileSync(path.join(root, 'qa/evidence.txt'), 'Ready\n');
  const external = {
    sessionId: 'module-run', scope: 'MODULE', baselineVersion: '1.0', manifestSha256: packet.manifestSha256,
    packetDigest: packet.packetDigest, operator: 'test runner', method: 'terminal', startedAt: 'start', finishedAt: 'finish',
    results: [{ id: 'MODULE-TC-001', status: 'PASS', actual: 'Ready', durationSeconds: 1, evidence: ['qa/evidence.txt'], classification: 'automated' }],
  };
  fs.writeFileSync(path.join(root, 'qa/results.json'), JSON.stringify(external));
  const recorded = run('record', '--manifest', file, '--packet', 'qa/packet.json', '--results', 'qa/results.json', '--ledger', 'qa/ledger.json');
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'qa/ledger.json'), 'utf8')).sessions[0].results[0].status, 'PASS');
  fs.appendFileSync(path.join(root, 'qa/shared.json'), '\n');
  assert.notEqual(run('record', '--manifest', file, '--packet', 'qa/packet.json', '--results', 'qa/results.json', '--ledger', 'qa/ledger.json').status, 0);
  const updated = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const library = JSON.parse(fs.readFileSync(path.join(root, 'qa/shared.json'), 'utf8'));
  library.shared.environments.mac.entry = 'new terminal';
  const changed = JSON.stringify(library);
  fs.writeFileSync(path.join(root, 'qa/shared.json'), changed);
  updated.imports[0].sha256 = sha256(changed);
  fs.writeFileSync(path.join(root, file), JSON.stringify(updated));
  const stalePacket = run('record', '--manifest', file, '--packet', 'qa/packet.json', '--results', 'qa/results.json', '--ledger', 'qa/ledger.json');
  assert.notEqual(stalePacket.status, 0);
  assert.match(stalePacket.stderr, /packet is stale/);
});

test('shared contexts resolve across modules without mutating source or importing unused actors', (t) => {
  const { root, manifest } = fixture(t);
  assert.equal(typeof testing.loadTestCaseManifest, 'function');
  const first = testing.loadTestCaseManifest(root, manifest);
  const second = testing.loadTestCaseManifest(root, { ...manifest, scope: 'OTHER' });
  assert.equal(first.shared.actors.reader.role, 'reader');
  assert.deepEqual(second.shared, first.shared);
  assert.deepEqual(manifest.shared.actors, {});
  assert.equal(Object.hasOwn(first.shared.actors, 'unused'), false);
});

test('imports reject missing, stale, conflicting, escaped and symlink context references', (t) => {
  const { root, manifest, shared } = fixture(t);
  assert.equal(typeof testing.loadTestCaseManifest, 'function');
  for (const unsafe of ['../shared.json', '/tmp/shared.json', '.git/shared.json']) {
    assert.throws(() => testing.loadTestCaseManifest(root, { ...manifest, imports: [{ ...manifest.imports[0], path: unsafe }] }), /safe repository-relative/);
  }
  assert.throws(() => testing.loadTestCaseManifest(root, { ...manifest, imports: [{ path: 'qa/missing.json', sha256: 'a'.repeat(64) }] }));
  assert.throws(() => testing.loadTestCaseManifest(root, { ...manifest, imports: [{ ...manifest.imports[0], sha256: 'a'.repeat(64) }] }), /digest|stale/i);
  const conflict = structuredClone(manifest);
  conflict.shared.actors.reader = { ...shared.actors.reader, authority: 'administrator' };
  assert.throws(() => testing.loadTestCaseManifest(root, conflict), /conflict/i);
  const missing = structuredClone(manifest);
  missing.cases[0].ctx.actor = 'unknown';
  assert.throws(() => testing.loadTestCaseManifest(root, missing), /unknown shared context/);
  const malformed = structuredClone(manifest);
  malformed.imports[0].sha256 = 1;
  assert.throws(() => testing.loadTestCaseManifest(root, malformed), /SHA-256/);
  fs.symlinkSync('shared.json', path.join(root, 'qa/link.json'));
  assert.throws(() => testing.loadTestCaseManifest(root, { ...manifest, imports: [{ ...manifest.imports[0], path: 'qa/link.json' }] }));
});
