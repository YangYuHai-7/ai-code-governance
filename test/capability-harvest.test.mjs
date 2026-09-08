import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { capabilityHarvestSummary, prepareCapabilityHarvest, prepareCapabilityPromotion } from '../src/capability-harvest.mjs';
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
