import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { COMMAND_HANDLERS } from '../src/cli/command-registry.mjs';
import { candidateCommand } from '../src/cli/commands/candidate.mjs';

test('the candidate review command is registered, read-only, and action-checked', async () => {
  assert.ok(COMMAND_HANDLERS.candidate, 'candidate command is registered');
  assert.deepEqual(COMMAND_HANDLERS.candidate.argumentKeys, ['target', 'action', 'options']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-candidate-command-'));
  try {
    const review = await candidateCommand(root, 'review', { json: true });
    assert.equal(review.status, 'empty');
    assert.deepEqual([...review.pendingApprovals], []);
    assert.equal(fs.existsSync(path.join(root, '.ai-governance/state/candidate-rules.json')), false, 'reviewing never writes candidate state');
    await assert.rejects(() => candidateCommand(root, 'approve', {}), /action/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
