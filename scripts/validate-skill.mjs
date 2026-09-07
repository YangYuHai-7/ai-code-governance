#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function markdownOutsideFences(text) {
  const kept = [];
  let fence = null;

  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
      } else if (marker[1][0] === fence) {
        fence = null;
      }
      continue;
    }
    if (!fence) kept.push(line);
  }

  return kept.join('\n');
}

function markdownFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.md')) found.push(absolute);
  }
  return found;
}

function markdownLinkTargets(text) {
  const targets = [];
  let cursor = 0;

  while (cursor < text.length) {
    const marker = text.indexOf('](', cursor);
    if (marker < 0) break;
    const end = text.indexOf(')', marker + 2);
    if (end < 0) break;
    targets.push(text.slice(marker + 2, end));
    cursor = end + 1;
  }

  return targets;
}

function validateLocalLink(sourceFile, target) {
  if (/^(?:[a-z]+:|#)/i.test(target) || target.includes('<')) return;
  const withoutFragment = target.split('#', 1)[0];
  if (!withoutFragment) return;
  const decoded = decodeURIComponent(withoutFragment);
  const resolved = path.resolve(path.dirname(sourceFile), decoded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${path.relative(root, sourceFile)} -> ${target}`);
  }
}

function validateMarkdownLinks() {
  const files = [
    path.join(root, 'SKILL.md'),
    path.join(root, 'README.md'),
    ...markdownFiles(path.join(root, 'references')),
  ];
  for (const file of files) {
    const text = markdownOutsideFences(fs.readFileSync(file, 'utf8'));
    for (const target of markdownLinkTargets(text)) {
      try {
        validateLocalLink(file, target);
      } catch (error) {
        fail(`Broken local link: ${error.message}`);
      }
    }
  }
  return files.length;
}

function validateEntryPoint() {
  const skill = read('SKILL.md');
  const frontMatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontMatter) {
    fail('SKILL.md is missing YAML front matter.');
    return;
  }
  if (frontMatter[1].includes('\t')) fail('SKILL.md front matter contains a tab.');
  if (!/^name:\s*ai-code-governance\s*$/m.test(frontMatter[1])) {
    fail('SKILL.md name must be ai-code-governance.');
  }

  const requiredTerms = [
    'macOS',
    'Windows',
    'Linux',
    'React',
    'Vue',
    'Angular',
    'Node.js',
    'Java',
    'Android',
    'iOS',
    'capability-pack-registry.json',
    'stack-skill-generation.md',
    'stack-standard-source-coverage',
    'stack-skill-coverage',
    'business-pattern-routing',
    'continuous-skill-evolution.md',
    'feature-skill-harvest-freshness',
    'capability-promotion-evidence',
    'skill-implementation-drift',
    'canonical-capability-reuse',
    'workflow-integration-registry.json',
    'workflow-integrations.md',
    'change-authority-single-source',
    'selective-execution-capability',
    'aicg init',
    'aicg check',
    'aicg sync',
    'agent-registry.json',
    '.ai-governance/manifest.json',
    'initializer.md',
  ];
  for (const term of requiredTerms) {
    if (!skill.includes(term)) fail(`SKILL.md is missing required discovery term: ${term}`);
  }
}

function validateCliPackage(pkg) {
  check(pkg.name === 'ai-code-governance', 'package.json name must be ai-code-governance.');
  check(pkg.version === '0.1.0', 'Initial CLI version must be 0.1.0.');
  check(pkg.type === 'module', 'CLI package must use ESM.');
  check(pkg.bin?.aicg === 'bin/aicg.js', 'package.json must expose the aicg binary.');
  check(pkg.engines?.node === '>=22', 'CLI must require Node.js >=22.');
  check(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'CLI must not add runtime dependencies.');
  for (const script of ['test', 'validate:skill', 'validate', 'smoke', 'smoke:package']) {
    check(typeof pkg.scripts?.[script] === 'string', `package.json lacks script: ${script}`);
  }
  check(fs.existsSync(path.join(root, 'bin/aicg.js')), 'aicg binary is missing.');
  for (const module of ['cli.mjs', 'scanner.mjs', 'generator.mjs', 'checker.mjs', 'managed-files.mjs']) {
    check(fs.existsSync(path.join(root, 'src', module)), `CLI module is missing: src/${module}`);
  }
}

function validateAgentRegistry(registry) {
  check(registry.schema_version === 1, 'Agent registry schema_version must be 1.');
  const ids = new Set();
  for (const agent of registry.agents ?? []) {
    check(typeof agent.id === 'string' && agent.id.length > 0, 'Agent registry entry lacks id.');
    check(!ids.has(agent.id), `Duplicate agent registry id: ${agent.id}`);
    ids.add(agent.id);
    check(typeof agent.label === 'string' && agent.label.length > 0, `${agent.id} lacks label.`);
    check(Array.isArray(agent.detect_commands), `${agent.id} lacks detect_commands.`);
    check(typeof agent.instruction_entry === 'string', `${agent.id} lacks instruction_entry.`);
    check(Array.isArray(agent.skill_directories), `${agent.id} lacks skill_directories.`);
    check(Array.isArray(agent.rule_directories), `${agent.id} lacks rule_directories.`);
    for (const directory of [...(agent.skill_directories ?? []), ...(agent.rule_directories ?? [])]) {
      check(!/\.\.|^[\\/]/.test(directory), `${agent.id} contains an unsafe adapter directory: ${directory}`);
    }
  }
  for (const id of ['codex', 'claude-code', 'cursor', 'generic']) {
    check(ids.has(id), `Missing agent registry entry: ${id}`);
  }
}

function validateNoLinkAdapters() {
  const markdown = [path.join(root, 'SKILL.md'), path.join(root, 'README.md'), ...markdownFiles(path.join(root, 'references'))];
  const forbidden = [
    { pattern: /\bln\s+-s\b/, label: 'ln -s adapter command' },
    { pattern: /New-Item\s+-ItemType\s+Junction/i, label: 'PowerShell junction command' },
    { pattern: /adapter_mode:\s*(?:symlink|junction)/i, label: 'link adapter mode' },
  ];
  for (const file of markdown) {
    const content = fs.readFileSync(file, 'utf8');
    for (const item of forbidden) {
      check(!item.pattern.test(content), `${path.relative(root, file)} contains forbidden ${item.label}.`);
    }
  }
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.mjs'))) {
    const content = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    check(!/\b(?:symlinkSync|linkSync)\s*\(/.test(content), `src/${file} creates a filesystem link.`);
  }
}

function validateGenerationProtocol(protocol) {
  for (const term of [
    'stack-sources.json',
    'stack-skill-map.json',
    'industry-standard',
    'business-invariant',
    'forward-test',
    'stack-standard-source-coverage',
    'stack-skill-coverage',
    'business-pattern-routing',
    'secure-high-risk-interface',
    'evaluate-infrastructure-need',
    'source_ids',
    'activation_threshold',
    'evidence_ids',
  ]) {
    check(protocol.includes(term), `Stack skill generation protocol lacks required term: ${term}`);
  }
}

function validateEvolutionProtocol(protocol) {
  for (const term of [
    'capability-evolution.json',
    'product_change_fingerprint',
    'governance_output_fingerprint',
    'update-existing',
    'create-new',
    'candidate-recorded',
    'no-skill-with-reason',
    'feature-skill-harvest-freshness',
    'capability-promotion-evidence',
    'skill-implementation-drift',
    'canonical-capability-reuse',
    'use-project-http-client',
    'authorize-project-operation',
  ]) {
    check(protocol.includes(term), `Continuous skill evolution protocol lacks required term: ${term}`);
  }
}

function validateWorkflowProtocol(protocol) {
  for (const term of [
    'project-native',
    'external-primary',
    'coordinated',
    'external-bridge',
    'workflow-integrations.yaml',
    'current_product_behavior',
    'implementation_task_list',
    'workflow-source-freshness',
    'change-authority-single-source',
    'execution-plan-single-authority',
    'external-change-runtime-linkage',
    'external-archive-completion-gate',
    'selective-execution-capability',
  ]) {
    check(protocol.includes(term), `Workflow integration protocol lacks required term: ${term}`);
  }
}

function check(condition, message) {
  if (!condition) fail(message);
}

function validateRegistryHeader(registry) {
  check(registry.schema_version === 1, 'Registry schema_version must be 1.');
  check(registry.product_line === 'ai-code-governance', 'Registry product_line is invalid.');
  check(
    registry.os_targets?.join(',') === 'macos,windows,linux',
    'Registry os_targets must list macos, windows, linux.',
  );
  for (const os of ['macos', 'windows', 'linux']) {
    check(
      registry.current_os_evidence?.[os] === 'cli-ci-verified-node22-node24',
      `${os} must retain Node.js 22/24 CLI CI evidence.`,
    );
  }
  const source = registry.os_evidence_source ?? {};
  check(source.workflow === '.github/workflows/ci.yml', 'OS evidence must name the CI workflow.');
  check(/^https:\/\/github\.com\/.+\/actions\/runs\/\d+$/.test(source.last_verified_run ?? ''), 'OS evidence must name a successful Actions run.');
  check(/^[a-f0-9]{40}$/.test(source.last_verified_commit ?? ''), 'OS evidence must name a verified commit.');
  check(Array.isArray(source.scope) && source.scope.includes('installed-tarball-smoke'), 'OS evidence must include installed tarball smoke.');
  check(/remain unverified/i.test(source.boundary ?? ''), 'OS evidence must preserve real-client boundaries.');
}

function validatePack(pack, ids, evidence, lifecycles) {
  check(!ids.has(pack.id), `Duplicate capability pack id: ${pack.id}`);
  ids.add(pack.id);
  check(evidence.has(pack.evidence), `Invalid evidence for ${pack.id}: ${pack.evidence}`);
  check(lifecycles.has(pack.lifecycle), `Invalid lifecycle for ${pack.id}: ${pack.lifecycle}`);
  check(Array.isArray(pack.detect?.manifest_any), `${pack.id} lacks detect.manifest_any.`);
  check(Array.isArray(pack.detect?.dependency_any), `${pack.id} lacks detect.dependency_any.`);
  check(
    Array.isArray(pack.specialists) && pack.specialists.length > 0,
    `${pack.id} must name at least one specialist.`,
  );
  check(
    Array.isArray(pack.validation_sources) && pack.validation_sources.length > 0,
    `${pack.id} must name validation sources.`,
  );
}

function expectedPacks() {
  return {
    'v3.0': ['frontend-react', 'frontend-vue', 'frontend-angular', 'backend-node', 'backend-java'],
    'v3.1': ['frontend-svelte', 'backend-python', 'backend-go', 'backend-php'],
    v4: ['platform-dotnet', 'platform-android', 'platform-ios', 'platform-hybrid-mobile', 'platform-desktop', 'platform-c-cpp'],
  };
}

function validateExpectedPacks(registry, expected) {
  for (const [release, expectedIds] of Object.entries(expected)) {
    for (const id of expectedIds) {
      const pack = registry.packs.find((candidate) => candidate.id === id);
      check(Boolean(pack), `Missing ${release} capability pack: ${id}`);
      check(!pack || pack.release === release, `${id} must belong to ${release}, found ${pack?.release}.`);
    }
  }
}

function validateReleaseEvidence(registry, expected) {
  for (const id of expected['v3.0']) {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    check(
      !pack || (pack.lifecycle === 'active' && pack.evidence === 'supported'),
      `${id} must be active/supported until certification evidence exists.`,
    );
  }
  for (const id of [...expected['v3.1'], ...expected.v4]) {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    check(pack?.evidence !== 'certified', `${id} cannot be certified without release evidence.`);
  }
}

function validateRegistry(registry) {
  const evidence = new Set(registry.evidence_levels);
  const lifecycles = new Set(registry.lifecycle_states);
  const ids = new Set();
  const expected = expectedPacks();

  validateRegistryHeader(registry);
  for (const pack of registry.packs ?? []) validatePack(pack, ids, evidence, lifecycles);
  validateExpectedPacks(registry, expected);
  validateReleaseEvidence(registry, expected);
}

function validateWorkflowRegistry(registry) {
  check(registry.schema_version === 1, 'Workflow registry schema_version must be 1.');
  check(
    registry.product_line === 'ai-code-governance',
    'Workflow registry product_line is invalid.',
  );

  const evidence = new Set(registry.evidence_levels ?? []);
  const lifecycles = new Set(registry.lifecycle_states ?? []);
  const ids = new Set();

  for (const integration of registry.integrations ?? []) {
    check(!ids.has(integration.id), `Duplicate workflow integration id: ${integration.id}`);
    ids.add(integration.id);
    check(
      ['change-governance', 'execution-discipline'].includes(integration.kind),
      `Invalid workflow integration kind for ${integration.id}: ${integration.kind}`,
    );
    check(evidence.has(integration.evidence), `Invalid workflow evidence for ${integration.id}.`);
    check(lifecycles.has(integration.lifecycle), `Invalid workflow lifecycle for ${integration.id}.`);
    check(
      Array.isArray(integration.upstream?.official_urls) &&
        integration.upstream.official_urls.length > 0 &&
        integration.upstream.official_urls.every((url) => /^https:\/\//.test(url)),
      `${integration.id} must name official upstream URLs.`,
    );
    check(
      integration.upstream?.refresh_required === true,
      `${integration.id} must require upstream refresh.`,
    );
    check(
      typeof integration.upstream?.license === 'string' && integration.upstream.license.length > 0,
      `${integration.id} must record an upstream license.`,
    );
    check(
      /^\d{4}-\d{2}-\d{2}$/.test(integration.upstream?.source_checked_at ?? ''),
      `${integration.id} must record a source checked date.`,
    );
    check(
      integration.upstream?.version_policy === 'observe-target-installation',
      `${integration.id} must observe the target installation version.`,
    );
    const detectionSignals = [
      ...(integration.detect?.path_any ?? []),
      ...(integration.detect?.command_any ?? []),
      ...(integration.detect?.native_skill_any ?? []),
    ];
    check(detectionSignals.length > 0, `${integration.id} must define a detection signal.`);
    check(
      Array.isArray(integration.capabilities) && integration.capabilities.length > 0,
      `${integration.id} must name capabilities.`,
    );
    check(
      Array.isArray(integration.overlaps) && integration.overlaps.length > 0,
      `${integration.id} must name overlap risks.`,
    );
    check(
      typeof integration.authority_rule === 'string' && integration.authority_rule.length > 0,
      `${integration.id} must define an authority rule.`,
    );
    check(
      Array.isArray(integration.validation_sources) && integration.validation_sources.length > 0,
      `${integration.id} must name validation sources.`,
    );
  }

  for (const id of ['openspec-change-governance', 'superpowers-execution-discipline']) {
    check(ids.has(id), `Missing workflow integration: ${id}`);
  }
}

const requiredProbeIds = [
  'broken-exact-path',
  'empty-glob',
  'required-profile-set',
  'client-selection-adapter-parity',
  'routing-disambiguation',
  'capability-unreachable',
  'stack-standard-source-coverage',
  'stack-skill-coverage',
  'business-pattern-routing',
  'feature-skill-harvest-freshness',
  'capability-promotion-evidence',
  'skill-implementation-drift',
  'canonical-capability-reuse',
  'endpoint-wrong-method',
  'source-frontmatter-bad-path',
  'memory-owner-mismatch',
  'checker-internal-error',
  'strict-runtime-invalid-task',
  'runtime-completion-freshness',
  'runtime-complete-single-entry',
  'hook-tool-payload-classification',
  'opaque-write-git-cross-check',
  'stop-verification-closure',
  'ack-atomic-single-consume',
  'precommit-entrypoint-replay',
  'lifecycle-maintenance-metadata',
  'workflow-source-freshness',
  'change-authority-single-source',
  'execution-plan-single-authority',
  'external-change-runtime-linkage',
  'external-archive-completion-gate',
  'selective-execution-capability',
  'generated-adapter-no-links',
  'managed-adapter-drift',
  'initializer-idempotence',
  'unmanaged-file-preservation',
  'noninteractive-required-input',
  'agent-assist-fallback',
];

function validateAcceptanceContract(contract) {
  check(contract.schema_version === 2, 'Acceptance contract schema_version must be 2.');
  const states = contract.claim_states ?? {};
  for (const state of ['present', 'reachable', 'enforced', 'real_client_verified']) {
    check(
      typeof states[state] === 'string' && states[state].length > 0,
      `Acceptance contract lacks claim state: ${state}`,
    );
  }

  const failurePolicy = contract.failure_policy ?? {};
  for (const policy of [
    'delivery_checker_exception',
    'ambient_hook_exception',
    'optional_environment_dependency',
  ]) {
    check(
      typeof failurePolicy[policy] === 'string' && failurePolicy[policy].length > 0,
      `Acceptance contract lacks failure policy: ${policy}`,
    );
  }

  const evidence = contract.evidence_required ?? [];
  for (const item of [
    'real_entrypoint',
    'negative_exit_and_diagnostic',
    'recovery_exit_and_diagnostic',
    'remaining_boundary',
  ]) {
    check(evidence.includes(item), `Acceptance contract lacks evidence requirement: ${item}`);
  }

  const manifest = contract.project_result_manifest ?? {};
  check(
    typeof manifest.contract_path === 'string' && manifest.contract_path.length > 0,
    'Acceptance contract lacks project contract snapshot path.',
  );
  check(
    typeof manifest.recommended_path === 'string' && manifest.recommended_path.length > 0,
    'Acceptance contract lacks project result manifest path.',
  );
  for (const status of ['pass', 'fail', 'not-applicable', 'unverified']) {
    check(
      Array.isArray(manifest.allowed_statuses) && manifest.allowed_statuses.includes(status),
      `Acceptance result manifest lacks allowed status: ${status}`,
    );
  }
  for (const field of [
    'id',
    'status',
    'applies',
    'applicability_reason',
    'entrypoint',
    'negative_evidence',
    'recovery_evidence',
    'remaining_boundary',
  ]) {
    check(
      Array.isArray(manifest.required_fields) && manifest.required_fields.includes(field),
      `Acceptance result manifest lacks required field: ${field}`,
    );
  }
  check(
    typeof manifest.coverage === 'string' && manifest.coverage.length > 0,
    'Acceptance contract lacks project result coverage rules.',
  );

  const probes = contract.required_probe_families ?? [];
  const ids = new Set();
  for (const probe of probes) {
    check(typeof probe.id === 'string' && probe.id.length > 0, 'Acceptance probe lacks id.');
    check(!ids.has(probe.id), `Duplicate acceptance probe id: ${probe.id}`);
    ids.add(probe.id);
    for (const field of [
      'applies_when',
      'negative_case',
      'expected_failure',
      'recovery_case',
      'expected_recovery',
      'proves',
    ]) {
      check(
        typeof probe[field] === 'string' && probe[field].length > 0,
        `${probe.id} lacks ${field}.`,
      );
    }
  }
  for (const id of requiredProbeIds) check(ids.has(id), `Missing acceptance probe family: ${id}`);
}

function runNegativeProbe(
  registry,
  agentRegistry,
  workflowRegistry,
  acceptanceContract,
  generationProtocol,
  evolutionProtocol,
  workflowProtocol,
) {
  const before = failures.length;
  const broken = structuredClone(registry);
  broken.packs.push(structuredClone(broken.packs[0]));
  validateRegistry(broken);
  const duplicateCaught = failures.slice(before).some((message) => message.includes('Duplicate capability pack id'));
  failures.splice(before);

  let brokenLinkCaught = false;
  try {
    validateLocalLink(path.join(root, 'SKILL.md'), 'references/does-not-exist.md');
  } catch {
    brokenLinkCaught = true;
  }

  if (!duplicateCaught) fail('Negative probe did not catch a duplicate capability pack.');
  if (!brokenLinkCaught) fail('Negative probe did not catch a broken local link.');

  const agentRegistryBefore = failures.length;
  const brokenAgentRegistry = structuredClone(agentRegistry);
  brokenAgentRegistry.agents.push(structuredClone(brokenAgentRegistry.agents[0]));
  validateAgentRegistry(brokenAgentRegistry);
  const agentRegistryCaught = failures
    .slice(agentRegistryBefore)
    .some((message) => message.includes('Duplicate agent registry id'));
  failures.splice(agentRegistryBefore);

  const workflowRegistryBefore = failures.length;
  const brokenWorkflowRegistry = structuredClone(workflowRegistry);
  brokenWorkflowRegistry.integrations.push(structuredClone(brokenWorkflowRegistry.integrations[0]));
  validateWorkflowRegistry(brokenWorkflowRegistry);
  const workflowRegistryCaught = failures
    .slice(workflowRegistryBefore)
    .some((message) => message.includes('Duplicate workflow integration id'));
  failures.splice(workflowRegistryBefore);

  const workflowSourceBefore = failures.length;
  const staleWorkflowRegistry = structuredClone(workflowRegistry);
  staleWorkflowRegistry.integrations[0].upstream.source_checked_at = '';
  validateWorkflowRegistry(staleWorkflowRegistry);
  const workflowSourceCaught = failures
    .slice(workflowSourceBefore)
    .some((message) => message.includes('must record a source checked date'));
  failures.splice(workflowSourceBefore);

  const acceptanceBefore = failures.length;
  const brokenAcceptance = structuredClone(acceptanceContract);
  brokenAcceptance.required_probe_families = brokenAcceptance.required_probe_families.filter(
    (probe) => probe.id !== 'selective-execution-capability',
  );
  validateAcceptanceContract(brokenAcceptance);
  const acceptanceCaught = failures
    .slice(acceptanceBefore)
    .some((message) => message.includes('Missing acceptance probe family: selective-execution-capability'));
  failures.splice(acceptanceBefore);

  const failurePolicyBefore = failures.length;
  const brokenPolicy = structuredClone(acceptanceContract);
  delete brokenPolicy.failure_policy.delivery_checker_exception;
  validateAcceptanceContract(brokenPolicy);
  const failurePolicyCaught = failures
    .slice(failurePolicyBefore)
    .some((message) => message.includes('Acceptance contract lacks failure policy: delivery_checker_exception'));
  failures.splice(failurePolicyBefore);

  const resultManifestBefore = failures.length;
  const brokenResultManifest = structuredClone(acceptanceContract);
  brokenResultManifest.project_result_manifest.required_fields =
    brokenResultManifest.project_result_manifest.required_fields.filter(
      (field) => field !== 'negative_evidence',
    );
  validateAcceptanceContract(brokenResultManifest);
  const resultManifestCaught = failures
    .slice(resultManifestBefore)
    .some((message) => message.includes('Acceptance result manifest lacks required field: negative_evidence'));
  failures.splice(resultManifestBefore);

  const generationProtocolBefore = failures.length;
  const brokenGenerationProtocol = generationProtocol.replace('business-pattern-routing', 'removed-business-probe');
  validateGenerationProtocol(brokenGenerationProtocol);
  const generationProtocolCaught = failures
    .slice(generationProtocolBefore)
    .some((message) => message.includes('Stack skill generation protocol lacks required term: business-pattern-routing'));
  failures.splice(generationProtocolBefore);

  const evolutionProtocolBefore = failures.length;
  const brokenEvolutionProtocol = evolutionProtocol.replace(
    'feature-skill-harvest-freshness',
    'removed-harvest-probe',
  );
  validateEvolutionProtocol(brokenEvolutionProtocol);
  const evolutionProtocolCaught = failures
    .slice(evolutionProtocolBefore)
    .some((message) => message.includes('Continuous skill evolution protocol lacks required term: feature-skill-harvest-freshness'));
  failures.splice(evolutionProtocolBefore);

  const workflowProtocolBefore = failures.length;
  const brokenWorkflowProtocol = workflowProtocol.replace(
    'change-authority-single-source',
    'removed-authority-probe',
  );
  validateWorkflowProtocol(brokenWorkflowProtocol);
  const workflowProtocolCaught = failures
    .slice(workflowProtocolBefore)
    .some((message) => message.includes('Workflow integration protocol lacks required term: change-authority-single-source'));
  failures.splice(workflowProtocolBefore);

  if (!acceptanceCaught) fail('Negative probe did not catch an incomplete acceptance contract.');
  if (!failurePolicyCaught) fail('Negative probe did not catch a missing failure policy.');
  if (!resultManifestCaught) fail('Negative probe did not catch an incomplete project result manifest contract.');
  if (!generationProtocolCaught) fail('Negative probe did not catch an incomplete stack skill generation protocol.');
  if (!evolutionProtocolCaught) fail('Negative probe did not catch an incomplete continuous skill evolution protocol.');
  if (!workflowRegistryCaught) fail('Negative probe did not catch a duplicate workflow integration.');
  if (!agentRegistryCaught) fail('Negative probe did not catch a duplicate agent registry entry.');
  if (!workflowSourceCaught) fail('Negative probe did not catch missing workflow source freshness.');
  if (!workflowProtocolCaught) fail('Negative probe did not catch an incomplete workflow integration protocol.');
  if (duplicateCaught && brokenLinkCaught && agentRegistryCaught && workflowRegistryCaught && workflowSourceCaught && acceptanceCaught && failurePolicyCaught && resultManifestCaught && generationProtocolCaught && evolutionProtocolCaught && workflowProtocolCaught) {
    console.log('negative_probe=pass duplicate_pack=caught agent_registry=caught duplicate_integration=caught workflow_source=caught broken_link=caught acceptance_contract=caught failure_policy=caught result_manifest=caught generation_protocol=caught evolution_protocol=caught workflow_protocol=caught');
  }
}

validateEntryPoint();
const markdownCount = validateMarkdownLinks();
validateNoLinkAdapters();
let cliPackage;
try {
  cliPackage = JSON.parse(read('package.json'));
  validateCliPackage(cliPackage);
} catch (error) {
  fail(`package.json is not valid: ${error.message}`);
}

let agentRegistry;
try {
  agentRegistry = JSON.parse(read('assets/agent-registry.json'));
  validateAgentRegistry(agentRegistry);
} catch (error) {
  fail(`Agent registry is not valid JSON: ${error.message}`);
}
const generationProtocol = read('references/stack-skill-generation.md');
validateGenerationProtocol(generationProtocol);
const evolutionProtocol = read('references/continuous-skill-evolution.md');
validateEvolutionProtocol(evolutionProtocol);
const workflowProtocol = read('references/workflow-integrations.md');
validateWorkflowProtocol(workflowProtocol);

let registry;
try {
  registry = JSON.parse(read('assets/capability-pack-registry.json'));
  validateRegistry(registry);
} catch (error) {
  fail(`Capability registry is not valid JSON: ${error.message}`);
}

let acceptanceContract;
try {
  acceptanceContract = JSON.parse(read('assets/acceptance-contract.json'));
  validateAcceptanceContract(acceptanceContract);
} catch (error) {
  fail(`Acceptance contract is not valid JSON: ${error.message}`);
}

let workflowRegistry;
try {
  workflowRegistry = JSON.parse(read('assets/workflow-integration-registry.json'));
  validateWorkflowRegistry(workflowRegistry);
} catch (error) {
  fail(`Workflow integration registry is not valid JSON: ${error.message}`);
}

if (process.argv.includes('--negative-probe') && registry && agentRegistry && workflowRegistry && acceptanceContract) {
  runNegativeProbe(
    registry,
    agentRegistry,
    workflowRegistry,
    acceptanceContract,
    generationProtocol,
    evolutionProtocol,
    workflowProtocol,
  );
}

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log(
    `skill_validation=pass markdown_files=${markdownCount} agents=${agentRegistry.agents.length} capability_packs=${registry.packs.length} workflow_integrations=${workflowRegistry.integrations.length}`,
  );
  console.log(`os_evidence=${Object.entries(registry.current_os_evidence).map(([os, state]) => `${os}:${state}`).join(',')}`);
}
