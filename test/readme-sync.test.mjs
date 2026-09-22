import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_URL = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT_URL);
const ENGLISH_URL = new URL('README.md', ROOT_URL);
const CHINESE_URL = new URL('docs/zh-CN/README.md', ROOT_URL);

function syncKeys(markdown) {
  return [...markdown.matchAll(/<!--\s*sync:([a-z0-9-]+)\s*-->/g)].map((match) => match[1]);
}

function shellBlocks(markdown) {
  return [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function localTargets(markdown, documentUrl) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter(Boolean)
    .filter((target) => !/^(?:https?:|mailto:)/.test(target))
    .map((target) => path.relative(ROOT_PATH, fileURLToPath(new URL(target, documentUrl))));
}

test('public documentation names Copilot and distinguishes checked from runtime-verified', async () => {
  const readme = await readFile(ENGLISH_URL, 'utf8');
  assert.match(readme, /github-copilot/);
  assert.match(readme, /runtime-verified/);
  assert.match(readme, /governanceFootprint/);
  const chinese = await readFile(CHINESE_URL, 'utf8');
  assert.match(chinese, /github-copilot/);
  assert.match(chinese, /runtime-verified/);
  assert.match(chinese, /governanceFootprint/);
});

test('repository root keeps only the default English README', async () => {
  const rootReadmes = (await readdir(ROOT_URL))
    .filter((name) => /^README(?:\.|$)/i.test(name))
    .sort();

  assert.deepEqual(rootReadmes, ['README.md']);
});

test('human and internal documentation is centrally managed under docs', async () => {
  await Promise.all([
    access(new URL('docs/zh-CN/README.md', ROOT_URL)),
    access(new URL('docs/internal/assets.md', ROOT_URL)),
    access(new URL('docs/internal/reference/README.md', ROOT_URL)),
    access(new URL('docs/internal/validation/real-user-pilot-protocol.md', ROOT_URL)),
  ]);

  const rootEntries = await readdir(ROOT_URL);
  assert.equal(rootEntries.includes('references'), false);
  await assert.rejects(access(new URL('docs/i18n/', ROOT_URL)), { code: 'ENOENT' });
  await assert.rejects(access(new URL('assets/README.md', ROOT_URL)), { code: 'ENOENT' });
});

test('English and Chinese project homes keep commands and sections synchronized without cross-language documentation links', async () => {
  const [english, chinese] = await Promise.all([
    readFile(ENGLISH_URL, 'utf8'),
    readFile(CHINESE_URL, 'utf8')
  ]);

  assert.match(english.slice(0, 1_500), /href="docs\/zh-CN\/README\.md"/);
  assert.match(chinese.slice(0, 1_500), /href="\.\.\/\.\.\/README\.md"/);
  assert.deepEqual(syncKeys(chinese), syncKeys(english));
  assert.deepEqual(shellBlocks(chinese), shellBlocks(english));

  for (const target of localTargets(chinese, CHINESE_URL)) {
    if (target === 'README.md') continue;
    assert.doesNotMatch(target, /(?:^|\/)references\//);
    if (!target.endsWith('.md')) continue;
    const linkedDocument = await readFile(new URL(target, ROOT_URL), 'utf8');
    assert.match(linkedDocument, /[\u3400-\u9fff]/, `Chinese documentation link must resolve to Chinese content: ${target}`);
  }
});
