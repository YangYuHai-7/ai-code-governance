import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';

test('apply removes empty leftover skill directories and preserves non-empty ones', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-empty-skill-dir-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { ...defaultConfig(scanProject(root)), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));

  const empty = path.join(root, 'docs/ai/skills/retired-process-none');
  fs.mkdirSync(empty, { recursive: true });
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  assert.equal(fs.existsSync(empty), false, 'an empty leftover skill directory is removed');

  const kept = path.join(root, 'docs/ai/skills/keep-me');
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, 'SKILL.md'), '# kept\n');
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  assert.equal(fs.existsSync(path.join(kept, 'SKILL.md')), true, 'non-empty directories are preserved');
});
