import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateGoldenPathArchitecture } from '../src/modules/architecture/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { scanProject } from '../src/scanner.mjs';

const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/golden-path/architecture');

function evaluate(name, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-golden-path-${name}-`));
  for (const [relative, content] of Object.entries(entries)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return {
    root,
    result: evaluateGoldenPathArchitecture(scanProject(root), pack),
  };
}

function validEntries() {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'valid/case.json'), 'utf8'));
}

function expectOnlyIssue(name, entries, code) {
  const { root, result } = evaluate(name, entries);
  try {
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.issues.map((issue) => issue.code), [code]);
    assert.deepEqual(result.unsupportedFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the golden path architecture permits Pack composition roots and public module entrypoints', () => {
  const { root, result } = evaluate('valid', validEntries());
  try {
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.unsupportedFiles, []);
    assert.ok(result.inspectedFiles.includes('apps/api/src/domain/index.ts'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the golden path architecture reports each required negative probe with one stable issue code', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'violations/cases.json'), 'utf8'));
  for (const fixture of cases) expectOnlyIssue(fixture.name, { ...validEntries(), ...fixture.entries }, fixture.code);
});
