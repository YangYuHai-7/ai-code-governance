import assert from 'node:assert/strict';
import test from 'node:test';
import { assistCandidates, runAssist } from '../src/assist.mjs';

test('lists only selected and available AI completion agents', () => {
  const candidates = assistCandidates(
    { clients: ['codex', 'claude-code', 'generic'] },
    { commandExists: (command) => command === 'claude' },
  );
  assert.deepEqual(candidates.map((candidate) => candidate.id), ['claude-code']);
});

test('reports a missing agent as unverified without throwing', () => {
  const result = runAssist('cursor', '.', { commandExists: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unverified');
  assert.equal(result.retry, 'aicg init . --yes --assist cursor');
});

test('runs the normal agent command without bypass flags', () => {
  let invocation;
  const result = runAssist('codex', '/tmp/project', {
    commandExists: () => true,
    spawnSync: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(invocation.command, 'codex');
  assert.ok(invocation.args.includes('/tmp/project'));
  assert.equal(invocation.args.some((arg) => /bypass|dangerously|force/.test(arg)), false);
});
