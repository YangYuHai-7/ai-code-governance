import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import '../src/generator.mjs';
import { matchSimpleGlob } from '../src/shared/paths.mjs';
import { isFirstPartyGeneratedSkill } from '../src/modules/governance/retired.mjs';
import { scanProject } from '../src/scanner.mjs';

test('ordinary source paths do not reread client registries to reject generated-skill ownership', (context) => {
  const read = fs.readFileSync;
  let registryReads = 0;
  context.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (String(file).endsWith('agent-registry.json')) registryReads += 1;
    return read.call(this, file, ...args);
  });
  for (let i = 0; i < 50; i += 1) assert.equal(isFirstPartyGeneratedSkill(`src/group/module-${i}.mjs`), false);
  assert.equal(registryReads, 0, 'non-Skill source paths cannot require registry IO');
  assert.equal(isFirstPartyGeneratedSkill('docs/ai/skills/project-flow/SKILL.md'), true);
  assert.equal(isFirstPartyGeneratedSkill('.agents/skills/project-flow/SKILL.md'), true);
  assert.equal(isFirstPartyGeneratedSkill('.agents/skills/custom/SKILL.md'), false);
});

test('repeated glob matching reuses compilation without reusing a previous file result', (context) => {
  const Original = globalThis.RegExp;
  let compilations = 0;
  context.mock.method(globalThis, 'RegExp', new Proxy(Original, {
    construct(target, args) {
      compilations += 1;
      return Reflect.construct(target, args);
    },
  }));
  assert.equal(matchSimpleGlob('src/alpha/sample.ts', '**/sample.ts'), true);
  assert.equal(matchSimpleGlob('src/alpha/other.ts', '**/sample.ts'), false);
  assert.equal(matchSimpleGlob('src/beta/sample.ts', '**/sample.ts'), true);
  assert.equal(compilations, 1, 'compile a repeated immutable pattern once, not per candidate');
});

test('glob matches retain literal punctuation, nested paths and single-star boundaries', () => {
  for (const [file, pattern, expected] of [
    ['./src/sample.ts', 'src/*.ts', true],
    ['src/deep/sample.ts', 'src/*.ts', false],
    ['nested/package.json', 'package.json', true],
    ['packageXjson', 'package.json', false],
    ['src/a+b.ts', 'a+b.ts', true],
    ['src/ab.ts', 'a+b.ts', false],
    ['src\\deep\\sample.ts', './src/**', true],
  ]) assert.equal(matchSimpleGlob(file, pattern), expected, `${file} against ${pattern}`);
});

test('caller-controlled distinct patterns are evicted without changing later match results', (context) => {
  const Original = globalThis.RegExp;
  let compilations = 0;
  context.mock.method(globalThis, 'RegExp', new Proxy(Original, {
    construct(target, args) { compilations += 1; return Reflect.construct(target, args); },
  }));
  assert.equal(matchSimpleGlob('fresh/sample.txt', 'fresh/*.txt'), true);
  for (let i = 0; i < 2048; i += 1) assert.equal(matchSimpleGlob(`other/file-${i}`, `file-${i}`), true);
  const before = compilations;
  assert.equal(matchSimpleGlob('fresh/changed.txt', 'fresh/*.txt'), true);
  assert.equal(matchSimpleGlob('fresh/changed.json', 'fresh/*.txt'), false);
  assert.equal(compilations, before + 1, 'a bounded pattern cache must release old entries');
});

test('repeated scans reread changed manifest content despite cached path patterns', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-pattern-freshness-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = path.join(root, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ dependencies: { react: '19.0.0' } }));
  assert.deepEqual(scanProject(root).stacks.map((pack) => pack.id), ['frontend-react']);
  fs.writeFileSync(manifest, JSON.stringify({ dependencies: { express: '5.0.0' } }));
  assert.deepEqual(scanProject(root).stacks.map((pack) => pack.id), ['backend-node']);
});

test('oversized caller patterns keep matching but are not retained by the cache', (context) => {
  const Original = globalThis.RegExp;
  let compilations = 0;
  context.mock.method(globalThis, 'RegExp', new Proxy(Original, {
    construct(target, args) { compilations += 1; return Reflect.construct(target, args); },
  }));
  const pattern = 'x'.repeat(8192);
  assert.equal(matchSimpleGlob(pattern, pattern), true);
  assert.equal(matchSimpleGlob(`nested/${pattern}`, pattern), true);
  assert.equal(compilations, 2, 'large pattern strings must not be retained');
});
