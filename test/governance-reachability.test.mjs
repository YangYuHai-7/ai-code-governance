import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { checkProject } from '../src/checker.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-reachability-' + name + '-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a routed rule is reachable; removing its route turns it into an explicit finding', (context) => {
  const root = fixture(context, 'route');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard', domainConstraints: ['Owner-authored invariant.'] };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));

  const contextPath = path.join(root, 'docs/ai/context-map.yaml');
  const routed = fs.readFileSync(contextPath, 'utf8');
  assert.match(routed, /docs\/ai\/rules\/30_business\.mdc/);
  const before = checkProject(scanProject(root));
  assert.ok(!before.warnings.some((warning) => warning.includes('unreachable governance')), before.warnings.join('\n'));

  // Negative probe: drop the business conditional so the generated rule has no route, no client
  // projection and no routed reference. The reverse check must name it instead of passing silently.
  const unrouted = routed.replace(/^ {6}business:\n(?: {8}-[^\n]*\n)+/m, '');
  assert.notEqual(unrouted, routed, 'the business route must exist to remove');
  fs.writeFileSync(contextPath, unrouted);
  const after = checkProject(scanProject(root));
  assert.ok(after.warnings.some((warning) => warning.includes('unreachable governance') && warning.includes('30_business.mdc')), after.warnings.join('\n'));
});
