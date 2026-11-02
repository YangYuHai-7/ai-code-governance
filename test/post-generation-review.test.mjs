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

function testingFixture(context, profile, checkReport) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-testing-score-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    '.ai-governance/state/verification-profiles.yaml': profile,
    'reports/aicg/latest-check.json': JSON.stringify(checkReport),
    'reports/aicg/latest-independent-review.json': '{}',
  };
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return reviewGeneratedGovernance(root, {
    lifecycle: 'greenfield', config: { governanceFootprint: 'compact' },
    check: { ok: true }, selectedAgents: [],
    runReview: () => ({ status: 'pending-unverified', reportPath: 'reports/aicg/latest-independent-review.json' }),
  });
}

test('generated placeholders and a passing governance check do not earn product testing points', (context) => {
  const result = testingFixture(context, 'version: 1\nprofiles:\n  project:\n    commands:\n      - "# runtime discovery required"\n', {
    schemaVersion: 1, command: 'check', passed: true, result: { ok: true },
  });
  assert.equal(result.score.dimensions.testing.score, 0);
  for (const id of ['test-plan', 'test-result-report']) {
    const criterion = result.score.criteria.find((item) => item.id === id);
    assert.equal(criterion.status, 'unverified');
    assert.equal(criterion.evidence.length, 1, 'retain structural evidence without promoting its meaning');
    assert.match(criterion.reason, /product|execution/i);
  }
});

test('declared commands and a failed governance report cannot prove product execution', (context) => {
  const result = testingFixture(context, 'version: 1\nprofiles:\n  project:\n    commands:\n      - npm test\n', {
    schemaVersion: 1, command: 'check', passed: false, result: { ok: false },
  });
  assert.equal(result.score.dimensions.testing.score, 0);
  assert.equal(result.score.criteria.find((item) => item.id === 'test-result-report').status, 'unverified');
});
