import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig, prepareSkillGovernancePlan } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { auditSkillQuality } from '../src/modules/standards/skill-quality.mjs';
import { buildApprovedProjectAgentTeam, proposeProjectAgentTeam } from '../src/project-agent-team.mjs';
import { decideSkillCandidates } from '../src/skill-discovery.mjs';
import { loadTechnicalStandardRegistry } from '../src/modules/standards/index.mjs';

const WORKFLOW_ONLY = new Set(['professional-testing', 'software-design-and-verification']);
const REGISTRY_PROFILE = new Map(loadTechnicalStandardRegistry().standards.map((standard) => [standard.id, standard.profile]));
function profileFor(relativePath, id) {
  const parts = relativePath.split('/');
  const group = parts[parts.indexOf('skills') + 1];
  if (group === 'standards') return REGISTRY_PROFILE.get(id) ?? (WORKFLOW_ONLY.has(id) ? 'workflow' : 'implementation');
  if (group === 'project-conventions') return 'implementation';
  return 'workflow';
}
function canonicalSkills(artifacts) {
  return artifacts.filter((artifact) => artifact.path.startsWith('docs/ai/skills/') && artifact.path.endsWith('/SKILL.md'));
}
function auditAll(artifacts) {
  const issues = [];
  for (const artifact of canonicalSkills(artifacts)) {
    const id = path.basename(path.dirname(artifact.path));
    const report = auditSkillQuality(artifact.content, { profile: profileFor(artifact.path, id), id });
    if (report.status !== 'pass') issues.push(id + ': ' + report.issues.join('; '));
  }
  return issues;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-skill-quality-'));
  fs.mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'services', 'api', 'src', 'main', 'java'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'suite', workspaces: ['apps/*'], scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { vue: '3.5.0' } }));
  for (const name of ['a', 'b', 'c']) fs.writeFileSync(path.join(root, 'apps', 'web', 'src', name + '.ts'), 'export const ' + name + ' = 1;\n');
  fs.writeFileSync(path.join(root, 'services', 'api', 'pom.xml'), '<project></project>\n');
  fs.writeFileSync(path.join(root, 'services', 'api', 'src', 'main', 'java', 'Application.java'), 'class Application {}\n');
  return root;
}

test('every generated canonical Skill satisfies its quality contract', (context) => {
  const root = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard', initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  assert.deepEqual(auditAll(buildArtifacts(config, scan)), []);
});

test('management Skills generated under an approved team also satisfy the workflow contract', (context) => {
  const root = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete' };
  const agentTeam = buildApprovedProjectAgentTeam(proposeProjectAgentTeam({ projectMode: 'greenfield', evidence: [{ id: 'owner.scope', kind: 'user-confirmed-project' }], confirmedDomainNeeds: [], roleNeeds: [] }), { selectedIds: [], approvalEvidenceId: 'owner.approval' });
  const recommendation = decideSkillCandidates([], { selectedIds: undefined });
  const decision = decideSkillCandidates([], { selectedIds: undefined, approvalPlanHash: recommendation.planHash });
  const plan = prepareSkillGovernancePlan({ ...base, skillDiscovery: { enabled: true, decision }, agentTeam }, scan);
  const config = { ...base, skillDiscovery: { ...plan.skillDiscovery, approvalPlanHash: plan.planHash }, agentTeam: plan.agentTeam };
  const artifacts = buildArtifacts(config, scan);
  assert.deepEqual(auditAll(artifacts), []);
  assert.ok(canonicalSkills(artifacts).some((artifact) => artifact.path.includes('skill-discovery')));
});

test('a real code excerpt may contain a UI placeholder or a TODO comment without failing', () => {
  const markdown = [
    '---',
    'name: sample-surface',
    'description: Use when changing the sample surface implementation shape.',
    '---',
    '',
    '## When to use', '', '- Changing the sample surface.', '',
    '## When not to use', '', '- A module without current evidence.', '',
    '## Required invariants', '', '- Keep the neighboring implementation shape.', '',
    '## Decision flow', '', '1. Locate the surface.', '2. Compare the neighboring shape.', '3. Record a gap on conflict.', '',
    '## Correct implementation shape', '',
    'Excerpt from `src/views/Placeholder/index.vue`:', '',
    '```vue',
    '<script setup lang="ts">',
    'const query = ref()',
    '// TODO: keep this comment, it is real source code',
    '</script>',
    '<template><input v-model="query" placeholder="请输入名称" /></template>',
    '```', '',
    '## Incorrect implementation shape', '',
    '```vue',
    '<!-- WRONG: transport logic inside the view -->',
    '<!-- WRONG path: src/views/../other-role/New.vue -->',
    '<!-- Keep the neighboring responsibility instead. -->',
    '```', '',
    '## Exceptions and escalation', '', '- A new boundary needs an owner decision.', '',
    '## Verification matrix', '', '| 场景 | 期望结果 | 命令 |', '| --- | --- | --- |', '| 组件行为 | 通过 | `npm run test` |', '',
    '## Project evidence boundary', '', '- The excerpt proves a shape, not business meaning.', '',
    '## Sources', '', '- `docs/ai/project-conventions.json`.', '',
  ].join(String.fromCharCode(10));
  assert.deepEqual(auditSkillQuality(markdown, { profile: 'implementation', id: 'sample-surface' }).issues, []);
});

