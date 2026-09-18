import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBoundedRepositoryFile, assertNoLinkAncestor } from '../../preconditions.mjs';
import { writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { usageError } from '../../kernel/index.mjs';

export const TEST_CASE_SCHEMA_VERSION = 2;
export const TEST_CASE_LIMIT = 512 * 1024;
export const TEST_RESULT_STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_RUN'];
export const TEST_RESULT_CLASSIFICATIONS = ['automated', 'ai-simulated-human', 'manual-professional', 'real-user'];
export const TEST_DRIVERS = ['browser', 'api', 'device', 'terminal', 'mixed'];
export const TEST_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const TEST_COVERAGE_DIMENSIONS = [
  'smoke', 'functional', 'boundary', 'extreme', 'negative_input', 'state_transition',
  'authorization_isolation', 'contract', 'persistence', 'concurrency_idempotency',
  'resilience_recovery', 'compatibility', 'performance_capacity',
  'accessibility_usability', 'deployment_rollback',
];

const CASE_ID = /^[A-Z0-9][A-Z0-9_-]*-TC-[0-9]{3,}$/;
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(message) { throw usageError(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function exactFields(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unsupported fields: ${unknown.join(', ')}.`);
}
function nonempty(value, label, maximum = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(`${label} must be a bounded non-empty string.`);
  return value;
}
function list(value, label, { maximum = 1000, allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) fail(`${label} must be a bounded array.`);
  return value;
}
function stringList(value, label, options = {}) {
  list(value, label, options);
  for (const entry of value) nonempty(entry, label);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates.`);
  return value;
}
function safeRelative(value, label, { allowRoot = false } = {}) {
  if (allowRoot && value === '.') return value;
  if (typeof value !== 'string' || !isSafeRelative(value) || normalizeRelative(value) !== value || value.split('/').some((part) => part.toLowerCase() === '.git')) fail(`${label} must be a safe repository-relative path outside .git.`);
  return value;
}
function stableKey(value, label) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) fail(`${label} must be a stable identifier.`);
  return value;
}

function validateShared(manifest) {
  exactFields(manifest.shared, ['actors', 'environments', 'data'], 'manifest.shared');
  for (const section of ['actors', 'environments', 'data']) object(manifest.shared[section], `manifest.shared.${section}`);
  for (const [actorId, actor] of Object.entries(manifest.shared.actors)) {
    stableKey(actorId, 'actor id');
    exactFields(actor, ['role', 'goal', 'authority', 'familiarity', 'platform', 'accessibility'], `actor ${actorId}`);
    for (const field of ['role', 'goal', 'authority', 'familiarity', 'platform', 'accessibility']) nonempty(actor[field], `actor ${actorId}.${field}`);
  }
  for (const [environmentId, environment] of Object.entries(manifest.shared.environments)) {
    stableKey(environmentId, 'environment id');
    exactFields(environment, ['platform', 'entry', 'requirements'], `environment ${environmentId}`);
    nonempty(environment.platform, `environment ${environmentId}.platform`);
    nonempty(environment.entry, `environment ${environmentId}.entry`);
    stringList(environment.requirements, `environment ${environmentId}.requirements`);
  }
  for (const [dataId, data] of Object.entries(manifest.shared.data)) {
    stableKey(dataId, 'data id');
    exactFields(data, ['description', 'secretEnv'], `data ${dataId}`);
    nonempty(data.description, `data ${dataId}.description`);
    stringList(data.secretEnv, `data ${dataId}.secretEnv`);
    if (data.secretEnv.some((name) => !ENV_NAME.test(name))) fail(`data ${dataId}.secretEnv contains an invalid environment name.`);
  }
}

function validateAutomation(automation, caseId) {
  object(automation, `${caseId}.automation`);
  const common = ['kind', 'runPolicy'];
  if (!['agent', 'command', 'manual'].includes(automation.kind)) fail(`${caseId}.automation.kind must be agent, command, or manual.`);
  if (!['auto', 'manual-confirmation'].includes(automation.runPolicy)) fail(`${caseId}.automation.runPolicy must be auto or manual-confirmation.`);
  if (automation.kind === 'agent') {
    exactFields(automation, [...common, 'driver'], `${caseId}.automation`);
    if (!TEST_DRIVERS.includes(automation.driver)) fail(`${caseId}.automation.driver is unsupported.`);
  } else if (automation.kind === 'manual') {
    exactFields(automation, [...common, 'reason'], `${caseId}.automation`);
    nonempty(automation.reason, `${caseId}.automation.reason`);
    if (automation.runPolicy !== 'manual-confirmation') fail(`${caseId} manual automation requires manual-confirmation.`);
  } else {
    exactFields(automation, [...common, 'cwd', 'argv', 'timeoutSeconds', 'expectedExitCodes', 'requiredEnv', 'assertions'], `${caseId}.automation`);
    safeRelative(automation.cwd, `${caseId}.automation.cwd`, { allowRoot: true });
    stringList(automation.argv, `${caseId}.automation.argv`, { allowEmpty: false, maximum: 64 });
    if (!Number.isInteger(automation.timeoutSeconds) || automation.timeoutSeconds < 1 || automation.timeoutSeconds > 3600) fail(`${caseId}.automation.timeoutSeconds must be 1-3600.`);
    list(automation.expectedExitCodes, `${caseId}.automation.expectedExitCodes`, { allowEmpty: false, maximum: 16 });
    if (automation.expectedExitCodes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) fail(`${caseId}.automation.expectedExitCodes is invalid.`);
    stringList(automation.requiredEnv, `${caseId}.automation.requiredEnv`, { maximum: 64 });
    if (automation.requiredEnv.some((name) => !ENV_NAME.test(name))) fail(`${caseId}.automation.requiredEnv contains an invalid name.`);
    list(automation.assertions, `${caseId}.automation.assertions`, { allowEmpty: false, maximum: 64 });
    for (const assertion of automation.assertions) {
      exactFields(assertion, ['type', 'value'], `${caseId} assertion`);
      if (!['contains', 'not-contains', 'regex', 'file-exists'].includes(assertion.type)) fail(`${caseId} assertion type is unsupported.`);
      nonempty(assertion.value, `${caseId} assertion value`);
      if (assertion.type === 'file-exists') safeRelative(assertion.value, `${caseId} assertion path`);
    }
  }
}

export function validateTestCaseManifest(value, { executable = true } = {}) {
  exactFields(value, ['schemaVersion', 'scope', 'baselineVersion', 'locale', 'repositories', 'evidenceDir', 'shared', 'coverageDimensions', 'cases'], 'manifest');
  if (Buffer.byteLength(stableJson(value)) > TEST_CASE_LIMIT || value.schemaVersion !== TEST_CASE_SCHEMA_VERSION) fail(`Test-case manifest must use schemaVersion ${TEST_CASE_SCHEMA_VERSION} and stay within ${TEST_CASE_LIMIT} bytes.`);
  stableKey(value.scope, 'manifest.scope');
  nonempty(value.baselineVersion, 'manifest.baselineVersion', 128);
  if (!['en', 'zh-CN'].includes(value.locale)) fail('manifest.locale must be en or zh-CN.');
  stringList(value.repositories, 'manifest.repositories', { allowEmpty: false, maximum: 32 });
  for (const repository of value.repositories) safeRelative(repository, 'manifest repository', { allowRoot: true });
  safeRelative(value.evidenceDir, 'manifest.evidenceDir');
  validateShared(value);
  exactFields(value.coverageDimensions, TEST_COVERAGE_DIMENSIONS, 'manifest.coverageDimensions');
  const caseIds = new Set();
  list(value.cases, 'manifest.cases', { allowEmpty: !executable, maximum: 1000 });
  for (const [index, testCase] of value.cases.entries()) {
    const label = `manifest.cases[${index}]`;
    exactFields(testCase, ['id', 'title', 'priority', 'layer', 'tags', 'sourceIds', 'ctx', 'pre', 'steps', 'final', 'evidence', 'cleanup', 'automation'], label);
    if (typeof testCase.id !== 'string' || !CASE_ID.test(testCase.id) || caseIds.has(testCase.id)) fail(`${label}.id must be a unique stable <SCOPE>-TC-### ID.`);
    caseIds.add(testCase.id);
    nonempty(testCase.title, `${label}.title`);
    if (!TEST_PRIORITIES.includes(testCase.priority)) fail(`${label}.priority is unsupported.`);
    nonempty(testCase.layer, `${label}.layer`, 128);
    stringList(testCase.tags, `${label}.tags`, { allowEmpty: false, maximum: 32 });
    stringList(testCase.sourceIds, `${label}.sourceIds`, { allowEmpty: false, maximum: 64 });
    exactFields(testCase.ctx, ['actor', 'environment', 'data'], `${label}.ctx`);
    if (!Object.hasOwn(value.shared.actors, testCase.ctx.actor) || !Object.hasOwn(value.shared.environments, testCase.ctx.environment)) fail(`${label}.ctx references unknown shared context.`);
    stringList(testCase.ctx.data, `${label}.ctx.data`, { maximum: 32 });
    if (testCase.ctx.data.some((id) => !Object.hasOwn(value.shared.data, id))) fail(`${label}.ctx.data references unknown data.`);
    for (const field of ['pre', 'final', 'evidence', 'cleanup']) stringList(testCase[field], `${label}.${field}`, { maximum: 64 });
    list(testCase.steps, `${label}.steps`, { allowEmpty: false, maximum: 64 });
    for (const step of testCase.steps) {
      exactFields(step, ['do', 'target', 'value', 'see'], `${label}.step`);
      if (!['goto', 'click', 'input', 'select', 'upload', 'wait', 'refresh', 'request', 'query', 'command', 'observe'].includes(step.do)) fail(`${label}.step.do is unsupported.`);
      nonempty(step.target, `${label}.step.target`);
      if (step.value !== undefined) nonempty(step.value, `${label}.step.value`);
      stringList(step.see, `${label}.step.see`, { allowEmpty: false, maximum: 16 });
    }
    validateAutomation(testCase.automation, testCase.id);
  }
  for (const dimension of TEST_COVERAGE_DIMENSIONS) {
    const decision = value.coverageDimensions[dimension];
    exactFields(decision, ['status', 'caseIds', 'rationale'], `coverage ${dimension}`);
    if (!['COVERED', 'PARTIAL', 'GAP', 'NOT_APPLICABLE'].includes(decision.status)) fail(`coverage ${dimension}.status is invalid.`);
    stringList(decision.caseIds, `coverage ${dimension}.caseIds`, { maximum: 1000 });
    if (decision.caseIds.some((id) => !caseIds.has(id))) fail(`coverage ${dimension} references an unknown case.`);
    nonempty(decision.rationale, `coverage ${dimension}.rationale`);
  }
  if (executable && value.coverageDimensions.smoke.status === 'COVERED' && !value.coverageDimensions.smoke.caseIds.some((id) => value.cases.find((entry) => entry.id === id)?.tags.includes('smoke'))) fail('Smoke coverage must reference at least one smoke-tagged case.');
  return value;
}

export function defaultTestCaseManifest({ scope, locale = 'en', repositories = ['.'], evidenceDir }) {
  stableKey(scope, 'scope');
  return {
    schemaVersion: TEST_CASE_SCHEMA_VERSION,
    scope,
    baselineVersion: '1.0',
    locale,
    repositories,
    evidenceDir: evidenceDir ?? `reports/testing/evidence/${scope}`,
    shared: { actors: {}, environments: {}, data: {} },
    coverageDimensions: Object.fromEntries(TEST_COVERAGE_DIMENSIONS.map((dimension) => [dimension, { status: 'GAP', caseIds: [], rationale: 'Not assessed yet.' }])),
    cases: [],
  };
}

function selected(values, csv) {
  if (!csv) return true;
  const requested = new Set(String(csv).split(',').map((item) => item.trim()).filter(Boolean));
  return values.some((value) => requested.has(value));
}

export function selectTestCasePacket(manifest, filters = {}) {
  validateTestCaseManifest(manifest);
  const requestedCases = new Set(String(filters.cases ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  const known = new Set(manifest.cases.map((entry) => entry.id));
  const unknown = [...requestedCases].filter((id) => !known.has(id));
  if (unknown.length) fail(`Unknown test case IDs: ${unknown.join(', ')}.`);
  const cases = manifest.cases.filter((testCase) => (
    (!requestedCases.size || requestedCases.has(testCase.id))
    && selected([testCase.priority], filters.priorities)
    && selected(testCase.tags, filters.tags)
    && selected([testCase.automation.driver ?? testCase.automation.kind], filters.drivers)
  ));
  if (!cases.length) fail('Test-case selection matched no cases.');
  const actorIds = new Set(cases.map((entry) => entry.ctx.actor));
  const environmentIds = new Set(cases.map((entry) => entry.ctx.environment));
  const dataIds = new Set(cases.flatMap((entry) => entry.ctx.data));
  const base = {
    packetSchemaVersion: 1,
    scope: manifest.scope,
    baselineVersion: manifest.baselineVersion,
    manifestSha256: sha256(stableJson(manifest)),
    selectedCount: cases.length,
    shared: {
      actors: Object.fromEntries([...actorIds].sort().map((id) => [id, manifest.shared.actors[id]])),
      environments: Object.fromEntries([...environmentIds].sort().map((id) => [id, manifest.shared.environments[id]])),
      data: Object.fromEntries([...dataIds].sort().map((id) => [id, manifest.shared.data[id]])),
    },
    cases,
  };
  return { ...base, packetDigest: sha256(stableJson(base)) };
}

function safeEvidence(root, relative, label) {
  safeRelative(relative, label);
  const { bytes } = readBoundedRepositoryFile(root, relative, 32 * 1024 * 1024);
  return { path: relative, sha256: sha256(bytes), bytes: bytes.length };
}

function sessionProjection(session) {
  const { sessionDigest, recordedAt, ...projection } = session;
  return projection;
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    return fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail(`Result ledger is locked by another writer: ${lockPath}.`);
    throw error;
  }
}

function releaseLock(descriptor, lockPath) {
  try { fs.closeSync(descriptor); } finally {
    try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function recordTestCaseResults(root, { manifest, packet, external, ledgerPath }) {
  validateTestCaseManifest(manifest);
  exactFields(packet, ['packetSchemaVersion', 'scope', 'baselineVersion', 'manifestSha256', 'selectedCount', 'shared', 'cases', 'packetDigest'], 'packet');
  const { packetDigest, ...packetBase } = packet;
  if (packet.packetSchemaVersion !== 1 || packetDigest !== sha256(stableJson(packetBase)) || packet.manifestSha256 !== sha256(stableJson(manifest)) || packet.scope !== manifest.scope || packet.baselineVersion !== manifest.baselineVersion) fail('Test execution packet is stale or does not match the manifest.');
  if (!Number.isInteger(packet.selectedCount) || packet.selectedCount !== packet.cases.length || packet.cases.length === 0) fail('Test execution packet selectedCount is invalid.');
  const manifestCases = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const packetIds = new Set();
  for (const testCase of packet.cases) {
    if (!manifestCases.has(testCase.id) || packetIds.has(testCase.id) || stableJson(manifestCases.get(testCase.id)) !== stableJson(testCase)) fail('Test execution packet contains an unknown, duplicate, or modified case.');
    packetIds.add(testCase.id);
  }
  const expectedShared = {
    actors: Object.fromEntries([...new Set(packet.cases.map((entry) => entry.ctx.actor))].sort().map((id) => [id, manifest.shared.actors[id]])),
    environments: Object.fromEntries([...new Set(packet.cases.map((entry) => entry.ctx.environment))].sort().map((id) => [id, manifest.shared.environments[id]])),
    data: Object.fromEntries([...new Set(packet.cases.flatMap((entry) => entry.ctx.data))].sort().map((id) => [id, manifest.shared.data[id]])),
  };
  if (stableJson(packet.shared) !== stableJson(expectedShared)) fail('Test execution packet shared context does not match its selected cases.');
  exactFields(external, ['sessionId', 'scope', 'baselineVersion', 'manifestSha256', 'packetDigest', 'operator', 'method', 'startedAt', 'finishedAt', 'results'], 'external results');
  stableKey(external.sessionId, 'external sessionId');
  if (external.scope !== manifest.scope || external.baselineVersion !== manifest.baselineVersion || external.manifestSha256 !== packet.manifestSha256 || external.packetDigest !== packet.packetDigest) fail('External results must bind the exact scope, baseline, manifest, and packet digests.');
  for (const field of ['operator', 'method', 'startedAt', 'finishedAt']) nonempty(external[field], `external.${field}`, 512);
  list(external.results, 'external.results', { allowEmpty: false, maximum: 1000 });
  const selectedCases = new Map(packet.cases.map((entry) => [entry.id, entry]));
  const provided = new Map();
  for (const result of external.results) {
    exactFields(result, ['id', 'status', 'actual', 'durationSeconds', 'evidence', 'classification'], `result ${result?.id ?? '<unknown>'}`);
    if (!selectedCases.has(result.id) || provided.has(result.id) || !TEST_RESULT_STATUSES.includes(result.status)) fail('External results contain an unknown, duplicate, or invalid case result.');
    nonempty(result.actual, `result ${result.id}.actual`);
    if (!TEST_RESULT_CLASSIFICATIONS.includes(result.classification)) fail(`result ${result.id}.classification must identify automated, AI-simulated-human, manual-professional, or real-user evidence.`);
    if (typeof result.durationSeconds !== 'number' || !Number.isFinite(result.durationSeconds) || result.durationSeconds < 0) fail(`result ${result.id}.durationSeconds must be non-negative.`);
    list(result.evidence, `result ${result.id}.evidence`, { maximum: 64 });
    const evidence = result.evidence.map((relative) => safeEvidence(root, relative, `result ${result.id} evidence`));
    if (['PASS', 'FAIL'].includes(result.status) && !evidence.length) fail(`result ${result.id} requires durable evidence for ${result.status}.`);
    provided.set(result.id, { ...result, actual: result.actual.trim(), durationSeconds: Math.round(result.durationSeconds * 1000) / 1000, evidence });
  }
  const now = new Date().toISOString();
  const normalized = manifest.cases.map((testCase) => provided.get(testCase.id) ?? {
    id: testCase.id, status: 'NOT_RUN', classification: 'not-run', actual: selectedCases.has(testCase.id) ? 'Selected but no result was supplied.' : 'Not selected for this execution session.', durationSeconds: 0, evidence: [],
  });
  const baseSession = {
    sessionId: external.sessionId,
    scope: manifest.scope,
    baselineVersion: manifest.baselineVersion,
    manifestSha256: packet.manifestSha256,
    packetDigest: packet.packetDigest,
    operator: external.operator,
    method: external.method,
    startedAt: external.startedAt,
    finishedAt: external.finishedAt,
    recordedAt: now,
    results: normalized,
  };
  const session = { ...baseSession, sessionDigest: sha256(stableJson(sessionProjection(baseSession))) };
  safeRelative(ledgerPath, 'result ledger path');
  assertNoLinkAncestor(root, ledgerPath);
  const absolute = path.join(root, ledgerPath);
  const lockPath = `${absolute}.lock`;
  const lock = acquireLock(lockPath);
  try {
    let ledger = { schemaVersion: 1, scope: manifest.scope, sessions: [] };
    if (fs.existsSync(absolute)) {
      const bytes = readBoundedRepositoryFile(root, ledgerPath, TEST_CASE_LIMIT).bytes;
      ledger = JSON.parse(bytes.toString('utf8'));
      exactFields(ledger, ['schemaVersion', 'scope', 'sessions'], 'result ledger');
      if (ledger.schemaVersion !== 1 || ledger.scope !== manifest.scope || !Array.isArray(ledger.sessions)) fail('Result ledger does not match the manifest scope.');
    }
    const existing = ledger.sessions.find((entry) => entry.sessionId === session.sessionId);
    if (existing) {
      if (existing.sessionDigest !== session.sessionDigest) fail(`Session ${session.sessionId} already exists with different content.`);
      return { status: 'already-recorded', session: existing, ledger };
    }
    ledger.sessions.push(session);
    writeAtomicFile(absolute, `${stableJson(ledger)}\n`);
    return { status: 'recorded', session, ledger };
  } finally { releaseLock(lock, lockPath); }
}

export function renderTestReport(manifest, session, language = manifest.locale) {
  const zh = language === 'zh-CN';
  const counts = Object.fromEntries(TEST_RESULT_STATUSES.map((status) => [status, session.results.filter((entry) => entry.status === status).length]));
  const decision = counts.FAIL ? 'NO-GO' : counts.BLOCKED || counts.NOT_RUN ? 'NOT ASSESSED' : 'GO';
  const rows = session.results.map((entry) => `| \`${entry.id}\` | ${entry.status} | ${entry.classification} | ${String(entry.actual).replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${entry.evidence.map((item) => `\`${item.path}\``).join(', ') || '-'} |`).join('\n');
  return zh ? `# ${manifest.scope} 测试报告\n\n- 基线版本：\`${manifest.baselineVersion}\`\n- 清单摘要：\`${session.manifestSha256}\`\n- 执行会话：\`${session.sessionId}\`\n- 结论：\`${decision}\`\n\n## 状态汇总\n\n| PASS | FAIL | BLOCKED | SKIPPED | NOT_RUN |\n| ---: | ---: | ---: | ---: | ---: |\n| ${counts.PASS} | ${counts.FAIL} | ${counts.BLOCKED} | ${counts.SKIPPED} | ${counts.NOT_RUN} |\n\n## 用例结果\n\n| Case ID | 状态 | 证据类别 | 实际结果 | 证据 |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## 证据边界\n\nAI 模拟真人结果与真实用户结果必须分别记录；本报告不会把模拟结果计为真实用户证据。\n`
    : `# ${manifest.scope} test report\n\n- Baseline version: \`${manifest.baselineVersion}\`\n- Manifest digest: \`${session.manifestSha256}\`\n- Execution session: \`${session.sessionId}\`\n- Conclusion: \`${decision}\`\n\n## Status summary\n\n| PASS | FAIL | BLOCKED | SKIPPED | NOT_RUN |\n| ---: | ---: | ---: | ---: | ---: |\n| ${counts.PASS} | ${counts.FAIL} | ${counts.BLOCKED} | ${counts.SKIPPED} | ${counts.NOT_RUN} |\n\n## Case results\n\n| Case ID | Status | Evidence class | Actual | Evidence |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Evidence boundary\n\nSimulated-human and real-user results must remain separate; this report never counts simulation as real-user evidence.\n`;
}

export function safeTestingPath(root, relative) {
  safeRelative(relative, 'testing path');
  assertNoLinkAncestor(root, relative);
  return path.join(root, relative);
}

export function randomSessionId(prefix = 'session') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}
