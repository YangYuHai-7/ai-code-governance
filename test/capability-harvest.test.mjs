import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { capabilityHarvestSummary, prepareCapabilityHarvest, prepareCapabilityPromotion } from '../src/capability-harvest.mjs';
import * as harvestModule from '../src/capability-harvest.mjs';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-capability-harvest-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function initialize(root, overrides = {}) {
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], ...overrides };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)), { transactional: true });
  return config;
}

test('Chinese capability Skills localize generated instructions and preserve discovered evidence', (context) => {
  const root = fixture('chinese-candidate');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios'; export const client = axios.create({});\n");
  const scan = scanProject(root);
  const prepared = prepareCapabilityHarvest({ ...defaultConfig(scan), artifactLanguage: 'zh-CN' }, scan);
  const artifacts = buildArtifacts(prepared.config, scan);
  const skill = artifacts.find((entry) => entry.path === 'docs/ai/skills/project/use-project-http-client/SKILL.md');
  assert.match(skill.content, /读取当前实现/);
  assert.match(skill.content, /候选.*批准/);
  assert.match(skill.content, /src\/http-client\.ts/);
  assert.doesNotMatch(skill.content, /This is an automatically|Read the current implementation/);
});

test('harvest eligibility requires a verified behavior route and production source', () => {
  assert.equal(typeof harvestModule.assessHarvestEligibility, 'function');
  const assess = harvestModule.assessHarvestEligibility;
  const input = { taskRoute: { level: 'L2' }, changedPaths: ['src/http-client.ts'], verification: { status: 'passed' } };
  assert.deepEqual(assess(input), { eligible: true, reason: 'verified-product-behavior-change' });
  assert.deepEqual(assess({ taskRoute: { level: 'L0' }, changedPaths: [], verification: { status: 'not-requested' } }), {
    eligible: false, reason: 'no-verified-product-behavior-change',
  });
  for (const level of ['L0', 'L1']) assert.equal(assess({ ...input, taskRoute: { level } }).eligible, false);
  for (const status of ['upgrade-required', 'unverified-declaration']) {
    assert.deepEqual(assess({ ...input, taskRoute: { declaredLevel: 'L3', status } }), { eligible: false, reason: `task-route-${status}` });
  }
  for (const status of ['not-requested', 'failed', 'skipped-after-governance-failure', 'skipped-after-task-route-failure']) {
    assert.deepEqual(assess({ ...input, verification: { status } }), { eligible: false, reason: `project-verification-${status}` });
  }
  for (const relative of ['docs/guide.md', 'docs/example.ts', 'src/client.test.ts', 'src/fixtures/client.ts', 'packages/demo/test/client.ts', 'src/tmp/client.ts', 'src/temp-helper.ts', 'src/temporary/client.ts', 'scripts/temporary.ts', 'config/auth.yaml', 'src/config/auth.ts', 'db/migrations/001.sql', 'src/migrations/001.ts', '.ai-governance/config.json', 'docs/ai/architecture-profile.json', 'package.json']) {
    assert.deepEqual(assess({ ...input, changedPaths: [relative] }), { eligible: false, reason: 'no-production-source-change' }, relative);
  }
  assert.equal(assess({ ...input, taskRoute: { level: 'L3' }, changedPaths: ['src/auth/policy.ts'] }).eligible, true);
  assert.equal(assess({ ...input, taskRoute: { level: 'L2', reasonCodes: ['mutation:non-production'] } }).eligible, false);
});

test('capability change evidence ignores formatting but preserves changed string values', () => {
  const original = "import axios from 'axios'; export const client = axios.create({ baseURL: '/v1' });\n";
  assert.equal(harvestModule.capabilitySourceChanged(original, "import axios from \"axios\"\nexport const client = axios.create({baseURL: '/v1'})\n"), false);
  assert.equal(harvestModule.capabilitySourceChanged(original, original.replace('/v1', '/ v1')), true);
});

for (const [name, before, after, changed] of [
  ['template value', 'export const url = `/v1`;', 'export const url = `/v2`;', true],
  ['template expression', 'export const url = `/${one}`;', 'export const url = `/${two}`;', true],
  ['regex value', 'export const role = /^admin$/;', 'export const role = /^guest$/;', true],
  ['regex whitespace', 'export const role = /^admin$/;', 'export const role = /^ admin$/;', true],
  ['ambiguous regex whitespace', 'if (ok) /admin/.test(role);', 'if (ok) / admin/.test(role);', true],
  ['raw escape', String.raw`export const newline = '\n';`, "export const newline = 'n';", true],
  ['string whitespace', "export const url = '/v1';", "export const url = '/ v1';", true],
  ['restricted newline', 'function policy() { return allowed; }', 'function policy() { return\nallowed; }', true],
  ['operator boundaries', 'export const a = b + +c;', 'export const a = b++ + c;', true],
  ['control-body terminator', 'if (allowed); enforce();', 'if (allowed) enforce();', true],
  ['expression continuation terminator', 'export const x = call(); [1].forEach(run);', 'export const x = call() [1].forEach(run);', true],
  ['ordinary whitespace', 'export const a = call(1, 2);', 'export   const a=call( 1,2 );', false],
  ['ordinary comments', 'export const a = call(1);', '/* explanation */ export const a = call(/* input */ 1); // end\n', false],
  ['top-level terminator', 'export const a = call(1);', 'export const a = call(1)\n', false],
]) {
  test(`capability source comparison retains ${name} evidence`, () => {
    assert.equal(harvestModule.capabilitySourceChanged(before, after), changed);
  });
}

for (const [label, separator] of [['CR', '\r'], ['LF', '\n'], ['CRLF', '\r\n'], ['LS', '\u2028'], ['PS', '\u2029']]) {
  for (const keyword of ['return', 'throw', 'break', 'continue', 'yield', 'async']) {
    test(`source comparison preserves actual ${label} after restricted ${keyword}`, () => {
      assert.equal(harvestModule.capabilitySourceChanged(`${keyword} value`, `${keyword}${separator}value`), true);
      assert.equal(harvestModule.capabilitySourceChanged(`${keyword}\nvalue`, `${keyword}${separator}value`), false);
    });
  }
  test(`source comparison terminates line comments at actual ${label}`, () => {
    assert.equal(harvestModule.capabilitySourceChanged(`return // note${separator}true`, `return // note${separator}false`), true);
  });
  test(`source comparison preserves actual ${label} inside restricted comments and before async arrows`, () => {
    assert.equal(harvestModule.capabilitySourceChanged('return /* note */ true', `return /* note${separator} */ true`), true);
    assert.equal(harvestModule.capabilitySourceChanged('const can = async (value) => value;', `const can = async (value)${separator}=> value;`), true);
  });
}

for (const [name, expression, candidate] of [
  ['direct object', '{ can() { return true; } }', true],
  ['complete Promise.resolve', 'Promise.resolve({ can() { return true; } })', true],
  ['parenthesized object', '(({ can() { return true; } }))', true],
  ['parenthesized Promise.resolve object', '(Promise.resolve(({ can() { return true; } })))', true],
  ['then chain', 'Promise.resolve({ can() { return true; } }).then(() => unrelated)', false],
  ['catch chain', 'Promise.resolve({ can() { return true; } }).catch(() => unrelated)', false],
  ['finally chain', 'Promise.resolve({ can() { return true; } }).finally(() => unrelated)', false],
  ['comma object', '{ can() { return true; } }, unrelated', false],
  ['comma promise', 'Promise.resolve({ can() { return true; } }), unrelated', false],
  ['conditional object', '{ can() { return true; } } ? unrelated : other', false],
  ['binary object', '{ can() { return true; } } && unrelated', false],
  ['member object', '{ can() { return true; } }.can', false],
  ['call object', '{ can() { return true; } }()', false],
  ['extra Promise.resolve argument', 'Promise.resolve({ can() { return true; } }, unrelated)', false],
  ['comma inside promise argument', 'Promise.resolve(({ can() { return true; } }, unrelated))', false],
  ['chain inside parentheses', '(Promise.resolve({ can() { return true; } }).then(() => unrelated))', false],
  ['newline continuation', 'Promise.resolve({ can() { return true; } })\n.then(() => unrelated)', false],
  ['arbitrary wrapper', 'wrap({ can() { return true; } })', false],
]) {
  test(`factory discovery requires the complete returned ${name} expression`, (context) => {
    const root = fixture('factory-return');
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
    for (const terminator of [';', '\n', '']) {
      fs.writeFileSync(path.join(root, 'src/auth/policy.ts'), `export function Policy() { return ${expression}${terminator} }`);
      assert.deepEqual(harvestModule.detectCapabilityCandidates(scanProject(root)).map((entry) => entry.id), candidate ? ['project-authorization'] : [], JSON.stringify(terminator));
    }
  });
}

for (const [name, source, expectedId, symbol, exportedAs] of [
  ['ambient object return alias', 'declare function Policy(): { can(): boolean }; export { Policy };', null],
  ['ambient object return default', 'declare function Policy(): { can(): boolean }; export default Policy;', null],
  ['object return overload', 'export function Policy(): { can(): boolean };', null],
  ['function type return overload', 'export function Policy(): () => { can(): boolean };', null],
  ['nested generic return overload', 'export function Policy(): Promise<Array<{ can(): boolean }>>;', null],
  ['object return type without runtime decision', 'export function Policy(): { can(): boolean } { return service; }', null],
  ['private nested decision inside public factory', 'export function Policy() { class Private { can() { return true; } } return unrelated; }', null],
  ['private decision in returned callback', 'export function Policy() { return () => { class Private { can() { return true; } } return unrelated; }; }', null],
  ['generic return overload', 'export function Policy<T>(): Promise<{ can(): boolean }>; export const unrelated = 1;', null],
  ['abstract decision signature', 'export abstract class Policy { abstract can(): boolean; }', null],
  ['ambient class alias', 'declare class Policy { can(): boolean; } export { Policy };', null],
  ['type-only policy', 'export type Policy = { can(): boolean }; export interface Authorization { can(): boolean }', null],
  ['guard contract without implementation', 'export class AccessGuard implements CanActivate {}', null],
  ['object return implementation', 'export function Policy(): { can(): boolean } { return { can() { return true; } }; }', 'project-authorization', 'Policy', 'Policy'],
  ['generic object return implementation', 'export function Policy<T extends { id: string }>(): Promise<{ can(): boolean }> { return Promise.resolve({ can() { return true; } }); }', 'project-authorization', 'Policy', 'Policy'],
  ['object return default implementation', 'export default function Policy(): { can(): boolean } { return { can() { return true; } }; }', 'project-authorization', 'Policy', 'default'],
  ['object return alias implementation', 'function Policy(): { can(): boolean } { return { can() { return true; } }; } export { Policy as AccessPolicy };', 'project-authorization', 'Policy', 'AccessPolicy'],
  ['typed concrete decision method', 'export class Policy { can(): boolean { return true; } }', 'project-authorization', 'Policy', 'Policy'],
  ['private policy beside unrelated export', 'export const unrelated = 1; class Policy { can() { return true; } }', null],
  ['private policy beside unrelated alias', 'const unrelated = 1; class Policy { can() { return true; } } export { unrelated as PolicyApi };', null],
  ['decision method in a different class', 'export class Policy {} class Helper { can() { return true; } }', null],
  ['overload signature cannot borrow another body', 'export function Policy(): boolean; class Helper { can() { return true; } }', null],
  ['private nested policy', 'export function helper() { class Policy { can() { return true; } } return Policy; }', null],
  ['public policy declaration', 'export class Policy { can() { return true; } }', 'project-authorization', 'Policy', 'Policy'],
  ['public policy local alias', 'class Policy { can() { return true; } } export { Policy as AccessPolicy };', 'project-authorization', 'Policy', 'AccessPolicy'],
  ['public policy default', 'class Policy { can() { return true; } } export default Policy;', 'project-authorization', 'Policy', 'default'],
  ['public guard declaration', 'export class AccessGuard implements CanActivate { canActivate() { return true; } }', 'project-authorization', 'AccessGuard', 'AccessGuard'],
  ['private guard declaration', 'export const unrelated = 1; class AccessGuard implements CanActivate { canActivate() { return true; } }', null],
  ['private client beside unrelated alias', "import axios from 'axios'; const client = axios.create({}); const other = {}; export { other as clientApi };", null],
  ['shadowed private client', "import axios from 'axios'; function hidden() { const client = axios.create({}); } export const client = {};", null],
  ['external reexport is not a local export', "import axios from 'axios'; const client = axios.create({}); export { client } from './other';", null],
  ['public client local alias', "import axios from 'axios'; const client = axios.create({}); export { client as publicClient };", 'project-http-client', 'client', 'publicClient'],
]) {
  test(`capability discovery binds ${name} to its own exported declaration`, (context) => {
    const root = fixture('declaration-export');
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
    fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/auth/policy.ts'), source);
    const candidates = harvestModule.detectCapabilityCandidates(scanProject(root));
    assert.deepEqual(candidates.map((entry) => entry.id), expectedId ? [expectedId] : []);
    if (expectedId) {
      const evidence = candidates[0].discoveryEvidence[0];
      assert.equal(evidence.path, 'src/auth/policy.ts');
      assert.equal(evidence.symbol, symbol);
      assert.equal(evidence.exportedAs, exportedAs);
      assert.ok(source.slice(evidence.declarationRange.start, evidence.declarationRange.end).includes(symbol));
      if (name.includes('implementation')) assert.ok(source.slice(evidence.declarationRange.start, evidence.declarationRange.end).includes('return true;'));
      assert.ok(source.slice(evidence.exportRange.start, evidence.exportRange.end).startsWith('export'));
    }
  });
}

test('harvest deduplicates by id then entrypoint then implementation without merging titles', (context) => {
  const root = fixture('dedup-order');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http.ts'), "import axios from 'axios'; export const client = axios.create({});\n");
  fs.writeFileSync(path.join(root, 'src/other.ts'), 'export const other = true;\n');
  const config = initialize(root);
  const scan = scanProject(root);
  const initial = prepareCapabilityHarvest(config, scan);
  assert.equal(initial.decisions?.[0]?.outcome, 'create-new');
  const candidate = initial.config.projectCapabilities[0];
  const alias = { ...candidate, id: 'owned-http', skill: 'docs/ai/skills/project/owned-http/SKILL.md', owner: 'custom-owner' };
  const byId = prepareCapabilityHarvest({ ...config, projectCapabilities: [alias, candidate] }, scan);
  assert.equal(byId.decisions[0].outcome, 'update-existing');
  assert.equal(byId.decisions[0].existingCapabilityId, candidate.id);
  const entrypoint = { ...alias, implementationPaths: ['src/other.ts'], publicEntrypoints: ['src/http.ts'] };
  const byEntry = prepareCapabilityHarvest({ ...config, projectCapabilities: [alias, { ...entrypoint, id: 'entry-http' }] }, scan);
  assert.equal(byEntry.decisions[0].outcome, 'extend-existing');
  assert.equal(byEntry.decisions[0].existingCapabilityId, 'entry-http');
  assert.deepEqual(byEntry.config.projectCapabilities.find((entry) => entry.id === 'entry-http').implementationPaths, ['src/http.ts', 'src/other.ts']);
  const byPath = prepareCapabilityHarvest({ ...config, projectCapabilities: [alias] }, scan);
  assert.equal(byPath.decisions[0].outcome, 'extend-existing');
  assert.deepEqual(byPath.config.projectCapabilities.map((entry) => entry.id), ['owned-http']);
  assert.equal(byPath.config.projectCapabilities[0].skill, alias.skill);
  assert.equal(byPath.config.projectCapabilities[0].owner, 'custom-owner');
  assert.equal(byPath.config.projectCapabilities[0].status, 'candidate');
  const unrelated = { ...alias, implementationPaths: ['src/other.ts'] };
  assert.equal(prepareCapabilityHarvest({ ...config, projectCapabilities: [unrelated] }, scan).decisions[0].outcome, 'create-new');
  const ambiguous = prepareCapabilityHarvest({ ...config, projectCapabilities: [alias, { ...alias, id: 'another-http' }] }, scan);
  assert.equal(ambiguous.decisions[0].outcome, 'no-skill-with-reason');
  assert.equal(ambiguous.decisions[0].reason, 'ambiguous-implementation-path-match');
});

test('completion candidates require a changed exported capability and keep evidence gaps explicit', (context) => {
  const root = fixture('completion-public-boundary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/auth/policy.ts'), 'class Policy { can() { return true; } }\n');
  const config = initialize(root);
  const input = { taskRoute: { declaredLevel: 'L3', status: 'verified' }, changedPaths: ['src/auth/policy.ts'], verification: { status: 'passed', command: 'npm run test' } };
  const summary = () => harvestModule.completionCapabilityHarvestSummary(config, scanProject(root), input);
  assert.equal(summary().reason, 'no-reusable-public-capability-change');
  fs.writeFileSync(path.join(root, 'src/auth/policy.ts'), 'export class Policy { can() { return true; } }\n');
  const candidate = summary().candidates[0].capability;
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.owner, 'authorization');
  assert.equal(candidate.review.status, 'required');
  assert.deepEqual(candidate.publicEntrypoints, []);
  assert.match(candidate.gaps.join('\n'), /public entrypoint/);
  assert.match(candidate.implementationFingerprint, /^[a-f0-9]{64}$/);
  fs.mkdirSync(path.join(root, 'src/fixtures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/fixtures/policy.ts'), 'export class Policy { can() { return false; } }\n');
  assert.deepEqual(summary().candidates[0].capability.implementationPaths, ['src/auth/policy.ts']);
});

test('two detected capabilities cannot overwrite one existing capability through path matches', (context) => {
  const root = fixture('dedup-collision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.writeFileSync(path.join(root, 'src/auth/policy.ts'), "import axios from 'axios'; export const client = axios.create({}); export class Policy { can() { return true; } }\n");
  const config = initialize(root);
  const scan = scanProject(root);
  const authorization = prepareCapabilityHarvest(config, scan).config.projectCapabilities.find((entry) => entry.id === 'project-authorization');
  const byId = prepareCapabilityHarvest({ ...config, projectCapabilities: [authorization] }, scan);
  assert.deepEqual(byId.config.projectCapabilities.map((entry) => entry.id), ['project-authorization']);
  assert.equal(byId.decisions.find((entry) => entry.capabilityId === 'project-http-client').outcome, 'no-skill-with-reason');
  assert.equal(byId.decisions.find((entry) => entry.capabilityId === 'project-authorization').outcome, 'update-existing');
});

test('harvest extracts Axios and authorization candidates with reuse Skills but does not claim enforcement', (context) => {
  const root = fixture('candidates');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0', '@nestjs/core': '11.0.0' },
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' },
  }));
  fs.mkdirSync(path.join(root, 'src/platform'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/platform/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 5000 });\n");
  fs.writeFileSync(path.join(root, 'src/auth/permission.service.ts'), 'export class PermissionService { can() { return true; } }\n');
  const config = initialize(root);
  const scan = scanProject(root);
  const prepared = prepareCapabilityHarvest(config, scan);
  assert.deepEqual(prepared.harvest.candidateIds, ['project-authorization', 'project-http-client']);
  assert.equal(prepared.harvest.verification.status, 'not-run-by-harvest');
  assert.equal(prepared.config.projectCapabilities.every((capability) => capability.status === 'candidate'), true);
  assert.equal(prepared.config.projectCapabilities.every((capability) => capability.publicEntrypoints.length === 0), true);
  assert.equal(prepared.config.projectCapabilities.every((capability) => capability.review.status === 'required' && /^\d{4}-\d{2}-\d{2}$/.test(capability.review.dueDate)), true);
  const repeat = prepareCapabilityHarvest(prepared.config, scan);
  assert.deepEqual(repeat.config.projectCapabilities.map((capability) => capability.review), prepared.config.projectCapabilities.map((capability) => capability.review));
  const summary = capabilityHarvestSummary(config, scan);
  assert.equal(summary.mode, 'read-only-preview');
  assert.match(summary.boundary, /No file was written/);

  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(prepared.config, scan)), {
    transactional: true,
    verify: () => checkProject(scanProject(root)),
  });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/capability-evolution.json'), 'utf8'));
  assert.equal(catalog.lastHarvest.outcome, 'candidate-recorded');
  const skill = fs.readFileSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md'), 'utf8');
  assert.match(skill, /automatically discovered candidate/);
  assert.match(skill, /src\/platform\/http-client\.ts/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('harvest rejects comments, strings, inline Axios use, and UI labels as capability evidence', (context) => {
  const root = fixture('false-positive');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/request.ts'), "import axios from 'axios';\nexport function request() { return axios.create({}); }\n");
  const noDependency = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.equal(noDependency.config.projectCapabilities.some((capability) => capability.id === 'project-http-client'), false);

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  const inlineUse = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.equal(inlineUse.config.projectCapabilities.some((capability) => capability.id === 'project-http-client'), false);

  fs.writeFileSync(path.join(root, 'src/request.ts'), "// import axios from 'axios'; export const fake = axios.create({});\nexport const unrelated = 1;\n");
  fs.writeFileSync(path.join(root, 'src/request-copy.ts'), "const copy = \"import axios from 'axios'; export const fake = axios.create({});\";\nexport const unrelated = copy;\n");
  const nonCode = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.equal(nonCode.config.projectCapabilities.some((capability) => capability.id === 'project-http-client'), false);

  fs.writeFileSync(path.join(root, 'src/roles.ts'), 'export type Role = "admin" | "member";\n');
  fs.mkdirSync(path.join(root, 'src/ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/ui/permission-label.tsx'), 'export function PermissionLabel() { return null; }\n');
  fs.mkdirSync(path.join(root, 'src/features/users'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/features/users/permission-badge.tsx'), 'export function PermissionBadge() { return null; }\n');
  const roleType = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.equal(roleType.config.projectCapabilities.some((capability) => capability.id === 'project-authorization'), false);
});

test('harvest recognizes a default-exported Axios client only when it has an executable Axios binding', (context) => {
  const root = fixture('axios-default-export');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nconst client = axios.create({});\nexport default client;\n");
  const prepared = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.deepEqual(prepared.harvest.candidateIds, ['project-http-client']);
});

test('harvest excludes runtime releases from detection and fingerprints without trusting Git ignored roots', (context) => {
  const root = fixture('runtime-release-artifacts');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.gitignore'), '.runtime/\nunknown-output/\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'unknown-output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const sourceClient = axios.create({});\n");
  fs.writeFileSync(path.join(root, 'unknown-output/http-client.js'), "import axios from 'axios';\nexport const ignoredButUnknown = axios.create({});\n");
  const config = initialize(root);
  const beforeRuntime = prepareCapabilityHarvest(config, scanProject(root));
  const beforeClient = beforeRuntime.config.projectCapabilities.find((capability) => capability.id === 'project-http-client');

  const runtimeOutput = path.join(root, '.runtime', 'releases', '2026-09-09', 'dist');
  fs.mkdirSync(runtimeOutput, { recursive: true });
  fs.writeFileSync(path.join(runtimeOutput, 'main.js'), "import axios from 'axios';\nexport const deployedClient = axios.create({});\n");
  const afterRuntime = prepareCapabilityHarvest(config, scanProject(root));
  const afterClient = afterRuntime.config.projectCapabilities.find((capability) => capability.id === 'project-http-client');
  assert.deepEqual(afterClient.implementationPaths, ['src/http-client.ts', 'unknown-output/http-client.js']);
  assert.equal(afterClient.implementationFingerprint, beforeClient.implementationFingerprint);
  assert.equal(afterRuntime.harvest.productChangeFingerprint, beforeRuntime.harvest.productChangeFingerprint);

  const cliPreview = run(['harvest', root, '--dry-run', '--json']);
  assert.equal(cliPreview.status, 0, cliPreview.stderr);
  const plannedClient = JSON.parse(cliPreview.stdout).harvest.plannedCapabilities.find((capability) => capability.id === 'project-http-client');
  assert.deepEqual(plannedClient.implementationPaths, ['src/http-client.ts', 'unknown-output/http-client.js']);
});

test('harvest command has a zero-write preview and chat requires the exact approved plan before writing', (context) => {
  const root = fixture('chat');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  initialize(root);
  const before = fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8');
  const direct = run(['harvest', root, '--dry-run', '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).harvest.outcome, 'candidate-recorded');
  assert.equal(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'), before);

  const unapproved = run(['harvest', root, '--json']);
  assert.equal(unapproved.status, 2);
  assert.equal(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'), before);

  const preview = run(['request', root, '--text', '提取项目能力', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planHash = JSON.parse(preview.stdout).plan.planHash;
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')), false);
  const apply = run(['request', root, '--text', '提取项目能力', `--approve=${planHash}`, '--json']);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(JSON.parse(apply.stdout).result.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')));

  const directRoot = fixture('direct-write');
  context.after(() => fs.rmSync(directRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directRoot, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(directRoot, 'src'));
  fs.writeFileSync(path.join(directRoot, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  initialize(directRoot);
  const directApply = run(['harvest', directRoot, '--yes', '--json']);
  assert.equal(directApply.status, 0, directApply.stderr);
  assert.equal(JSON.parse(directApply.stdout).verification.ok, true);
  assert.ok(fs.existsSync(path.join(directRoot, 'docs/ai/capability-evolution.json')));
});

test('promotion runs an exact discovered npm verification before adopting a candidate', (context) => {
  const root = fixture('promote-direct');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0' },
    scripts: { verify: 'node -e "process.exit(0)"' },
  }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  fs.writeFileSync(path.join(root, 'README.md'), 'not an HTTP entrypoint\n');
  initialize(root);
  const unrelated = run(['promote', root, '--id', 'project-http-client', '--entrypoint', 'README.md', '--consumer', 'package.json', '--verify', 'npm run verify', '--yes', '--json']);
  assert.equal(unrelated.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')), false);
  const preview = run(['promote', root, '--id', 'project-http-client', '--entrypoint', 'src/http-client.ts', '--verify', 'npm run verify', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).promotion.status, 'adopted');
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')), false);

  const applied = run(['promote', root, '--id', 'project-http-client', '--entrypoint', 'src/http-client.ts', '--consumer', 'src/http-client.ts', '--verify', 'npm run verify', '--yes', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).commandVerification.status, 'passed');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const capability = config.projectCapabilities.find((entry) => entry.id === 'project-http-client');
  assert.equal(capability.status, 'adopted');
  assert.deepEqual(capability.publicEntrypoints, ['src/http-client.ts']);
  assert.deepEqual(capability.consumerPaths, []);
  assert.deepEqual(capability.consumerEvidence, { status: 'operator-declared-unverified', paths: ['src/http-client.ts'] });
  assert.equal(capability.promotion.command, 'npm run verify');
  assert.ok(capability.verification.includes('npm run verify'));
  assert.match(fs.readFileSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md'), 'utf8'), /npm run verify/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('chat promotion requires an exact plan and a real passing verification command', (context) => {
  const root = fixture('promote-chat');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0' },
    scripts: { verify: 'node -e "process.exit(0)"' },
  }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  initialize(root);
  const input = path.join(root, 'promotion.json');
  fs.writeFileSync(input, JSON.stringify({ capabilityId: 'project-http-client', publicEntrypoints: ['src/http-client.ts'], verificationCommand: 'npm run verify' }));
  const preview = run(['request', root, '--text', '晋升项目能力', '--config', input, '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const payload = JSON.parse(preview.stdout);
  assert.equal(payload.intent.id, 'capability.promote');
  assert.equal(payload.promotion.status, 'adopted');
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')), false);
  const applied = run(['request', root, '--text', '晋升项目能力', '--config', input, `--approve=${payload.plan.planHash}`, '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).commandVerification.status, 'passed');
});

test('a failed promotion verification writes neither adoption state nor generated Skills', (context) => {
  const root = fixture('promote-failure');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0' },
    scripts: { verify: 'node -e "process.exit(1)"' },
  }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const config = initialize(root);
  const original = fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8');
  assert.throws(() => prepareCapabilityPromotion(config, scanProject(root), {
    capabilityId: 'project-http-client',
    publicEntrypoints: ['src/http-client.ts'],
    verificationCommand: 'npm run unknown',
  }), /exactly match a discovered/);
  const result = run(['promote', root, '--id', 'project-http-client', '--entrypoint', 'src/http-client.ts', '--verify', 'npm run verify', '--yes', '--json']);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /verification failed/);
  assert.equal(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/project/use-project-http-client/SKILL.md')), false);
});

test('adopted capabilities are not silently overwritten when implementation drift is detected', (context) => {
  const root = fixture('drift');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  const source = path.join(root, 'src/http-client.ts');
  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 1000 });\n");
  const config = initialize(root);
  const first = prepareCapabilityHarvest(config, scanProject(root));
  const adopted = {
    ...first.config,
    projectCapabilities: first.config.projectCapabilities.map((capability) => ({
      ...capability,
      status: 'adopted',
      publicEntrypoints: ['src/http-client.ts'],
      review: { status: 'completed', reviewedAt: '2026-09-08' },
      promotion: {
        verifiedAt: '2026-09-08',
        command: 'npm run test',
        basis: 'operator-confirmed-promotion-v1',
        implementationFingerprint: capability.implementationFingerprint,
      },
    })),
  };
  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 2000 });\n");
  const changed = prepareCapabilityHarvest(adopted, scanProject(root));
  assert.equal(changed.config.projectCapabilities.find((capability) => capability.id === 'project-http-client').status, 'adopted');
  assert.equal(changed.harvest.drift[0].id, 'project-http-client');
  assert.equal(changed.harvest.outcome, 'review-required');
  assert.equal(changed.harvest.reviewItems[0].owner, 'platform');
  assert.match(changed.harvest.reviewItems[0].dueDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('active candidates and adopted implementations that disappear require an owner review', (context) => {
  const root = fixture('disappeared');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  const source = path.join(root, 'src/http-client.ts');
  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const initial = prepareCapabilityHarvest(initialize(root), scanProject(root));
  fs.rmSync(source);
  const missingCandidate = prepareCapabilityHarvest(initial.config, scanProject(root));
  assert.equal(missingCandidate.harvest.outcome, 'review-required');
  assert.equal(missingCandidate.harvest.reviewItems[0].code, 'implementation-missing');

  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const restored = prepareCapabilityHarvest(initialize(root), scanProject(root));
  const adopted = {
    ...restored.config,
    projectCapabilities: restored.config.projectCapabilities.map((capability) => ({
      ...capability,
      status: 'adopted',
      publicEntrypoints: ['src/http-client.ts'],
      review: { status: 'completed', reviewedAt: '2026-09-08' },
      promotion: { verifiedAt: '2026-09-08', command: 'npm run test', basis: 'operator-confirmed-promotion-v1', implementationFingerprint: capability.implementationFingerprint },
    })),
  };
  fs.rmSync(source);
  const missingAdopted = prepareCapabilityHarvest(adopted, scanProject(root));
  assert.equal(missingAdopted.harvest.outcome, 'review-required');
  assert.equal(missingAdopted.harvest.drift[0].observedFingerprint, null);
  assert.equal(missingAdopted.harvest.reviewItems[0].owner, 'platform');
});

test('a review receipt cannot satisfy a later adopted implementation drift', (context) => {
  const root = fixture('stale-review');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  const source = path.join(root, 'src/http-client.ts');
  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 1000 });\n");
  const first = prepareCapabilityHarvest(initialize(root), scanProject(root));
  const adopted = {
    ...first.config,
    projectCapabilities: first.config.projectCapabilities.map((capability) => ({
      ...capability,
      status: 'adopted',
      publicEntrypoints: ['src/http-client.ts'],
      review: { status: 'completed', reviewedAt: '2026-09-08' },
      promotion: { verifiedAt: '2026-09-08', command: 'npm run test', basis: 'operator-confirmed-promotion-v1', implementationFingerprint: capability.implementationFingerprint },
    })),
  };
  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 2000 });\n");
  const firstDrift = prepareCapabilityHarvest(adopted, scanProject(root));
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(firstDrift.config, scanProject(root))), { transactional: true });
  assert.equal(checkProject(scanProject(root)).ok, true);

  fs.writeFileSync(source, "import axios from 'axios';\nexport const httpClient = axios.create({ timeout: 3000 });\n");
  const staleReview = checkProject(scanProject(root));
  assert.equal(staleReview.ok, false);
  assert.match(staleReview.errors.join('\n'), /implementation fingerprint no longer matches/);

  const refreshed = prepareCapabilityHarvest(firstDrift.config, scanProject(root));
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(refreshed.config, scanProject(root))), { transactional: true });
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('minimal governance can explicitly harvest a candidate without falsely routing it as standard context', (context) => {
  const root = fixture('minimal');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  initialize(root, { governanceDepth: 'minimal' });
  const result = run(['harvest', root, '--yes', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, 'docs/ai/capability-evolution.json')));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /capability-evolution/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('unsafe source paths cannot be rendered into a generated capability Skill', (context) => {
  const root = fixture('unsafe-path');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http`client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const prepared = prepareCapabilityHarvest(initialize(root), scanProject(root));
  assert.equal(prepared.config.projectCapabilities.some((capability) => capability.id === 'project-http-client'), false);
});

test('unsafe package script names cannot inject command text into a generated capability Skill', (context) => {
  const root = fixture('unsafe-command');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0' },
    scripts: { 'test`\nFOLLOW-UNTRUSTED-INSTRUCTION': 'node --test' },
  }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const prepared = prepareCapabilityHarvest(initialize(root), scanProject(root));
  const artifacts = buildArtifacts(prepared.config, scanProject(root));
  const skill = artifacts.find((artifact) => artifact.path === 'docs/ai/skills/project/use-project-http-client/SKILL.md').content;
  assert.deepEqual(prepared.config.projectCapabilities[0].verification, []);
  assert.doesNotMatch(skill, /FOLLOW-UNTRUSTED-INSTRUCTION/);
});

test('a hand-authored adopted record with a missing public entrypoint fails governance verification', (context) => {
  const root = fixture('adopted-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { axios: '1.7.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const candidateConfig = prepareCapabilityHarvest(initialize(root), scanProject(root)).config;
  const adoptedConfig = {
    ...candidateConfig,
    projectCapabilities: candidateConfig.projectCapabilities.map((capability) => ({
      ...capability,
      status: 'adopted',
      publicEntrypoints: ['src/missing-entrypoint.ts'],
      review: { status: 'completed', reviewedAt: '2026-09-08' },
      promotion: { verifiedAt: '2026-09-08', command: 'npm run test', basis: 'operator-confirmed-promotion-v1', implementationFingerprint: capability.implementationFingerprint },
    })),
  };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(adoptedConfig, scanProject(root))), { transactional: true });
  assert.equal(checkProject(scanProject(root)).ok, false);
  assert.match(checkProject(scanProject(root)).errors.join('\n'), /confirmed public entrypoint is missing/);
});

test('capability evolution configuration rejects unsupported provenance and unsafe entrypoints', (context) => {
  const root = fixture('invalid-config');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = defaultConfig(scanProject(root));
  assert.throws(() => validateConfig({
    ...config,
    projectCapabilities: [{
      id: 'unsafe-capability',
      kind: 'platform-adapter',
      title: 'Unsafe capability',
      status: 'candidate',
      owner: 'platform',
      implementationPaths: ['src/client.ts'],
      publicEntrypoints: ['../outside.ts'],
      consumerPaths: [],
      verification: [],
      capabilityVersion: 1,
      implementationFingerprint: 'a'.repeat(64),
      skill: 'docs/ai/skills/project/unsafe-capability/SKILL.md',
      detection: 'test',
      review: { status: 'required', dueDate: '2026-09-22' },
      gaps: [],
    }],
  }), /safe public entrypoints/);
  assert.throws(() => validateConfig({
    ...config,
    projectCapabilities: [{
      id: 'unsafe-consumer-evidence',
      kind: 'platform-adapter',
      title: 'Unsafe consumer evidence',
      status: 'candidate',
      owner: 'platform',
      implementationPaths: ['src/client.ts'],
      publicEntrypoints: [],
      consumerPaths: [],
      consumerEvidence: { status: 'operator-declared-unverified', paths: ['src/evil`consumer.ts'] },
      verification: [],
      capabilityVersion: 1,
      implementationFingerprint: 'a'.repeat(64),
      skill: 'docs/ai/skills/project/unsafe-consumer-evidence/SKILL.md',
      detection: 'test',
      review: { status: 'required', dueDate: '2026-09-22' },
      gaps: [],
    }],
  }), /invalid consumer evidence/);
  assert.throws(() => validateConfig({
    ...config,
    capabilityEvolution: { lastHarvest: { schemaVersion: 1, outcome: 'candidate-recorded', candidateIds: [], detectedCapabilityIds: [], drift: [], verification: { status: 'not-run-by-harvest', projectCommands: [], boundary: 'test' } } },
  }), /product change fingerprint/);
});
