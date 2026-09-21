import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';
import { writeGateReport } from '../src/adapters/filesystem/index.mjs';

test('brownfield check reports semantic gaps after structurally valid initialization', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-brownfield-progress-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"sample"}\n');
  fs.writeFileSync(path.join(root, 'src', 'service.mjs'), 'export function currentPrice() { return 1; }\n');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard', initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, true);
  assert.equal(result.brownfield.status, 'needs-enrichment');
  assert.ok(result.brownfield.gaps.some((gap) => /business memory has no owned modules/.test(gap)));
  assert.ok(result.brownfield.gaps.some((gap) => /development workflow/.test(gap)));
  assert.ok(result.brownfield.gaps.some((gap) => /project Skill/.test(gap)));
  writeGateReport(root, 'check', result);
  assert.equal(checkProject(scanProject(root)).brownfield.unownedSourceFiles, result.brownfield.unownedSourceFiles);
});

test('a brownfield repository with a build manifest receives development documents', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-family-development-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"orchestrator"}\n');
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard', projectMode: 'repository-family',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
  };
  const paths = buildArtifacts(config, scan).map((entry) => entry.path);
  assert.ok(paths.includes('docs/ai/development/index.json'));
  assert.ok(paths.includes('docs/ai/development/root.md'));
});

test('a code-less orchestrator generates no development documents and reports them not applicable', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-codeless-orchestrator-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // An orchestrator parent: submodule pointers, specs and prototypes, but no code and
  // no build manifest of its own.
  fs.mkdirSync(path.join(root, 'openspec', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, '<sample-repo>'));
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "<sample-repo>"]\n\tpath = <sample-repo>\n\turl = git@example.invalid:<sample-repo>.git\n');
  fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(root, 'openspec', 'specs', 'sample.md'), '# Sample\n');
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete', projectMode: 'repository-family',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
    adaptiveDecisions: { schemaVersion: 1, skills: [{ id: 'project-standard', action: 'add', evidenceHash: 'a'.repeat(64) }], roles: [] },
  };
  const paths = buildArtifacts(config, scan).map((entry) => entry.path);
  assert.equal(paths.some((entry) => entry.startsWith('docs/ai/development/')), false);
  assert.equal(paths.includes('README.md'), false);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.brownfield.documentable, false);
  assert.equal(result.brownfield.status, 'not-applicable-no-code');
  assert.deepEqual(result.brownfield.notApplicable.contracts, ['development-documentation', 'business-memory-ownership']);
  // Development and Memory contracts must not surface as gaps for a code-less repository.
  assert.deepEqual(result.brownfield.gaps, []);
  // The not-applicable decision must stay visible rather than silently pass.
  assert.match(result.brownfield.notApplicable.reason, /neither code nor a build manifest/);
});
