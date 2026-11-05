import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeRegExp, maskMarkupComments } from '../src/shared/index.mjs';
import { withoutComments } from '../src/modules/repository/dependency-syntax.mjs';
import { auditSkillQuality } from '../src/modules/standards/skill-quality.mjs';

test('markup analysis masks comments without joining tokens or changing line positions', () => {
  for (const source of ['<de<!-- ignored -->pendency>', '<!<!-- ignored -->--', 'a<!-- ignored --!>b', 'a<!-- unfinished\nb']) {
    const masked = maskMarkupComments(source);
    assert.equal(masked.length, source.length);
    assert.deepEqual(masked.match(/\r?\n/g), source.match(/\r?\n/g));
    assert.equal(masked.includes('<!--'), false);
    assert.equal(masked.includes('<dependency>'), false);
    assert.equal(withoutComments(source, { xml: true }), masked);
  }
  assert.equal(maskMarkupComments('visible<!-- hidden --!>visible'), `visible${' '.repeat(16)}visible`);
});

test('Skill prose analysis handles alternate comment endings and unfinished comments', () => {
  const issues = (source) => auditSkillQuality(source).issues.filter((issue) => issue.startsWith('line-number references'));
  assert.equal(issues('<!-- hidden --!> src/sample.mjs:42').length, 1);
  assert.equal(issues('<!-- unfinished src/sample.mjs:42').length, 0);
});

test('regular expression literals preserve every metacharacter including backslashes', () => {
  const literal = 'docs/.agent+()[x]{2}^$|?*/\\SKILL.md';
  const pattern = new RegExp(`^${escapeRegExp(literal)}$`);
  assert.ok(pattern.test(literal));
  assert.equal(pattern.test(literal.replace('.agent', 'Xagent')), false);
});
