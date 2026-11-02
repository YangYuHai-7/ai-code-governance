import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateRoleDisclosureReplay } from '../test-support/role-disclosure/replay.mjs';

const replayCommand = fileURLToPath(new URL('../scripts/role-disclosure-replay.mjs', import.meta.url));
const user = (content, expectedRoles) => ({ role: 'user', content, expectedRoles });
const assistant = (content, extras = {}) => ({ role: 'assistant', content, ...extras });

test('a multi-turn replay accepts first-response role reasons on short and recovery answers', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Status?', ['planner']),
    { role: 'tool', content: 'Internal output is not a conversation response.' },
    assistant('Active roles: planner (track delivery status). In progress.'),
    user('Can you publish it?', ['planner', 'reviewer']),
    assistant('当前角色：planner（跟踪范围）、reviewer（核对边界）。现在不能发布。'),
    user('The check failed. What now?', ['evaluator']),
    assistant('当前角色：evaluator（定位失败证据）。先保留失败结果。'),
  ]);

  assert.equal(result.status, 'pass');
  assert.equal(result.turns, 3);
  assert.deepEqual(result.findings, []);
});

test('replay catches a missing statement even when a later answer has one', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Quick answer?', ['planner']),
    assistant('Yes.'),
    assistant('Active roles: planner (clarify the requested outcome).'),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), ['missing-first-response-disclosure']);
});

test('replay catches a late statement in the first answer', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Status?', ['planner']),
    assistant('The work is done.\nActive roles: planner (track status).'),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), ['late-disclosure']);
});

test('replay catches stale or incomplete role assignments', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Define the pilot.', ['planner']),
    assistant('Active roles: planner (define scope).'),
    user('Inspect evidence.', ['evaluator']),
    assistant('Active roles: planner (define scope).'),
    user('Review the implementation.', ['engineer', 'reviewer']),
    assistant('Active roles: engineer (inspect implementation).'),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), [
    'role-mismatch',
    'role-mismatch',
  ]);
});

test('replay requires a visible statement before a material mid-turn role change', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Inspect the test result.', ['evaluator']),
    assistant('Active roles: evaluator (inspect test evidence). The test failed.'),
    assistant('I now recommend changing the boundary.', { expectedRoles: ['reviewer'] }),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), ['missing-role-change-disclosure']);
});

test('replay accepts a disclosed role change and does not count a human-review disclaimer as a claim', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Inspect the test result.', ['evaluator']),
    assistant('Active roles: evaluator (inspect test evidence). This is not independent human review.'),
    assistant('Active roles: reviewer (check the boundary). This is not approved by independent human review.', {
      expectedRoles: ['reviewer'],
    }),
  ]);

  assert.deepEqual(result.findings, []);
});

test('replay does not accept a listed role without its reason', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Check scope and evidence.', ['planner', 'evaluator']),
    assistant('Active roles: planner (check scope), evaluator. The scope is bounded.'),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), ['incomplete-role-reason']);
});

test('replay rejects a statement that claims human review or authority from a role label', () => {
  const result = evaluateRoleDisclosureReplay([
    user('Is this approved?', ['reviewer']),
    assistant('当前角色：reviewer（核对边界）。已由独立真人审核，可以发布。'),
  ]);

  assert.deepEqual(result.findings.map((finding) => finding.code), ['misleading-human-review-claim']);
});

test('replay refuses invalid or incomplete inputs instead of treating them as passing evidence', () => {
  assert.throws(() => evaluateRoleDisclosureReplay([user('Invalid role', ['invalid role'])]), /expectedRoles/);
  assert.throws(() => evaluateRoleDisclosureReplay([user('No response', ['planner'])]), /assistant response/);
  assert.throws(() => evaluateRoleDisclosureReplay([assistant('Active roles: planner (scope).')]), /user turn/);
});

test('local replay command returns only a summary and fails on a missing disclosure', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-role-replay-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transcriptPath = path.join(root, 'transcript.json');
  fs.writeFileSync(transcriptPath, JSON.stringify([
    user('Private request text', ['planner']),
    assistant('Private response without disclosure'),
  ]));

  const result = spawnSync(process.execPath, [replayCommand, transcriptPath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.findings.map((finding) => finding.code), ['missing-first-response-disclosure']);
  assert.doesNotMatch(result.stdout, /Private/);
  assert.doesNotMatch(result.stderr, /Private/);
});

test('local replay command fails closed on malformed private input', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-role-replay-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transcriptPath = path.join(root, 'transcript.json');
  fs.writeFileSync(transcriptPath, '{"private":"unfinished"');

  const result = spawnSync(process.execPath, [replayCommand, transcriptPath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'invalid');
  assert.doesNotMatch(result.stdout + result.stderr, /private|unfinished|aicg-role-replay-/i);
});
