import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_URL = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT_URL);
const ENGLISH_URL = new URL('README.md', ROOT_URL);
const CHINESE_URL = new URL('docs/i18n/README.zh-CN.md', ROOT_URL);

function syncKeys(markdown) {
  return [...markdown.matchAll(/<!--\s*sync:([a-z0-9-]+)\s*-->/g)].map((match) => match[1]);
}

function shellBlocks(markdown) {
  return [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function sharedRelativeTargets(markdown, documentUrl) {
  const targets = [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter(Boolean)
    .filter((target) => !/^(?:https?:|mailto:)/.test(target))
    .map((target) => path.relative(ROOT_PATH, fileURLToPath(new URL(target, documentUrl))))
    .filter((target) => target !== 'README.md' && target !== 'docs/i18n/README.zh-CN.md');

  return [...new Set(targets)].sort();
}

test('repository root keeps only the default English README', async () => {
  const rootReadmes = (await readdir(ROOT_URL))
    .filter((name) => /^README(?:\.|$)/i.test(name))
    .sort();

  assert.deepEqual(rootReadmes, ['README.md']);
});

test('English and Chinese project homes keep commands, sections, and local references synchronized', async () => {
  const [english, chinese] = await Promise.all([
    readFile(ENGLISH_URL, 'utf8'),
    readFile(CHINESE_URL, 'utf8')
  ]);

  assert.match(english.slice(0, 1_500), /href="docs\/i18n\/README\.zh-CN\.md"/);
  assert.match(chinese.slice(0, 1_500), /href="\.\.\/\.\.\/README\.md"/);
  assert.deepEqual(syncKeys(chinese), syncKeys(english));
  assert.deepEqual(shellBlocks(chinese), shellBlocks(english));
  assert.deepEqual(
    sharedRelativeTargets(chinese, CHINESE_URL),
    sharedRelativeTargets(english, ENGLISH_URL)
  );
});
