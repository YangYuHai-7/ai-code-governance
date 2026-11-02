import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { deriveArchitectureDecision, architecturePlacementIssues, evaluateModuleGraph, moduleGraphDeclaration, validateModuleGraphDeclaration } from '../src/modules/architecture/index.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-layout-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => { const p = path.join(root, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  return { root, write };
}
function config(root) {
  const c = { stacks: ['frontend-vue', 'backend-java'], governanceDepth: 'standard', initialization: { lifecycle: 'greenfield', source: 'config' } };
  c.architecture = deriveArchitectureDecision(scanProject(root), c);
  return c;
}
test('generated frontend and Java roots agree with placement and keep misplaced files visible', t => {
  const { root, write } = fixture(t);
  const c = config(root);
  assert.deepEqual(c.architecture.scope.roots, ['apps/web/src', 'apps/server/src/main/java']);
  write('apps/web/src/main.ts', 'export {};');
  write('apps/web/src/modules/search/index.ts', 'export const search = true;');
  write('apps/server/src/main/java/com/example/sample/Application.java', 'package com.example.sample; class Application {}');
  write('apps/server/src/main/java/com/example/sample/modules/search/SearchService.java', 'package com.example.sample.modules.search; class SearchService {}');
  write('apps/web/dist/assets/bundle.js', 'export {};');
  assert.deepEqual(architecturePlacementIssues(scanProject(root), c), []);
  write('apps/web/src/misc.ts', 'export {};');
  assert.match(architecturePlacementIssues(scanProject(root), c).join('\n'), /misc.ts/);
});
test('nested graph checks reverse dependencies and reports unsupported Java and Vue instead of full pass', t => {
  const { root, write } = fixture(t);
  const c = config(root);
  write('apps/web/src/modules/search/index.ts', 'export const search = true;');
  write('apps/web/src/shared/http.ts', "import { search } from '../modules/search/index.ts';");
  write('apps/web/src/modules/search/Search.vue', '<template>Search</template>');
  write('apps/server/src/main/java/com/example/sample/modules/search/SearchService.java', 'class SearchService {}');
  const graph = evaluateModuleGraph(scanProject(root), moduleGraphDeclaration(c));
  assert.equal(graph.status, 'failed');
  assert.equal(graph.inspectedFiles.length, 2);
  assert.equal(graph.unsupportedFiles.length, 2);
  assert.match(graph.issues[0].rule, /dependency-direction/);
});
test('empty graph and unsupported-only sources never claim passed', t => {
  const { root, write } = fixture(t);
  const c = config(root);
  const graph = moduleGraphDeclaration(c);
  assert.equal(evaluateModuleGraph(scanProject(root), graph).status, 'uncovered');
  write('apps/web/src/modules/search/Search.vue', '<template>Search</template>');
  assert.equal(evaluateModuleGraph(scanProject(root), graph).status, 'stated-only');
});
test('cross application relative imports cannot masquerade as same module ownership', t => {
  const { root, write } = fixture(t);
  const c = {architecture: { status: 'active', scope: { roots: ['apps/one/src', 'apps/two/src'] }, verification: { dependencyDirection: 'aicg-check-js-ts-module-graph' } }};
  write('apps/one/src/modules/search/index.ts', "import { secret } from '../../../../two/src/modules/search/private.ts';");
  write('apps/two/src/modules/search/private.ts', 'export const secret = true;');
  const graph = evaluateModuleGraph(scanProject(root), moduleGraphDeclaration(c));
  assert.equal(graph.status, 'failed');
  assert.match(graph.issues[0].rule, /cross-unit/);
});
test('an existing generated index keeps source locations while refreshing an obsolete root policy', t => {
  const { root, write } = fixture(t);
  const c = config(root);
  c.architecture.scope.roots = ['src'];
  write('docs/ai/development/index.json', JSON.stringify({ units: [{ stack: 'frontend-vue', path: 'apps/frontend-vue' }, { stack: 'backend-java', path: 'services/backend-java' }] }));
  const updated = deriveArchitectureDecision(scanProject(root), c, c.architecture);
  assert.deepEqual(updated.scope.roots, ['apps/frontend-vue/src', 'services/backend-java/src/main/java']);
  write('apps/frontend-vue/src/modules/search/index.ts', 'export {};');
  write('services/backend-java/src/main/java/modules/search/SearchService.java', 'class SearchService {}');
  assert.deepEqual(architecturePlacementIssues(scanProject(root), {...c, architecture: updated}), []);
});

test('source directories named build stay governed and noncanonical roots are rejected', t => {
  const {root, write} = fixture(t);
  const c = config(root);
  write('apps/web/src/app/main.ts', 'export const app = true;');
  write('apps/web/src/modules/build/index.ts', "import { app } from '../../app/main.ts';");
  write('apps/web/src/build/misplaced.ts', 'export {};');
  assert.match(architecturePlacementIssues(scanProject(root), c).join('\n'), /misplaced.ts/);
  const declaration = moduleGraphDeclaration(c);
  assert.equal(evaluateModuleGraph(scanProject(root), declaration).status, 'failed');
  declaration.scope.roots = ['./src', 'src/modules'];
  assert.throws(() => validateModuleGraphDeclaration(declaration), /source roots/);
});
