import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { memoryFixture, write, baseline } from './helpers/memory-fixture.mjs';
import { scanProjectMemoryFacts, memoryIssues, buildMemoryArtifacts } from '../src/modules/memory/index.mjs';

function initialize(root, lifecycle = 'existing') {
  const scan = scanProject(root, { probeEnvironment: false });
  const config = { ...defaultConfig(scan), initialization: { lifecycle, existingCodeStrategy: lifecycle === 'existing' ? 'keep-existing' : null, source: 'config' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  return { scan, config, index: JSON.parse(fs.readFileSync(path.join(root, 'docs/memory/INDEX.json'))) };
}

test('brownfield memory joins page, API and call sites in both directions with evidence', (t) => {
  const root = memoryFixture(t);
  const before = fs.readFileSync(path.join(root, 'src/server/service.mjs'), 'utf8');
  const { index } = initialize(root);
  const api = index.apis.find((entry) => entry.method === 'GET' && entry.path === '/api/widgets');
  const page = index.pages.find((entry) => entry.path === 'src/pages/Widgets.mjs');
  assert.ok(api && page);
  assert.ok(page.apiIds.includes(api.id));
  assert.ok(api.pageIds.includes(page.id));
  assert.ok(api.moduleIds.includes(page.moduleId));
  assert.ok(index.modules.find((entry) => entry.id === page.moduleId).apiIds.includes(api.id));
  const call = index.callSites.find((entry) => entry.path === 'src/api/widgets.mjs' && entry.apiIds.includes(api.id) && api.callSiteIds.includes(entry.id));
  assert.ok(call);
  assert.ok(page.callSiteIds.includes(call.id) && call.pageIds.includes(page.id));
  assert.ok(index.methods.some((entry) => entry.symbol === 'listWidgets' && entry.path === 'src/server/service.mjs'));
  assert.ok(index.dataSources.some((entry) => entry.path === 'src/data/widget.schema.json'));
  assert.ok(index.tests.includes('test/widgets.test.mjs'));
  assert.ok(index.modules.every((entry) => entry.status === 'stated' && entry.summary.status === 'unverified'));
  assert.deepEqual(memoryIssues(root, scanProject(root)), []);
  assert.equal(fs.readFileSync(path.join(root, 'src/server/service.mjs'), 'utf8'), before);
});

test('greenfield foundation contains no business facts even with scaffold source', (t) => {
  const root = memoryFixture(t);
  const { index } = initialize(root, 'greenfield');
  for (const key of ['modules', 'pages', 'apis', 'methods', 'callSites', 'dataSources', 'sources']) assert.deepEqual(index[key], []);
  for (const relative of ['README.md', 'SCHEMA.md', 'INDEX.json']) assert.ok(fs.existsSync(path.join(root, 'docs/memory', relative)));
});

test('behavior freshness requires owning page AND index and current evidence, not unrelated memory edits', (t) => {
  const root = memoryFixture(t);
  const { index, config } = initialize(root);
  baseline(root);
  const code = 'src/server/service.mjs';
  const owner = index.modules.find((entry) => entry.owns.includes(code));
  write(root, code, 'export function listWidgets() { return [1]; }\n');
  assert.ok(memoryIssues(root, scanProject(root), [code]).some((issue) => /stale/.test(issue)));
  assert.ok(memoryIssues(root, scanProject(root), [code, owner.memoryPage, 'docs/memory/INDEX.json']).some((issue) => /stale/.test(issue)));
  const fresh = scanProjectMemoryFacts(scanProject(root));
  for (const artifact of buildMemoryArtifacts(config, scanProject(root), fresh).artifacts) write(root, artifact.path, artifact.content);
  assert.deepEqual(memoryIssues(root, scanProject(root), [code, owner.memoryPage, 'docs/memory/INDEX.json']), []);
});

test('formatting and test-only changes do not require memory churn', (t) => {
  const root = memoryFixture(t);
  initialize(root); baseline(root);
  write(root, 'src/server/service.mjs', 'export function listWidgets( ) {\n  return [];\n}\n');
  write(root, 'test/widgets.test.mjs', '// expanded test\n');
  assert.deepEqual(memoryIssues(root, scanProject(root), ['src/server/service.mjs', 'test/widgets.test.mjs']), []);
});

test('memory rejects broken reciprocal links, missing evidence, unsafe owners and symlinks', (t) => {
  const root = memoryFixture(t);
  const { index } = initialize(root);
  index.apis[0].pageIds = [];
  index.modules[0].owns.push('../outside');
  index.methods[0].verifiedFrom = ['missing.mjs'];
  write(root, 'docs/memory/INDEX.json', JSON.stringify(index));
  const issues = memoryIssues(root, scanProject(root));
  assert.ok(issues.some((issue) => /reciprocal/.test(issue)));
  assert.ok(issues.some((issue) => /unsafe/.test(issue)));
  assert.ok(issues.some((issue) => /evidence/.test(issue)));
  fs.unlinkSync(path.join(root, 'docs/memory/INDEX.json'));
  fs.symlinkSync(path.join(root, 'package.json'), path.join(root, 'docs/memory/INDEX.json'));
  assert.ok(memoryIssues(root, scanProject(root)).some((issue) => /link/i.test(issue)));
});

test('unsupported and ambiguous syntax stays a gap; comments and strings cannot create routes', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/server/unsupported.py', '@app.get("/not-supported")\ndef endpoint(): pass\n');
  write(root, 'src/server/noise.mjs', '// router.get("/fake", handler)\nconst text = "router.get(\'/fake2\', handler)";\nrouter.get(dynamicPath, handler);\n');
  write(root, 'src/api/broken.mjs', "function broken() { fetch('/unclosed');\n");
  const facts = scanProjectMemoryFacts(scanProject(root));
  assert.equal(facts.apis.some((entry) => entry.path.startsWith('/fake')), false);
  assert.equal(facts.callSites.some((entry) => entry.path === 'src/api/broken.mjs'), false);
  assert.ok(facts.gaps.some((entry) => entry.path === 'src/server/unsupported.py'));
  assert.ok(facts.gaps.some((entry) => entry.path === 'src/server/noise.mjs'));
});

test('new behavior and removing ownership cannot bypass memory freshness', (t) => {
  const root = memoryFixture(t);
  const { index } = initialize(root); baseline(root);
  write(root, 'src/server/new.mjs', 'export function createWidget() { return 1; }\n');
  assert.ok(memoryIssues(root, scanProject(root), ['src/server/new.mjs']).some((issue) => /unowned/.test(issue)));
  const code = 'src/server/service.mjs';
  const module = index.modules.find((entry) => entry.owns.includes(code));
  module.owns = module.owns.filter((entry) => entry !== code);
  module.codeGlobs = [...module.owns];
  write(root, code, 'export function listWidgets() { return [1]; }\n');
  write(root, 'docs/memory/INDEX.json', JSON.stringify(index));
  assert.ok(memoryIssues(root, scanProject(root), [code, 'docs/memory/INDEX.json']).some((issue) => /unowned|removed owner/.test(issue)));
});

test('shadowed or rebound HTTP names and dynamic method overrides cannot invent facts', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/api/shadow.mjs', "export function local(fetch) { return fetch('/local'); }\n");
  write(root, 'src/api/override.mjs', "export function ambiguous(options) { return fetch('/api/widgets', { method: 'GET', ...options }); }\n");
  write(root, 'src/server/shadow.mjs', "import { Router } from 'express';\nconst router = Router();\nfunction local(router) { router.get('/local', handler); }\n");
  const facts = scanProjectMemoryFacts(scanProject(root));
  assert.equal(facts.callSites.some((entry) => entry.path.includes('shadow') || entry.path.includes('override')), false);
  assert.equal(facts.apis.some((entry) => entry.path === '/local'), false);
  assert.ok(facts.gaps.some((entry) => entry.path === 'src/api/shadow.mjs'));
});

test('invented method/path evidence and module links fail validation', (t) => {
  const root = memoryFixture(t);
  const { index } = initialize(root);
  index.apis[0].path = '/invented';
  index.modules.find((entry) => entry.id === index.pages[0].moduleId).apiIds = [];
  write(root, 'docs/memory/INDEX.json', JSON.stringify(index));
  const issues = memoryIssues(root, scanProject(root));
  assert.ok(issues.some((issue) => /API evidence/.test(issue)));
  assert.ok(issues.some((issue) => /reciprocal/.test(issue)));
});

test('exported service class records implemented public methods without private internals', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/server/WidgetService.ts', 'export class WidgetService { public list(): string[] { return []; } private secret() { return 1; } protected hidden() { return 2; } }\n');
  const facts = scanProjectMemoryFacts(scanProject(root));
  assert.ok(facts.methods.some((entry) => entry.symbol === 'WidgetService.list'));
  assert.equal(facts.methods.some((entry) => /WidgetService\.(secret|hidden)/.test(entry.symbol)), false);
});

test('review: fetch method comes only from one complete top-level literal property', (t) => {
  const root = memoryFixture(t);
  write(root, 'src/api/options.mjs', `
export function calls(suffix) {
  fetch('/nested', { headers: { method: 'POST' } });
  fetch('/top-level', { headers: { method: 'POST' }, method: 'PUT' });
  fetch('/composed', { method: 'GET' + suffix });
  fetch('/duplicate', { method: 'GET', method: 'POST' });
  fetch('/computed', { ['method']: 'POST' });
  fetch('/object-expression', { method: 'GET' } || { method: 'POST' });
  fetch('/trailing-comma', { method: 'PATCH', headers: { method: 'POST' }, });
}
`);
  const facts = scanProjectMemoryFacts(scanProject(root));
  const calls = facts.callSites.filter((entry) => entry.path === 'src/api/options.mjs');
  assert.deepEqual(calls.map(({ apiPath, method }) => [apiPath, method]), [
    ['/nested', 'GET'], ['/top-level', 'PUT'], ['/trailing-comma', 'PATCH'],
  ]);
  assert.ok(facts.gaps.some((entry) => entry.path === 'src/api/options.mjs' && /method|options/.test(entry.reason)));
});

test('review: accessors, member scope and export aliases have stable distinct method identities', (t) => {
  const root = memoryFixture(t);
  const relative = 'src/server/AliasedService.mjs';
  const source = `class Service {
  get value() { return 1; }
  set value(next) { this.current = next; }
  create() { return 1; }
  static create() { return 2; }
}
export { Service, Service as ServiceAlias };
`;
  write(root, relative, source);
  const { index } = initialize(root);
  const methods = index.methods.filter((entry) => entry.path === relative);
  assert.equal(methods.length, 10);
  assert.equal(new Set(methods.map((entry) => entry.id)).size, methods.length);
  assert.deepEqual(memoryIssues(root, scanProject(root)), []);
  const members = methods.filter((entry) => entry.kind === 'public-method');
  assert.equal(members.filter((entry) => entry.memberKind === 'get').length, 2);
  assert.equal(members.filter((entry) => entry.memberKind === 'set').length, 2);
  assert.equal(members.filter((entry) => entry.scope === 'static').length, 2);
  write(root, relative, source.replaceAll('  ', '    '));
  assert.deepEqual(scanProjectMemoryFacts(scanProject(root)).methods.filter((entry) => entry.path === relative).map((entry) => entry.id), methods.map((entry) => entry.id));
});

test('review: Python terminal blank lines are exempt but significant indentation is not', (t) => {
  const root = memoryFixture(t);
  const relative = 'src/server/handler.py';
  const source = 'def choose(flag):\n    if flag:\n        value = 1\n        return value\n';
  write(root, relative, source);
  initialize(root); baseline(root);
  for (const content of [source + '\n', source + '\n\n', source + '  \n\t\n']) {
    write(root, relative, content);
    assert.deepEqual(memoryIssues(root, scanProject(root), [relative]), []);
  }
  write(root, relative, source.replace('        return', '    return'));
  assert.ok(memoryIssues(root, scanProject(root), [relative]).some((issue) => /stale/.test(issue)));
  write(root, relative, source.replace('value = 1', 'value = 2'));
  assert.ok(memoryIssues(root, scanProject(root), [relative]).some((issue) => /stale/.test(issue)));
});
