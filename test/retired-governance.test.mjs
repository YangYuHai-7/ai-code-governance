import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';
import { detectForeignExecutableGovernance } from '../src/modules/governance/checker.mjs';
import { memoryIssues } from '../src/modules/memory/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-' + name + '-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}

test('retired first-party process Skills warn instead of failing the check', (context) => {
  const root = fixture(context, 'retired-skills');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  // Simulate what an earlier template left behind on disk.
  for (const id of ['delivery-loop', 'delivery-assignment', 'project-flow', 'requirements', 'team-orchestrator']) {
    write(root, 'docs/ai/skills/' + id + '/SKILL.md', '# retired process skill' + String.fromCharCode(10));
    write(root, '.agents/skills/' + id + '/SKILL.md', '# retired adapter' + String.fromCharCode(10));
  }
  const result = checkProject(scanProject(root));
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /from an earlier template are no longer selected/.test(warning)), JSON.stringify(result.warnings));
});

test('a module-<hash> memory page written by an earlier template stays valid', (context) => {
  const root = fixture(context, 'legacy-memory');
  const source = 'export const value = 1' + String.fromCharCode(10);
  write(root, 'src/legacy/index.ts', source);
  const digest = sha256(Buffer.from(source, 'utf8'));
  const moduleId = 'module-1234567890abcdef';
  write(root, 'docs/memory/INDEX.json', JSON.stringify({
    schemaVersion: 1,
    modules: [{
      id: moduleId,
      path: 'src/legacy',
      memoryPage: 'docs/memory/modules/' + moduleId + '.md',
      owns: ['src/legacy/index.ts'],
      codeGlobs: ['src/legacy/index.ts'],
      status: 'stated',
      summary: { status: 'unverified', text: '', verifiedFrom: ['src/legacy/index.ts'] },
      pageIds: [], apiIds: [], methodIds: [], dataSourceIds: [], callSiteIds: [],
      verifiedFrom: ['src/legacy/index.ts'],
    }],
    pages: [], apis: [], methods: [], dataSources: [], callSites: [],
    sources: [{ id: 'source-1234567890abcdef', path: 'src/legacy/index.ts', sha256: digest, status: 'stated' }],
    tests: [],
    gaps: [],
  }, null, 2));
  write(root, 'docs/memory/modules/' + moduleId + '.md', [
    '# src/legacy', '', '## Purpose', '', 'legacy purpose', '',
    '## Invariants', '', 'legacy invariants', '',
    '## Structure', '', 'legacy structure', '',
    '## Evidence', '', 'legacy evidence', '',
    '## Gaps', '', 'legacy gap', '',
  ].join(String.fromCharCode(10)));
  const issues = memoryIssues(root, scanProject(root), []);
  assert.deepEqual(issues.filter((issue) => /unsafe module page|missing section/.test(issue)), [], JSON.stringify(issues));
});

test('AICG-generated leftovers are not foreign governance, but user-authored Skills are', (context) => {
  const root = fixture(context, 'foreign');
  write(root, '.agents/skills/delivery-loop/SKILL.md', '# adapter' + String.fromCharCode(10) + String.fromCharCode(10) + 'This file is a generated discovery adapter; edit the canonical Skill only.' + String.fromCharCode(10));
  write(root, '.agents/skills/my-own/SKILL.md', '# my own skill' + String.fromCharCode(10) + String.fromCharCode(10) + 'Do the thing.' + String.fromCharCode(10));
  const foreign = detectForeignExecutableGovernance(scanProject(root), null);
  assert.ok(!foreign.includes('.agents/skills/delivery-loop/SKILL.md'), JSON.stringify(foreign));
  assert.ok(foreign.includes('.agents/skills/my-own/SKILL.md'), JSON.stringify(foreign));
});

