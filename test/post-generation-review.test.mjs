import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reviewGeneratedGovernance } from '../src/modules/governance/post-generation-review.mjs';

test('post-generation review writes score and remediation without claiming acceptance for an unverified Agent', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-post-review-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of ['docs/ai/development/index.json', '.ai-governance/state/task-routing-policy.json', '.ai-governance/state/verification-profiles.yaml', 'reports/aicg/latest-check.json']) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, '{}\n');
  }
  const reportPath = 'reports/aicg/latest-independent-review.json';
  const result = reviewGeneratedGovernance(root, { lifecycle: 'existing', selectedAgents: [], check: { ok: true, brownfield: { gaps: ['missing business evidence'] } },
    runReview: (_root, options) => {
      assert.deepEqual(options.selectedAgents, []);
      assert.ok(options.roles.includes('business-analysis-reviewer'));
      fs.writeFileSync(path.join(root, reportPath), '{}\n');
      return { status: 'pending-unverified', reportPath, reason: 'No selected Agent.' };
    } });
  assert.equal(result.independentReview.status, 'pending-unverified');
  assert.equal(result.score.status, 'needs-remediation');
  assert.ok(result.score.remediation.some((item) => item.criterion === 'independent-review'));
  assert.ok(result.score.remediation.some((item) => item.criterion === 'development-docs'));
  assert.ok(fs.existsSync(path.join(root, result.reportPath)));
});
