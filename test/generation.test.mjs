import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
}

function initialize(root, customize = (config) => config, options = {}) {
  const scan = scanProject(root);
  const config = customize(defaultConfig(scan));
  const plan = planArtifacts(root, buildArtifacts(config, scan), options);
  return { scan, config, plan, applied: applyArtifactPlan(root, plan, options) };
}

test('generates regular adapters for all selected agents and passes check', (context) => {
  const root = fixture('all-agents');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const { config } = initialize(root, (value) => ({ ...value, governanceDepth: 'complete' }));
  assert.deepEqual(config.clients, ['codex', 'claude-code', 'cursor']);
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  assert.ok(fs.statSync(path.join(root, '.cursor/rules/ai-code-governance.mdc')).isFile());
  assert.ok(fs.statSync(path.join(root, '.agents/skills/frontend-react/SKILL.md')).isFile());
  assert.ok(fs.statSync(path.join(root, '.claude/skills/frontend-react/SKILL.md')).isFile());
  const releasePolicy = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/release-acceptance-policy.json'), 'utf8'));
  assert.equal(releasePolicy.tiers.major.minimumParticipants.engineers, 5);
  assert.equal(releasePolicy.tiers.major.minimumParticipants.architects, 3);
  assert.match(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), /aicg release-check/);
  const releasePolicyManifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8')).files.find((entry) => entry.path === 'docs/ai/release-acceptance-policy.json');
  assert.equal(releasePolicyManifest.ownership, 'full');
  assert.equal(scanProject(root).links.length, 0);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('standard and complete governance route owner-confirmed constraints through a fine-grained business skill', (context) => {
  const roots = [];
  context.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const depth of ['standard', 'complete']) {
    const root = fixture(`business-constraints-${depth}`);
    roots.push(root);
    const { config } = initialize(root, (value) => ({
      ...value,
      clients: ['codex', 'claude-code'],
      governanceDepth: depth,
      domainConstraints: [
        'Every issue belongs to exactly one tenant.',
        'Only active members may access tenant issues.',
      ],
      confirmedRiskSignals: ['authorization', 'multi-tenancy'],
    }));
    assert.deepEqual(config.confirmedRiskSignals, ['authorization', 'multi-tenancy']);
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8'));
    assert.deepEqual(registry.constraints.map(({ id, owner, source, constraintHash }) => ({ id, owner, source, constraintHash })), registry.constraints.map(({ constraintHash }) => ({
      id: `constraint-${constraintHash}`,
      owner: 'product-owner',
      source: 'owner-confirmed',
      constraintHash,
    })));
    assert.ok(registry.constraints.every((constraint) => /^[a-f0-9]{64}$/.test(constraint.constraintHash)));
    const skill = fs.readFileSync(path.join(root, 'docs/ai/skills/business-constraints/SKILL.md'), 'utf8');
    assert.match(skill, /owner-confirmed/);
    assert.match(skill, new RegExp(registry.constraints[0].id));
    assert.match(skill, /success evidence/i);
    assert.match(skill, /negative or boundary evidence/i);
    assert.match(skill, /production readiness as blocked/i);
    assert.match(skill, /unverified and eligible-for-review/i);
    assert.match(skill, /authorization, multi-tenancy/);
    assert.match(skill, /untrusted client-supplied identity headers/i);
    assert.match(skill, /inactive, suspended, or revoked membership/i);
    assert.match(skill, /cross-tenant read and write attempts/i);
    assert.equal(fs.readFileSync(path.join(root, '.agents/skills/business-constraints/SKILL.md'), 'utf8'), skill);
    assert.equal(fs.readFileSync(path.join(root, '.claude/skills/business-constraints/SKILL.md'), 'utf8'), skill);
    const contextMap = fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8');
    assert.match(contextMap, /business_constraints:/);
    assert.match(contextMap, /docs\/ai\/skills\/business-constraints\/SKILL\.md/);
    assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /business-constraints\/SKILL\.md/);
    assert.equal(checkProject(scanProject(root)).ok, true);
  }
});

test('minimal governance gives a business-constraint CTA without generating a skill', (context) => {
  const root = fixture('minimal-business-constraints');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({
    ...value,
    governanceDepth: 'minimal',
    domainConstraints: ['A cancellation must be explicit.'],
  }));
  assert.equal(fs.existsSync(path.join(root, 'docs/ai/skills/business-constraints/SKILL.md')), false);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /standard or complete governance.*business constraint Skill/i);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /production readiness is blocked/i);
  assert.match(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), /production readiness is blocked/i);
  assert.match(fs.readFileSync(path.join(root, 'docs/ai/context-map.yaml'), 'utf8'), /recorded evidence remains unverified/i);
});

test('business constraint ids remain stable across reorder and insertion while duplicates are rejected', (context) => {
  const root = fixture('stable-business-constraint-ids');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const first = { ...defaultConfig(scan), domainConstraints: ['Constraint A.', 'Constraint B.'] };
  const second = { ...defaultConfig(scan), domainConstraints: ['Constraint C.', 'Constraint B.', 'Constraint A.'] };
  const registry = (config) => JSON.parse(buildArtifacts(config, scan).find((artifact) => artifact.path === 'docs/ai/business-constraints.json').content);
  const firstIds = Object.fromEntries(registry(first).constraints.map((item) => [item.constraint, item.id]));
  const secondIds = Object.fromEntries(registry(second).constraints.map((item) => [item.constraint, item.id]));
  assert.equal(secondIds['Constraint A.'], firstIds['Constraint A.']);
  assert.equal(secondIds['Constraint B.'], firstIds['Constraint B.']);
  assert.throws(
    () => buildArtifacts({ ...first, domainConstraints: ['Constraint A.', ' Constraint A. '] }, scan),
    /must not contain duplicate normalized constraints/,
  );
});

test('confirmed risk signals are explicit enums and are never inferred from constraint wording', (context) => {
  const root = fixture('explicit-risk-signals');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), domainConstraints: ['Payment records must be correct.'] };
  const artifacts = buildArtifacts(config, scan);
  const persisted = JSON.parse(artifacts.find((artifact) => artifact.path === '.ai-governance/config.json').content);
  assert.deepEqual(persisted.confirmedRiskSignals, []);
  assert.doesNotMatch(artifacts.find((artifact) => artifact.path === 'docs/ai/skills/business-constraints/SKILL.md').content, /Payment risk checklist/);
  assert.throws(
    () => buildArtifacts({ ...config, confirmedRiskSignals: ['payment-keyword-guess'] }, scan),
    /confirmedRiskSignals contains an unsupported value/,
  );
});

test('owner-confirmed data consistency and public API signals add their minimum negative checklists', (context) => {
  const root = fixture('structured-risk-checklists');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({
    ...value,
    governanceDepth: 'standard',
    domainConstraints: ['Inventory updates must not lose committed quantities.'],
    confirmedRiskSignals: ['payment', 'sensitive-data', 'external-side-effect', 'data-consistency', 'public-api'],
  }));
  const skill = fs.readFileSync(path.join(root, 'docs/ai/skills/business-constraints/SKILL.md'), 'utf8');
  assert.match(skill, /amount and currency boundaries/i);
  assert.match(skill, /never ship a default credential/i);
  assert.match(skill, /key lifecycle, rotation and revocation/i);
  assert.match(skill, /persistent idempotency across replay, restart/i);
  assert.match(skill, /concurrent lost updates/i);
  assert.match(skill, /unique constraints/i);
  assert.match(skill, /crash recovery and multi-instance execution/i);
  assert.match(skill, /request size and rate limits/i);
  assert.match(skill, /authentication and authorization boundaries/i);
  assert.match(skill, /stable error contract/i);
});

test('check rejects a business skill that is present but unreachable from the context map', (context) => {
  const root = fixture('unreachable-business-skill');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({
    ...value,
    governanceDepth: 'standard',
    domainConstraints: ['Only active members may access tenant issues.'],
  }));
  const contextPath = path.join(root, 'docs/ai/context-map.yaml');
  fs.writeFileSync(contextPath, fs.readFileSync(contextPath, 'utf8').replaceAll('docs/ai/skills/business-constraints/SKILL.md', 'docs/ai/rules/00_always.mdc'));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, false);
  assert.equal(result.evidence.present, 'pass');
  assert.equal(result.evidence.reachable, 'fail');
  assert.ok(result.errors.some((error) => error.includes('business constraint Skill is not reachable')));
});

test('business reachability ignores comments, wrong profiles, and malformed profile indentation', (context) => {
  const variants = [
    (content) => `${content.replaceAll('docs/ai/skills/business-constraints/SKILL.md', 'docs/ai/rules/00_always.mdc')}\n# docs/ai/skills/business-constraints/SKILL.md\n`,
    (content) => `${content.replaceAll('docs/ai/skills/business-constraints/SKILL.md', 'docs/ai/rules/00_always.mdc')}\n  decoy_profile:\n    required:\n      - docs/ai/skills/business-constraints/SKILL.md\n`,
    (content) => content.replace('  business_constraints:', ' business_constraints:'),
  ];
  const roots = [];
  context.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const [index, mutate] of variants.entries()) {
    const root = fixture(`business-route-negative-${index}`);
    roots.push(root);
    initialize(root, (value) => ({ ...value, governanceDepth: 'standard', domainConstraints: ['Only active members may access tenant issues.'] }));
    const contextPath = path.join(root, 'docs/ai/context-map.yaml');
    fs.writeFileSync(contextPath, mutate(fs.readFileSync(contextPath, 'utf8')));
    const result = checkProject(scanProject(root));
    assert.equal(result.ok, false);
    assert.equal(result.evidence.reachable, 'fail');
    assert.ok(result.errors.some((error) => error.includes('business constraint Skill is not reachable')));
  }
});

test('check keeps structural and reachability evidence independent from unverified enforcement', (context) => {
  const root = fixture('evidence-dimensions');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence, {
    present: 'pass',
    reachable: 'pass',
    enforced: 'unverified',
    realClientVerified: 'unverified',
  });
  assert.ok(result.warnings.some((warning) => warning.includes('acceptance-results.json: missing')));
});

test('check rejects malformed enforcement evidence without erasing structural evidence', (context) => {
  const root = fixture('invalid-enforcement-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.writeFileSync(path.join(root, 'docs/ai/acceptance-results.json'), JSON.stringify({
    contract_schema_version: 2,
    results: [{ id: 'broken-exact-path', status: 'pass', applies: true }],
  }));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, false);
  assert.equal(result.evidence.present, 'pass');
  assert.equal(result.evidence.reachable, 'pass');
  assert.equal(result.evidence.enforced, 'fail');
  assert.ok(result.errors.some((error) => error.includes('passing probe broken-exact-path requires entrypoint')));
  assert.ok(result.errors.some((error) => error.includes('missing required result')));
});

test('check reports reachable independently when a canonical artifact is missing', (context) => {
  const root = fixture('reachable-independent');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.unlinkSync(path.join(root, 'docs/ai/anti-patterns.md'));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, false);
  assert.equal(result.evidence.present, 'fail');
  assert.equal(result.evidence.reachable, 'pass');
  assert.equal(result.evidence.enforced, 'unverified');
});

test('check fails closed when the repository scan budget truncates evidence', (context) => {
  const root = fixture('scan-budget-gate');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const result = checkProject(scanProject(root, { scanBudget: { maxDepth: 32, maxFiles: 2, maxFileBytes: 2 * 1024 * 1024 } }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('repository scan incomplete: file limit 2 reached')));
});

test('check keeps enforcement unverified when complete receipt fields have not been replayed', (context) => {
  const root = fixture('verified-enforcement-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/acceptance-contract.json'), 'utf8'));
  const results = contract.required_probe_families.map((family) => ({
    id: family.id,
    status: 'pass',
    applies: true,
    applicability_reason: 'The complete acceptance campaign selected this probe.',
    entrypoint: 'node path/to/real-delivery-check.mjs',
    negative_evidence: `2026-09-10 ${family.id} exited 1 with the expected diagnostic`,
    recovery_evidence: `2026-09-10 ${family.id} exited 0 after recovery`,
    remaining_boundary: 'This receipt does not prove a real client loaded the entrypoint.',
  }));
  fs.writeFileSync(path.join(root, 'docs/ai/acceptance-results.json'), JSON.stringify({
    contract_schema_version: contract.schema_version,
    results,
  }));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.enforced, 'unverified');
  assert.ok(result.warnings.some((warning) => warning.includes('does not replay their real entrypoints')));
});

test('preserves user content outside managed entrypoint blocks', (context) => {
  const root = fixture('preserve');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing rules\n\nKeep this sentence.\n');
  initialize(root);
  const content = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /Keep this sentence/);
  assert.equal((content.match(/ai-code-governance:start/g) ?? []).length, 1);
});

test('second initialization is idempotent', (context) => {
  const root = fixture('idempotent');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const before = fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8');
  const second = initialize(root);
  assert.deepEqual(second.applied.changed, []);
  assert.equal(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'), before);
});

test('detects adapter drift and force sync repairs only managed content', (context) => {
  const root = fixture('drift');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const cursor = path.join(root, '.cursor/rules/ai-code-governance.mdc');
  fs.appendFileSync(cursor, '\nmanual drift\n');
  assert.equal(checkProject(scanProject(root)).ok, false);
  const scan = scanProject(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json')));
  const blocked = planArtifacts(root, buildArtifacts(config, scan));
  assert.ok(blocked.conflicts.some((item) => item.includes('managed content changed')));
  const forced = planArtifacts(root, buildArtifacts(config, scan), { force: true });
  applyArtifactPlan(root, forced, { force: true });
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('preserves edited canonical files and synchronizes skill copies from canonical content', (context) => {
  const root = fixture('canonical-source');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({ ...value, clients: ['codex', 'claude-code'], governanceDepth: 'complete' }));

  const antiPatterns = path.join(root, 'docs/ai/anti-patterns.md');
  fs.appendFileSync(antiPatterns, '\n## Project fact\nPreserve this canonical edit.\n');
  assert.equal(checkProject(scanProject(root)).ok, true);

  const canonicalSkill = path.join(root, 'docs/ai/skills/generic-unknown/SKILL.md');
  fs.appendFileSync(canonicalSkill, '\nProject-specific canonical guidance.\n');
  assert.equal(checkProject(scanProject(root)).ok, false);
  const scan = scanProject(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));

  assert.match(fs.readFileSync(path.join(root, '.agents/skills/generic-unknown/SKILL.md'), 'utf8'), /Project-specific canonical guidance/);
  assert.match(fs.readFileSync(path.join(root, '.claude/skills/generic-unknown/SKILL.md'), 'utf8'), /Project-specific canonical guidance/);
  assert.match(fs.readFileSync(antiPatterns, 'utf8'), /Preserve this canonical edit/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('dry-run does not write files', (context) => {
  const root = fixture('dry-run');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const plan = planArtifacts(root, buildArtifacts(defaultConfig(scan), scan));
  const result = applyArtifactPlan(root, plan, { dryRun: true });
  assert.ok(result.changed.includes('AGENTS.md'));
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('transactional apply restores every generated file after verification fails', (context) => {
  const root = fixture('transactional-rollback');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing rules\nKeep this exact content.\n');
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const plan = planArtifacts(root, buildArtifacts(config, scan));
  assert.throws(() => applyArtifactPlan(root, plan, {
    transactional: true,
    verify: () => ({ ok: false, errors: ['injected verification failure'] }),
  }), /Post-apply verification failed/);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# Existing rules\nKeep this exact content.\n');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});

test('apply refuses a symlink ancestor inserted after planning', (context) => {
  const root = fixture('post-plan-symlink');
  const outside = fixture('post-plan-symlink-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const scan = scanProject(root);
  const plan = planArtifacts(root, buildArtifacts(defaultConfig(scan), scan));
  fs.symlinkSync(outside, path.join(root, '.cursor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => applyArtifactPlan(root, plan, { transactional: true }), /symbolic link/);
  assert.equal(fs.existsSync(path.join(outside, 'rules/ai-code-governance.mdc')), false);
});

test('unselected agents do not receive client-specific adapters', (context) => {
  const root = fixture('one-agent');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({ ...value, clients: ['codex'], governanceDepth: 'complete' }));
  assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(root, '.cursor')), false);
  assert.equal(fs.existsSync(path.join(root, '.claude')), false);
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/generic-unknown/SKILL.md')));
});

for (const scenario of [
  { name: 'claude-only', clients: ['claude-code'], claude: true, cursor: false },
  { name: 'cursor-only', clients: ['cursor'], claude: false, cursor: true },
  { name: 'claude-cursor', clients: ['claude-code', 'cursor'], claude: true, cursor: true },
  { name: 'generic-only', clients: ['generic'], claude: false, cursor: false },
]) {
  test(`generates the expected adapters for ${scenario.name}`, (context) => {
    const root = fixture(scenario.name);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    initialize(root, (value) => ({ ...value, clients: scenario.clients }));
    assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), scenario.claude);
    assert.equal(fs.existsSync(path.join(root, '.cursor/rules/ai-code-governance.mdc')), scenario.cursor);
    assert.equal(checkProject(scanProject(root)).ok, true);
  });
}

test('reconfiguration removes only deselected managed client artifacts', (context) => {
  const root = fixture('deselect-agent');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root, (value) => ({ ...value, governanceDepth: 'complete' }));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `${fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')}\n\n# User note\nKeep this.\n`);

  const scan = scanProject(root);
  const existing = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const config = { ...existing, clients: ['codex'] };
  const plan = planArtifacts(root, buildArtifacts(config, scan));
  applyArtifactPlan(root, plan);

  assert.equal(fs.existsSync(path.join(root, '.cursor/rules/ai-code-governance.mdc')), false);
  assert.equal(fs.existsSync(path.join(root, '.claude/skills/generic-unknown/SKILL.md')), false);
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /Keep this\./);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /ai-code-governance:start/);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('managed block merge accepts CRLF user content and preserves it outside the block', (context) => {
  const root = fixture('crlf');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing\r\n\r\nKeep CRLF.\r\n');
  initialize(root, (value) => ({ ...value, clients: ['codex'] }));
  const content = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /# Existing\r\n\r\nKeep CRLF\./);
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('link migration removes only the adapter link and preserves its target', (context) => {
  const root = fixture('link-migration');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'legacy-rules');
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'keep.txt'), 'keep');
  fs.symlinkSync(legacy, path.join(root, '.cursor/rules'), process.platform === 'win32' ? 'junction' : 'dir');
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const blocked = planArtifacts(root, buildArtifacts(config, scan));
  assert.ok(blocked.conflicts.some((item) => item.includes('--migrate-links')));
  const migrating = planArtifacts(root, buildArtifacts(config, scan), { migrateLinks: true });
  applyArtifactPlan(root, migrating, { migrateLinks: true, transactional: true });
  assert.ok(fs.existsSync(path.join(legacy, 'keep.txt')));
  assert.equal(fs.lstatSync(path.join(root, '.cursor/rules')).isSymbolicLink(), false);
  assert.ok(fs.existsSync(path.join(root, '.cursor/rules/ai-code-governance.mdc')));
});

test('link migration rejects a symlink reinserted after deletion without writing outside the repository', (context) => {
  const root = fixture('link-reinsert');
  const legacy = fixture('link-reinsert-legacy');
  const outside = fixture('link-reinsert-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(legacy, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.symlinkSync(legacy, path.join(root, '.cursor/rules'), process.platform === 'win32' ? 'junction' : 'dir');
  const scan = scanProject(root);
  const plan = planArtifacts(root, buildArtifacts(defaultConfig(scan), scan), { migrateLinks: true });
  const link = path.join(root, '.cursor/rules');
  const originalUnlink = fs.unlinkSync;
  let injected = false;
  fs.unlinkSync = function patchedUnlink(target, ...args) {
    const result = originalUnlink.call(this, target, ...args);
    if (!injected && target === link) {
      injected = true;
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return result;
  };
  try {
    assert.throws(() => applyArtifactPlan(root, plan, { migrateLinks: true, transactional: true }), /symbolic link/);
  } finally {
    fs.unlinkSync = originalUnlink;
  }
  assert.equal(injected, true);
  assert.equal(fs.readdirSync(outside).length, 0);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), legacy);
});

test('transactional link migration restores the original link after post-apply verification fails', (context) => {
  const root = fixture('link-rollback');
  const legacy = fixture('link-rollback-legacy');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(legacy, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'keep.txt'), 'keep');
  const link = path.join(root, '.cursor/rules');
  fs.symlinkSync(legacy, link, process.platform === 'win32' ? 'junction' : 'dir');
  const scan = scanProject(root);
  const plan = planArtifacts(root, buildArtifacts(defaultConfig(scan), scan), { migrateLinks: true });
  assert.throws(() => applyArtifactPlan(root, plan, {
    migrateLinks: true,
    transactional: true,
    verify: () => ({ ok: false, errors: ['injected verification failure'] }),
  }), /Post-apply verification failed/);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), legacy);
  assert.equal(fs.readFileSync(path.join(legacy, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
});

test('rejects unsafe manifest paths without touching files outside the repository', (context) => {
  const root = fixture('unsafe-manifest');
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });
  initialize(root);
  fs.writeFileSync(outside, 'preserve');
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.push({ path: '../outside.txt', ownership: 'full', kind: 'adapter', source: 'invalid', sha256: '0'.repeat(64) });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const scan = scanProject(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const plan = planArtifacts(root, buildArtifacts(config, scan), { force: true });
  assert.ok(plan.conflicts.some((item) => item.includes('safe repository-relative path')));
  assert.equal(checkProject(scan).ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve');
});
