import assert from 'node:assert/strict';
import test from 'node:test';
import { contentViolations, escapeRegExp, pathViolation } from '../scripts/public-surface-check.mjs';

test('working notes outside local/ are rejected', () => {
  assert.ok(pathViolation('docs/优化方案-2026-09-20-demo.md'));
  assert.ok(pathViolation('docs/评测-2026-09-20-demo.md'));
  assert.ok(pathViolation('docs/整改-2026-09-10-demo.md'));
  assert.ok(pathViolation('docs/团队最终报告.md'));
  assert.ok(pathViolation('docs/pilots/U01.md'));
  assert.ok(pathViolation('docs/superpowers/plans/demo.md'));
  assert.ok(pathViolation('reports/aicg/latest-check.json'));
  assert.equal(pathViolation('local/优化方案-demo.md'), null);
  assert.equal(pathViolation('docs/internal/reference/principles.md'), null);
});

test('absolute home paths are rejected while placeholder homes stay allowed', () => {
  assert.equal(contentViolations('src/demo.mjs', "const home = '/Users/realperson/work';").length, 1);
  assert.equal(contentViolations('src/demo.mjs', "const home = 'C:/Users/realperson/work';").length, 1);
  assert.equal(contentViolations('src/demo.mjs', "const home = '/Users/owner/work';").length, 0);
  assert.equal(contentViolations('src/demo.mjs', "const home = 'C:/Users/owner/work';").length, 0);
});

test('private email domains are rejected while example domains stay allowed', () => {
  assert.equal(contentViolations('src/demo.mjs', 'mail: someone@gmail.com').length, 1);
  assert.equal(contentViolations('src/demo.mjs', 'mail: aicg@example.test').length, 0);
});

test('deny tokens match case-insensitively and the policy files are skipped', () => {
  assert.equal(contentViolations('docs/note.md', 'uses SecretCode here', ['secretcode']).length, 1);
  assert.equal(contentViolations('scripts/public-surface-check.mjs', '/Users/realperson', ['secretcode']).length, 0);
  assert.equal(contentViolations('test/public-surface-guard.test.mjs', '/Users/realperson', ['secretcode']).length, 0);
});

test('escapeRegExp escapes regular-expression metacharacters', () => {
  assert.equal(escapeRegExp('a.b'), 'a\\.b');
});
