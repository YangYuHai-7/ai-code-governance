import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { defaultConfig } from '../src/generator.mjs';
import { approvedProjectRoles, buildAgentArtifacts, detectProjectSurfaces, projectRoleContext, proposedProjectRoles, selectAgentRoles } from '../src/modules/governance/agents.mjs';

function fixture(t, name, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-agent-roles-' + name + '-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), body);
  }
  return root;
}

function configFor(scan, overrides) {
  return { ...defaultConfig(scan), initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' }, ...overrides };
}

function agentPaths(config, scan) {
  return buildAgentArtifacts(config, scan).artifacts.map((artifact) => artifact.path.replace('docs/ai/agents/', '').replace('.md', '')).sort();
}

test('a backend-only project does not carry frontend or design roles', (t) => {
  const root = fixture(t, 'backend', { 'src/billing/service.ts': 'export const x = 1;\n' });
  const scan = scanProject(root);
  const config = configFor(scan, { stacks: ['backend-node'] });
  const surfaces = detectProjectSurfaces(config, scan);
  assert.deepEqual({ frontend: surfaces.frontend, backend: surfaces.backend, fallback: surfaces.fallback }, { frontend: false, backend: true, fallback: false });
  assert.deepEqual(agentPaths(config, scan), ['architect', 'ba', 'backend', 'pm', 'tester']);
});

test('a frontend-only project does not carry backend or fullstack roles', (t) => {
  const root = fixture(t, 'frontend', { 'src/components/Card.tsx': 'export const Card = () => null;\n' });
  const scan = scanProject(root);
  const config = configFor(scan, { stacks: ['frontend-react'] });
  assert.deepEqual(agentPaths(config, scan), ['architect', 'ba', 'designer', 'frontend', 'pm', 'tester']);
});

test('a full-stack project carries every base role', (t) => {
  const root = fixture(t, 'fullstack', { 'src/components/Card.tsx': 'export const Card = () => null;\n', 'src/service/api.ts': 'export const api = 1;\n' });
  const scan = scanProject(root);
  const config = configFor(scan, { stacks: ['frontend-react', 'backend-node'] });
  assert.deepEqual(agentPaths(config, scan), ['architect', 'ba', 'backend', 'designer', 'frontend', 'fullstack', 'pm', 'tester']);
});

test('the conservative fallback keeps the whole vocabulary for greenfield or unknown projects', (t) => {
  const root = fixture(t, 'fallback', {});
  const scan = scanProject(root);
  for (const config of [
    configFor(scan, { stacks: ['backend-node'], initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } }),
    configFor(scan, { stacks: ['generic-unknown'] }),
  ]) {
    assert.equal(detectProjectSurfaces(config, scan).fallback, true);
    assert.equal(selectAgentRoles(config, scan).length, 8);
  }
});

test('role documents are generated in the configured artifact language', (t) => {
  const root = fixture(t, 'localized', { 'src/modules/billing/service.ts': 'export const x = 1;\n' });
  const scan = scanProject(root);
  const zh = buildAgentArtifacts(configFor(scan, { stacks: ['backend-node'], artifactLanguage: 'zh-CN' }), scan).artifacts.find((a) => a.path.endsWith('/backend.md'));
  assert.match(zh.content, /## 何时使用/);
  assert.match(zh.content, /## 必需证据/);
  assert.doesNotMatch(zh.content, /## When to use/);
  const en = buildAgentArtifacts(configFor(scan, { stacks: ['backend-node'] }), scan).artifacts.find((a) => a.path.endsWith('/backend.md'));
  assert.match(en.content, /## When to use/);
});

test('a role carries this project context instead of a generic template', (t) => {
  const root = fixture(t, 'context', { 'src/modules/billing/service.ts': 'export const x = 1;\n', 'src/modules/billing/repository.ts': 'export const y = 1;\n', 'test/billing.test.ts': 'export const z = 1;\n' });
  const scan = scanProject(root);
  const doc = buildAgentArtifacts(configFor(scan, { stacks: ['backend-node'] }), scan).artifacts.find((a) => a.path.endsWith('/backend.md'));
  assert.match(doc.content, /## Project context/);
  assert.match(doc.content, /src\/modules\/billing/);
});

test('only an owner-approved project role becomes a role document', (t) => {
  const root = fixture(t, 'project-role', { 'src/modules/contracts/service.ts': 'export const x = 1;\n' });
  const scan = scanProject(root);
  const base = configFor(scan, { stacks: ['backend-node'] });
  const recommended = { enabled: true, status: 'approved', roleProposals: [{ id: 'contract-specialist', title: 'Contract specialist', capabilities: ['domain-review'], responsibilities: ['Identify contract issues for human review.'], outOfScope: ['Final professional judgment.'], domainNeedIds: ['contract-law'], evidenceIds: ['decision.domain'], status: 'recommendation' }] };
  assert.deepEqual(approvedProjectRoles({ ...base, agentTeam: recommended }), []);
  const approved = { ...recommended, roleProposals: [{ ...recommended.roleProposals[0], status: 'approved-available', approval: { source: 'user', evidenceId: 'owner.approval' } }] };
  const artifacts = buildAgentArtifacts({ ...base, agentTeam: approved, artifactLanguage: 'zh-CN' }, scan).artifacts;
  const doc = artifacts.find((a) => a.path.endsWith('/contract-specialist.md'));
  assert.ok(doc, 'the approved project role must be emitted');
  assert.match(doc.content, /## 项目上下文/);
  assert.match(doc.content, /Identify contract issues for human review\./);
});

test('an evidence-corroborated business unit becomes an unconfirmed role proposal', (t) => {
  const root = fixture(t, 'proposal', {
    'src/modules/billing/service.ts': 'export const a = 1;\n',
    'src/modules/billing/repository.ts': 'export const b = 1;\n',
    'test/billing.test.ts': 'export const c = 1;\n',
  });
  const scan = scanProject(root);
  const config = configFor(scan, { stacks: ['backend-node'], artifactLanguage: 'zh-CN' });
  const context = projectRoleContext(config, scan);
  const proposals = proposedProjectRoles(config, scan, context);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].id, 'billing-domain-specialist');
  assert.ok(proposals[0].evidence.some((entry) => entry.includes('test coverage')), proposals[0].evidence.join('\n'));

  const doc = buildAgentArtifacts(config, scan).artifacts.find((artifact) => artifact.path.endsWith('/billing-domain-specialist.md'));
  assert.ok(doc, 'the candidate role must be emitted');
  assert.match(doc.content, /候选角色，尚未获得负责人确认/);
  assert.match(doc.content, /src\/modules\/billing/);
  assert.match(doc.content, /test\/billing\.test\.ts/);
});

test('greenfield projects and projects with an approved team never emit proposals', (t) => {
  const root = fixture(t, 'no-proposal', { 'src/modules/billing/service.ts': 'x\n', 'test/billing.test.ts': 'y\n' });
  const scan = scanProject(root);
  const greenfield = { ...defaultConfig(scan), stacks: ['backend-node'], initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } };
  assert.deepEqual(proposedProjectRoles(greenfield, scan, projectRoleContext(greenfield, scan)), []);
  const approved = { ...configFor(scan, { stacks: ['backend-node'] }), agentTeam: { enabled: true, status: 'approved', roleProposals: [{ id: 'x', title: 'X', capabilities: ['domain-review'], responsibilities: [], outOfScope: [], domainNeedIds: [], evidenceIds: [], status: 'approved-available' }] } };
  assert.deepEqual(proposedProjectRoles(approved, scan, projectRoleContext(approved, scan)), []);
});
