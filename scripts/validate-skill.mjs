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
  const frontMatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
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
  ];
  for (const term of requiredTerms) {
    if (!skill.includes(term)) fail(`SKILL.md is missing required discovery term: ${term}`);
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
  check(
    registry.current_os_evidence?.windows === 'designed-not-run',
    'Windows evidence must remain designed-not-run until Windows validation exists.',
  );
  check(
    registry.current_os_evidence?.linux === 'designed-not-run',
    'Linux evidence must remain designed-not-run until Linux validation exists.',
  );
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

function runNegativeProbe(registry, acceptanceContract, generationProtocol) {
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

  const acceptanceBefore = failures.length;
  const brokenAcceptance = structuredClone(acceptanceContract);
  brokenAcceptance.required_probe_families = brokenAcceptance.required_probe_families.filter(
    (probe) => probe.id !== 'runtime-completion-freshness',
  );
  validateAcceptanceContract(brokenAcceptance);
  const acceptanceCaught = failures
    .slice(acceptanceBefore)
    .some((message) => message.includes('Missing acceptance probe family: runtime-completion-freshness'));
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

  if (!acceptanceCaught) fail('Negative probe did not catch an incomplete acceptance contract.');
  if (!failurePolicyCaught) fail('Negative probe did not catch a missing failure policy.');
  if (!resultManifestCaught) fail('Negative probe did not catch an incomplete project result manifest contract.');
  if (!generationProtocolCaught) fail('Negative probe did not catch an incomplete stack skill generation protocol.');
  if (duplicateCaught && brokenLinkCaught && acceptanceCaught && failurePolicyCaught && resultManifestCaught && generationProtocolCaught) {
    console.log('negative_probe=pass duplicate_pack=caught broken_link=caught acceptance_contract=caught failure_policy=caught result_manifest=caught generation_protocol=caught');
  }
}

validateEntryPoint();
const markdownCount = validateMarkdownLinks();
const generationProtocol = read('references/stack-skill-generation.md');
validateGenerationProtocol(generationProtocol);

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

if (process.argv.includes('--negative-probe') && registry && acceptanceContract) {
  runNegativeProbe(registry, acceptanceContract, generationProtocol);
}

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`skill_validation=pass markdown_files=${markdownCount} capability_packs=${registry.packs.length}`);
  console.log('os_evidence=macos:skill-structure-verified,windows:designed-not-run,linux:designed-not-run');
}
