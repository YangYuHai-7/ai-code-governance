import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';

// Commands whose capability left the command surface entirely: they print a deprecation
// notice and have no supported replacement, so generated governance must never route an
// agent to them. Commands that still have a working alias (complete, release-check,
// work-unit, test-case, hook, evidence) are intentionally excluded until the generated
// prose migrates to the `aicg delivery ...` namespace.
const CAPABILITY_ONLY_RETIRED = /\baicg\s+(?:assess|architecture|standards|team|harvest|promote|request)\b/;

function fixture(context, name, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-retired-output-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

test('generated artifacts never route to a capability-only retired command', (context) => {
  const root = fixture(context, 'greenfield');
  for (const governanceDepth of ['minimal', 'standard', 'complete']) {
    for (const artifactLanguage of ['en', 'zh-CN']) {
      const scan = scanProject(root);
      const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth, artifactLanguage }, scan);
      for (const artifact of artifacts) {
        const match = artifact.content.match(CAPABILITY_ONLY_RETIRED);
        assert.equal(match, null, `${artifact.path} (${artifactLanguage}/${governanceDepth}) routes to retired command ${match?.[0]}`);
      }
    }
  }
});

test('generated package.json remains the source of the published script surface', (context) => {
  // A repository whose package.json is absent still generates a context map; the enforce
  // route must be present regardless of stack so the workflow can fail a gate.
  const root = fixture(context, 'enforce');
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' }, scan);
  const contextMap = artifacts.find((artifact) => artifact.path === 'docs/ai/context-map.yaml');
  assert.match(contextMap.content, /verify:\n\s+-\s+aicg check \. --enforce/);
});
