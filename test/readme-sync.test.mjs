import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT_URL = new URL('../', import.meta.url);

function syncKeys(markdown) {
  return [...markdown.matchAll(/<!--\s*sync:([a-z0-9-]+)\s*-->/g)].map((match) => match[1]);
}

function shellBlocks(markdown) {
  return [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function sharedRelativeTargets(markdown) {
  const targets = [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter(Boolean)
    .filter((target) => !/^(?:https?:|mailto:)/.test(target))
    .filter((target) => target !== 'README.md' && target !== 'README.zh-CN.md');

  return [...new Set(targets)].sort();
}

test('English and Chinese project homes keep commands, sections, and local references synchronized', async () => {
  const [english, chinese] = await Promise.all([
    readFile(new URL('README.md', ROOT_URL), 'utf8'),
    readFile(new URL('README.zh-CN.md', ROOT_URL), 'utf8')
  ]);

  assert.match(english.slice(0, 1_500), /href="README\.zh-CN\.md"/);
  assert.match(chinese.slice(0, 1_500), /href="README\.md"/);
  assert.deepEqual(syncKeys(chinese), syncKeys(english));
  assert.deepEqual(shellBlocks(chinese), shellBlocks(english));
  assert.deepEqual(sharedRelativeTargets(chinese), sharedRelativeTargets(english));
});
