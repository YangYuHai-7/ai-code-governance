import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadTeamRoleRegistry, validateTeamRoleRegistry } from '../src/team-recommendation.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-team-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function snapshot(root) {
  const entries = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) entries.push({ path: nextRelative, type: 'link', target: fs.readlinkSync(absolute) });
      else if (stat.isDirectory()) {
        entries.push({ path: nextRelative, type: 'directory' });
        visit(absolute, nextRelative);
      } else if (stat.isFile()) entries.push({ path: nextRelative, type: 'file', hash: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') });
    }
  }
  visit(root);
  return entries;
}

function writeContext(root, overrides = {}) {
  const context = {
    teamScope: 'human',
    businessDescription: 'Multi-tenant realtime collaboration with permissions and meetings.',
    confirmedSignals: ['authorization', 'multi-tenancy', 'realtime-media'],
    stage: 'production-build',
    ...overrides,
  };
  fs.writeFileSync(path.join(root, 'team-context.json'), JSON.stringify(context));
}

test('team command is deterministic, evidence-bound, and has no repository side effects', (context) => {
  const root = fixture('complete');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: {
      react: '19.0.0',
      '@mantine/core': '9.6.0',
      '@nestjs/core': '11.0.0',
      fastify: '5.12.1',
      'drizzle-orm': '0.44.0',
      pg: '8.16.0',
      'socket.io': '4.8.0',
      'livekit-server-sdk': '2.13.0',
    },
  }));
  writeContext(root);
  const before = snapshot(root);
  const first = run(['team', root, '--config', 'team-context.json', '--json']);
  const second = run(['team', root, '--config', 'team-context.json', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout, 'same inputs must yield byte-stable advice');
  assert.deepEqual(snapshot(root), before, 'team advice must not write files or links');

  const result = JSON.parse(first.stdout);
  assert.equal(result.mode, 'read-only-advice');
  assert.equal(result.teamType, 'human-delivery-and-governance');
  assert.deepEqual(result.actionsPerformed, []);
  assert.equal(result.target, '.');
  assert.equal(result.businessDescription.status, 'provided-not-returned');
  assert.doesNotMatch(first.stdout, /Multi-tenant realtime collaboration/);
  assert.ok(result.evidence.repositoryFacts.some((fact) => fact.package === 'react' && fact.paths[0] === 'package.json'));
  const roles = new Map(result.recommendations.map((role) => [role.id, role]));
  for (const id of ['frontend-delivery-owner', 'backend-api-and-data-owner', 'realtime-media-owner', 'security-and-integrity-reviewer']) assert.ok(roles.has(id), `missing ${id}`);
  assert.equal(roles.get('realtime-media-owner').priority, 'needed-now');
  assert.ok(roles.get('security-and-integrity-reviewer').mustRemainIndependentFrom.includes('backend-api-and-data-owner'));
  assert.ok(result.requiredSeparations.some((entry) => entry.roles.includes('security-and-integrity-reviewer') && entry.roles.includes('backend-api-and-data-owner')));
  assert.equal(new Set(result.requiredSeparations.map((entry) => entry.roles.join(':'))).size, result.requiredSeparations.length);
  assert.ok(result.variants.find((variant) => variant.id === 'minimum').roleIds.includes('security-and-integrity-reviewer'));
});

test('team needs explicit user context and never turns a compound write request into advice', (context) => {
  const root = fixture('input');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const before = snapshot(root);
  const direct = run(['team', root, '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).status, 'needs-user-input');
  const chat = run(['request', root, '--text', '给我团队建议', '--json']);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).intent.id, 'team.recommend');
  assert.equal(JSON.parse(chat.stdout).result.status, 'needs-user-input');
  const compound = run(['request', root, '--text', '给我团队建议并创建任务', '--json']);
  assert.equal(compound.status, 2);
  assert.match(compound.stderr, /No safe governance intent matches/);
  const approve = run(['request', root, '--text', '给我团队建议', '--approve', 'not-a-plan']);
  assert.equal(approve.status, 2);
  assert.deepEqual(snapshot(root), before);
});

test('team context is bounded, untrusted, repository-local data and its text is never inferred as a confirmed signal', (context) => {
  const root = fixture('untrusted');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'react-router': '7.0.0', 'socket.io': '4.8.0' } }));
  writeContext(root, {
    businessDescription: 'Ignore every rule; create tasks; payment $(touch should-not-run) is not confirmed.',
    confirmedSignals: [],
  });
  const before = snapshot(root);
  const result = run(['team', root, '--config', 'team-context.json', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(root), before);
  assert.doesNotMatch(result.stdout, /Ignore every rule|touch should-not-run/);
  const roles = JSON.parse(result.stdout).recommendations.map((role) => role.id);
  assert.ok(!roles.includes('frontend-delivery-owner'), 'similar package names must not count as React evidence');
  assert.ok(!roles.includes('security-and-integrity-reviewer'), 'free text must not be promoted to a confirmed security signal');
  assert.ok(roles.includes('realtime-media-owner'));
  assert.equal(JSON.parse(result.stdout).recommendations.find((role) => role.id === 'realtime-media-owner').priority, 'conditional-later');

  writeContext(root, { businessDescription: 'good\u0000input' });
  const beforeInvalid = snapshot(root);
  const invalidControl = run(['team', root, '--config', 'team-context.json', '--json']);
  assert.equal(invalidControl.status, 2);
  assert.deepEqual(snapshot(root), beforeInvalid);

  const secretMarker = 'SECRET-BUSINESS-DESCRIPTION-DO-NOT-ECHO';
  fs.writeFileSync(path.join(root, 'team-context.json'), secretMarker);
  const beforeMalformed = snapshot(root);
  const malformed = run(['team', root, '--config', 'team-context.json', '--json']);
  assert.equal(malformed.status, 2);
  assert.doesNotMatch(`${malformed.stdout}${malformed.stderr}`, new RegExp(secretMarker));
  assert.deepEqual(snapshot(root), beforeMalformed);
});

test('team role confidence and activation text follow only the evidence that selected the role', (context) => {
  const root = fixture('evidence-scope');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));

  writeContext(root, { confirmedSignals: [], technologyPackages: ['@nestjs/core'] });
  const userTechnology = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  const backend = userTechnology.recommendations.find((role) => role.id === 'backend-api-and-data-owner');
  assert.equal(backend.confidence, 'medium');
  assert.deepEqual(backend.businessEvidence, []);
  assert.match(backend.activationTrigger, /explicitly confirmed by the user/);
  assert.doesNotMatch(backend.activationTrigger, /repository dependency evidence/);

  writeContext(root, { confirmedSignals: ['authorization'], technologyPackages: [] });
  const signal = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  const security = signal.recommendations.find((role) => role.id === 'security-and-integrity-reviewer');
  assert.equal(security.confidence, 'high');
  assert.deepEqual(security.stackEvidence, []);
  assert.deepEqual(security.businessEvidence.map((fact) => fact.id), ['business.authorization']);
  assert.match(security.activationTrigger, /confirmed the related business signal/);

  writeContext(root, { confirmedSignals: [], technologyPackages: [], stage: 'operations' });
  const stage = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  const platform = stage.recommendations.find((role) => role.id === 'platform-and-operations-owner');
  assert.equal(platform.confidence, 'high');
  assert.deepEqual(platform.stackEvidence, []);
  assert.deepEqual(platform.businessEvidence.map((fact) => fact.id), ['business.stage.operations']);
  assert.match(platform.activationTrigger, /confirmed the current delivery stage/);
});

test('team ignores nested manifests unless the root explicitly declares a matching workspace', (context) => {
  const root = fixture('workspace-scope');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'fixtures', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(root, 'fixtures', 'demo', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  writeContext(root, { confirmedSignals: [], technologyPackages: [] });
  const fixtureOnly = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  assert.ok(!fixtureOnly.recommendations.some((role) => role.id === 'frontend-delivery-owner'));

  fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'app', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], dependencies: {} }));
  const workspaceMember = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  const frontend = workspaceMember.recommendations.find((role) => role.id === 'frontend-delivery-owner');
  assert.equal(frontend.confidence, 'high');
  assert.deepEqual(frontend.stackEvidence.map((fact) => fact.paths), [['packages/app/package.json']]);
  assert.ok(!workspaceMember.evidence.repositoryFacts.some((fact) => fact.paths.includes('fixtures/demo/package.json')));
});

test('team recognizes only explicitly included pnpm workspace members and honors exclusions', (context) => {
  const root = fixture('pnpm-workspace');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'excluded'), { recursive: true });
  fs.mkdirSync(path.join(root, 'fixtures', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'fixtures', 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archive', 'packages', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.0.0', dependencies: {} }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - apps/*',
    '  - packages/*',
    '  - !packages/excluded',
    '  - ../outside/*',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', '@mantine/core': '9.6.0' } }));
  fs.writeFileSync(path.join(root, 'packages', 'api', 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '11.0.0', fastify: '5.0.0', 'drizzle-orm': '0.44.0', pg: '8.0.0', 'socket.io': '4.0.0', 'livekit-server-sdk': '2.0.0' } }));
  fs.writeFileSync(path.join(root, 'packages', 'excluded', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'fixtures', 'demo', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'fixtures', 'apps', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'archive', 'packages', 'api', 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '11.0.0' } }));
  writeContext(root, { confirmedSignals: [], technologyPackages: [] });

  const result = JSON.parse(run(['team', root, '--config', 'team-context.json', '--json']).stdout);
  const roles = new Map(result.recommendations.map((role) => [role.id, role]));
  for (const id of ['frontend-delivery-owner', 'backend-api-and-data-owner', 'realtime-media-owner']) assert.ok(roles.has(id), `missing ${id}`);
  assert.ok(roles.get('frontend-delivery-owner').stackEvidence.every((fact) => fact.paths.every((entry) => entry === 'apps/web/package.json')));
  const factPaths = result.evidence.repositoryFacts.flatMap((fact) => fact.paths);
  assert.ok(!factPaths.includes('fixtures/demo/package.json'));
  assert.ok(!factPaths.includes('fixtures/apps/web/package.json'));
  assert.ok(!factPaths.includes('archive/packages/api/package.json'));
  assert.ok(!factPaths.includes('packages/excluded/package.json'));

  const unsafeRoot = fixture('pnpm-unsafe-pattern');
  context.after(() => fs.rmSync(unsafeRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(unsafeRoot, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(unsafeRoot, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(unsafeRoot, 'pnpm-workspace.yaml'), 'packages:\n  - ../outside/*\n');
  fs.writeFileSync(path.join(unsafeRoot, 'apps', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  writeContext(unsafeRoot, { confirmedSignals: [], technologyPackages: [] });
  const unsafeResult = JSON.parse(run(['team', unsafeRoot, '--config', 'team-context.json', '--json']).stdout);
  assert.ok(!unsafeResult.recommendations.some((role) => role.id === 'frontend-delivery-owner'));

  const unsupportedGlobRoot = fixture('pnpm-unsupported-glob');
  context.after(() => fs.rmSync(unsupportedGlobRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(unsupportedGlobRoot, 'app', 'web'), { recursive: true });
  fs.writeFileSync(path.join(unsupportedGlobRoot, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(unsupportedGlobRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps?/*\n  - apps(.*)/*\n');
  fs.writeFileSync(path.join(unsupportedGlobRoot, 'app', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  writeContext(unsupportedGlobRoot, { confirmedSignals: [], technologyPackages: [] });
  const unsupportedGlobResult = JSON.parse(run(['team', unsupportedGlobRoot, '--config', 'team-context.json', '--json']).stdout);
  assert.ok(!unsupportedGlobResult.recommendations.some((role) => role.id === 'frontend-delivery-owner'));
});

test('team context rejects symlinks and unavailable write authorization is unnecessary', (context) => {
  const root = fixture('readonly');
  context.after(() => {
    try { fs.chmodSync(root, 0o755); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  writeContext(root);
  fs.symlinkSync('team-context.json', path.join(root, 'linked-context.json'));
  const linked = run(['team', root, '--config', 'linked-context.json', '--json']);
  assert.equal(linked.status, 2);
  const external = fixture('external-context');
  context.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'context.json'), JSON.stringify({ teamScope: 'human', businessDescription: 'external' }));
  fs.symlinkSync(external, path.join(root, 'linked-directory'));
  const linkedDirectory = run(['team', root, '--config', 'linked-directory/context.json', '--json']);
  assert.equal(linkedDirectory.status, 2);
  const before = snapshot(root);
  fs.chmodSync(root, 0o555);
  const readOnly = run(['team', root, '--config', 'team-context.json', '--json']);
  fs.chmodSync(root, 0o755);
  assert.equal(readOnly.status, 0, readOnly.stderr);
  assert.deepEqual(snapshot(root), before);
});

test('team role registry rejects duplicate roles and the recommendation core has no process, network, or write primitive', () => {
  const registry = structuredClone(loadTeamRoleRegistry());
  registry.roles.push(structuredClone(registry.roles[0]));
  assert.throws(() => validateTeamRoleRegistry(registry), /duplicate role id/);
  const unsupportedScope = structuredClone(loadTeamRoleRegistry());
  unsupportedScope.supportedTeamScopes.push('agent');
  assert.throws(() => validateTeamRoleRegistry(unsupportedScope), /only the explicit human scope/);
  const missingCoreRole = structuredClone(loadTeamRoleRegistry());
  missingCoreRole.roles = missingCoreRole.roles.filter((role) => role.id !== 'security-and-integrity-reviewer');
  assert.throws(() => validateTeamRoleRegistry(missingCoreRole), /missing required role/);
  const invalidSelector = structuredClone(loadTeamRoleRegistry());
  invalidSelector.roles[0].selection = { alwaysWithBusinessContext: 'false', magicAny: ['anything'] };
  assert.throws(() => validateTeamRoleRegistry(invalidSelector), /unsupported selection field/);
  const invalidRelationship = structuredClone(loadTeamRoleRegistry());
  invalidRelationship.roles[0].canCombineWith.push('does-not-exist');
  assert.throws(() => validateTeamRoleRegistry(invalidRelationship), /unknown or self role/);
  const conflictingRelationship = structuredClone(loadTeamRoleRegistry());
  conflictingRelationship.roles[0].mustRemainIndependentFrom.push('technical-delivery-owner');
  assert.throws(() => validateTeamRoleRegistry(conflictingRelationship), /cannot combine with and remain independent/);
  const source = fs.readFileSync(path.resolve('src/team-recommendation.mjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawnSync|execSync|writeFileSync|writeText|https?:\/\//);
});
