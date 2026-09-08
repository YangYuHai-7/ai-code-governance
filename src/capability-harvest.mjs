import path from 'node:path';
import { GENERATED_MARKER } from './constants.mjs';
import { isSafeRelative, normalizeRelative, readText, sha256, stableJson, unique, usageError } from './utils.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CAPABILITY_STATES = new Set(['candidate', 'adopted', 'superseded', 'retired']);
const HARVEST_OUTCOMES = new Set(['candidate-recorded', 'adopted-promoted', 'no-skill-with-reason', 'review-required', 'not-run']);
const HARVEST_VERIFICATION_STATES = new Set(['not-run-by-harvest', 'command-passed', 'unverified']);

function reviewDueDate() {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  return due.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSafeCapabilityPath(value) {
  return typeof value === 'string' && isSafeRelative(value) && !value.includes('`');
}

function isRegexStart(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.kind === 'identifier') return ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'yield', 'await'].includes(previous.value);
  return ['(', '[', '{', '=', ':', ',', ';', '!', '?', '&&', '||', '=>'].includes(previous.value);
}

function sourceTokens(content) {
  const tokens = [];
  let index = 0;
  while (index < content.length) {
    const current = content[index];
    const next = content[index + 1];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      index = content.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      index = end === -1 ? content.length : end + 2;
      continue;
    }
    if (current === '/' && isRegexStart(tokens)) {
      index += 1;
      let characterClass = false;
      while (index < content.length) {
        if (content[index] === '\\') {
          index += 2;
          continue;
        }
        if (content[index] === '[') characterClass = true;
        if (content[index] === ']') characterClass = false;
        if (content[index] === '/' && !characterClass) {
          index += 1;
          while (/[a-z]/i.test(content[index] ?? '')) index += 1;
          break;
        }
        if (content[index] === '\n') break;
        index += 1;
      }
      continue;
    }
    if (current === '\'' || current === '"') {
      const quote = current;
      let value = '';
      index += 1;
      while (index < content.length && content[index] !== quote) {
        if (content[index] === '\\') {
          value += content[index + 1] ?? '';
          index += 2;
        } else {
          value += content[index];
          index += 1;
        }
      }
      if (content[index] === quote) index += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (current === '`') {
      index += 1;
      while (index < content.length && content[index] !== '`') {
        index += content[index] === '\\' ? 2 : 1;
      }
      if (content[index] === '`') index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(current)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/.test(content[index] ?? '')) index += 1;
      tokens.push({ kind: 'identifier', value: content.slice(start, index) });
      continue;
    }
    const twoCharacter = content.slice(index, index + 2);
    if (['=>', '&&', '||', '?.', '??'].includes(twoCharacter)) {
      tokens.push({ kind: 'punctuation', value: twoCharacter });
      index += 2;
      continue;
    }
    tokens.push({ kind: 'punctuation', value: current });
    index += 1;
  }
  return tokens;
}

function tokenIs(tokens, index, value, kind = null) {
  const token = tokens[index];
  return token?.value === value && (!kind || token.kind === kind);
}

function axiosBindings(tokens) {
  const bindings = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokenIs(tokens, index, 'import', 'identifier') && tokens[index + 1]?.kind === 'identifier') {
      const binding = tokens[index + 1].value;
      for (let cursor = index + 2; cursor < Math.min(tokens.length - 1, index + 20); cursor += 1) {
        if (tokenIs(tokens, cursor, ';')) break;
        if (tokenIs(tokens, cursor, 'from', 'identifier') && tokenIs(tokens, cursor + 1, 'axios', 'string')) {
          bindings.add(binding);
          break;
        }
      }
    }
    if (['const', 'let', 'var'].includes(tokens[index]?.value) && tokens[index + 1]?.kind === 'identifier'
      && tokenIs(tokens, index + 2, '=') && tokenIs(tokens, index + 3, 'require', 'identifier')
      && tokenIs(tokens, index + 4, '(') && tokenIs(tokens, index + 5, 'axios', 'string')) {
      bindings.add(tokens[index + 1].value);
    }
  }
  return bindings;
}

function isAxiosCreateCall(tokens, index, bindings) {
  return bindings.has(tokens[index]?.value)
    && tokenIs(tokens, index + 1, '.')
    && tokenIs(tokens, index + 2, 'create', 'identifier')
    && tokenIs(tokens, index + 3, '(');
}

function declaredAxiosClients(tokens, bindings) {
  const clients = new Set();
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!['const', 'let', 'var'].includes(tokens[index]?.value) || tokens[index + 1]?.kind !== 'identifier') continue;
    const name = tokens[index + 1].value;
    for (let cursor = index + 2; cursor < Math.min(tokens.length, index + 24); cursor += 1) {
      if (tokenIs(tokens, cursor, ';') || tokenIs(tokens, cursor, ',')) break;
      if (tokenIs(tokens, cursor, '=') && isAxiosCreateCall(tokens, cursor + 1, bindings)) {
        clients.add(name);
        break;
      }
    }
  }
  return clients;
}

function exportsAxiosClient(content) {
  const tokens = sourceTokens(content);
  const bindings = axiosBindings(tokens);
  if (bindings.size === 0) return false;
  const clients = declaredAxiosClients(tokens, bindings);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokenIs(tokens, index, 'export', 'identifier')) continue;
    if (tokenIs(tokens, index + 1, 'default', 'identifier') && (isAxiosCreateCall(tokens, index + 2, bindings) || clients.has(tokens[index + 2]?.value))) return true;
    if (['const', 'let', 'var'].includes(tokens[index + 1]?.value) && clients.has(tokens[index + 2]?.value)) return true;
    if (tokenIs(tokens, index + 1, '{')) {
      for (let cursor = index + 2; cursor < tokens.length && !tokenIs(tokens, cursor, '}'); cursor += 1) {
        if (clients.has(tokens[cursor]?.value)) return true;
      }
    }
  }
  return false;
}

function isAuthorizationBoundaryPath(relative) {
  if (/(^|\/)(?:ui|components?|views?|pages?)\//i.test(relative)) return false;
  return /(^|\/)(?:auth(?:orization)?|security|access-control|guards?|policies|abilities)(?:\/|$)/i.test(relative)
    || /(?:permission|authorization|authorize|policy|guard|ability)(?:[._-]|$)/i.test(path.basename(relative));
}

function hasAuthorizationSyntax(content) {
  const tokens = sourceTokens(content);
  const hasGuardSyntax = tokens.some((token, index) => (
    ['CanActivate', 'canActivate', 'UseGuards', 'SetMetadata'].includes(token.value)
    || (token.value === '@' && ['Roles', 'Permissions', 'UseGuards', 'SetMetadata'].includes(tokens[index + 1]?.value))
  ));
  const hasExplicitBoundary = tokens.some((token, index) => /^(?:Permission|Authorization|Authorize|Policy|Ability)\w*$/.test(token.value)
    && ['class', 'function', 'const', 'let', 'var'].includes(tokens[index - 1]?.value));
  const hasDecisionMethod = tokens.some((token) => ['can', 'authorize', 'check', 'enforce', 'permit', 'deny'].includes(token.value));
  return hasGuardSyntax || (hasExplicitBoundary && hasDecisionMethod);
}

function sourceFiles(scan, { includeTests = false } = {}) {
  return scan.files.filter((file) => {
    if (file.type !== 'file' || /^(?:docs\/ai\/|\.ai-governance\/|\.agents\/|\.claude\/|\.cursor\/)/.test(file.relative)) return false;
    if (!isSafeCapabilityPath(file.relative)) return false;
    if (!SOURCE_EXTENSIONS.has(path.extname(file.relative))) return false;
    if (!includeTests && /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(file.relative)) return false;
    return true;
  });
}

function productFingerprint(scan) {
  const files = sourceFiles(scan, { includeTests: true })
    .map((file) => ({ path: file.relative, sha256: sha256(readText(file.absolute)) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableJson(files));
}

function commandEvidence(scan) {
  return scan.commands
    .filter((command) => /(?:test|typecheck|lint|build)/i.test(command.name))
    .map((command) => command.command)
    .slice(0, 4);
}

function implementationFingerprint(scan, paths) {
  return sha256(stableJson(paths
    .map((relative) => ({ path: relative, sha256: sha256(readText(path.join(scan.root, relative))) }))
    .sort((left, right) => left.path.localeCompare(right.path))));
}

function candidate({ id, kind, title, skillName, owner, implementationPaths, scan, detection }) {
  const paths = [...new Set(implementationPaths)].sort((left, right) => left.localeCompare(right));
  return {
    id,
    kind,
    title,
    status: 'candidate',
    owner,
    implementationPaths: paths,
    publicEntrypoints: [],
    consumerPaths: [],
    verification: commandEvidence(scan),
    capabilityVersion: 1,
    implementationFingerprint: implementationFingerprint(scan, paths),
    skill: `docs/ai/skills/project/${skillName}/SKILL.md`,
    detection,
    review: {
      status: 'required',
      dueDate: reviewDueDate(),
    },
    gaps: [
      'Confirm the owning module and public entrypoint.',
      'Run and record the relevant project verification before promotion to adopted.',
      'Confirm governed consumers before enforcing reuse or blocking bypasses.',
    ],
  };
}

export function detectCapabilityCandidates(scan) {
  const sources = sourceFiles(scan).map((file) => ({ ...file, content: readText(file.absolute) }));
  const candidates = [];
  const axiosWrappers = scan.packageDependencies?.axios
    ? sources.filter((file) => exportsAxiosClient(file.content)).map((file) => file.relative)
    : [];
  if (axiosWrappers.length > 0) {
    candidates.push(candidate({
      id: 'project-http-client',
      kind: 'platform-adapter',
      title: 'Use the project HTTP client',
      skillName: 'use-project-http-client',
      owner: 'platform',
      implementationPaths: axiosWrappers,
      scan,
      detection: 'exported-axios-create-wrapper-v1',
    }));
  }

  const authorizationPaths = sources
    .filter((file) => !['.tsx', '.jsx'].includes(path.extname(file.relative)) && isAuthorizationBoundaryPath(file.relative) && hasAuthorizationSyntax(file.content))
    .map((file) => file.relative);
  if (authorizationPaths.length > 0) {
    candidates.push(candidate({
      id: 'project-authorization',
      kind: 'security-policy',
      title: 'Authorize project operations',
      skillName: 'authorize-project-operation',
      owner: 'authorization',
      implementationPaths: authorizationPaths,
      scan,
      detection: 'exported-authorization-boundary-v1',
    }));
  }
  return candidates;
}

export function validateProjectCapabilities(capabilities) {
  if (capabilities === undefined) return [];
  if (!Array.isArray(capabilities)) throw usageError('projectCapabilities must be an array when provided.');
  const ids = new Set();
  for (const capability of capabilities) {
    if (!capability || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability.id ?? '')) throw usageError('Each project capability needs a safe kebab-case id.');
    if (ids.has(capability.id)) throw usageError(`projectCapabilities contains duplicate id: ${capability.id}`);
    ids.add(capability.id);
    if (!CAPABILITY_STATES.has(capability.status)) throw usageError(`Project capability ${capability.id} has an unsupported status.`);
    if (typeof capability.title !== 'string' || !capability.title || typeof capability.owner !== 'string' || !capability.owner) throw usageError(`Project capability ${capability.id} needs a title and owner.`);
    if (!Array.isArray(capability.implementationPaths) || capability.implementationPaths.length === 0 || capability.implementationPaths.some((entry) => !isSafeCapabilityPath(entry))) {
      throw usageError(`Project capability ${capability.id} needs safe implementation paths.`);
    }
    if (!Array.isArray(capability.publicEntrypoints) || capability.publicEntrypoints.some((entry) => !isSafeCapabilityPath(entry))) {
      throw usageError(`Project capability ${capability.id} needs safe public entrypoints.`);
    }
    if (capability.consumerPaths !== undefined && (!Array.isArray(capability.consumerPaths) || capability.consumerPaths.some((entry) => !isSafeCapabilityPath(entry)))) {
      throw usageError(`Project capability ${capability.id} has unsafe consumer paths.`);
    }
    if (capability.consumerEvidence !== undefined && (!capability.consumerEvidence || !['operator-declared-unverified', 'not-declared'].includes(capability.consumerEvidence.status) || !Array.isArray(capability.consumerEvidence.paths) || capability.consumerEvidence.paths.some((entry) => !isSafeCapabilityPath(entry)) || (capability.consumerEvidence.status === 'not-declared' && capability.consumerEvidence.paths.length > 0) || (capability.consumerEvidence.status === 'operator-declared-unverified' && capability.consumerEvidence.paths.length === 0))) {
      throw usageError(`Project capability ${capability.id} has invalid consumer evidence.`);
    }
    if (!Number.isInteger(capability.capabilityVersion) || capability.capabilityVersion < 1) throw usageError(`Project capability ${capability.id} needs a positive capabilityVersion.`);
    if (typeof capability.kind !== 'string' || !capability.kind || typeof capability.detection !== 'string' || !capability.detection) {
      throw usageError(`Project capability ${capability.id} needs a kind and detection record.`);
    }
    if (capability.status === 'candidate' && (!capability.review || capability.review.status !== 'required' || !isIsoDate(capability.review.dueDate))) {
      throw usageError(`Candidate capability ${capability.id} needs a required review due date.`);
    }
    if (capability.status === 'adopted') {
      if (capability.publicEntrypoints.length === 0) throw usageError(`Adopted capability ${capability.id} needs a confirmed public entrypoint.`);
      if (!capability.review || capability.review.status !== 'completed' || !isIsoDate(capability.review.reviewedAt)) {
        throw usageError(`Adopted capability ${capability.id} needs a completed review date.`);
      }
      if (!capability.promotion || !isIsoDate(capability.promotion.verifiedAt) || typeof capability.promotion.command !== 'string' || !capability.promotion.command || capability.promotion.basis !== 'operator-confirmed-promotion-v1' || capability.promotion.implementationFingerprint !== capability.implementationFingerprint) {
        throw usageError(`Adopted capability ${capability.id} needs promotion evidence bound to its implementation fingerprint.`);
      }
    }
    if (typeof capability.skill !== 'string' || !/^docs\/ai\/skills\/project\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(capability.skill)) {
      throw usageError(`Project capability ${capability.id} needs a canonical project Skill path.`);
    }
    if (!Array.isArray(capability.verification)) throw usageError(`Project capability ${capability.id} needs verification references.`);
    if (!/^[a-f0-9]{64}$/.test(capability.implementationFingerprint ?? '')) throw usageError(`Project capability ${capability.id} needs an implementation fingerprint.`);
  }
  return capabilities;
}

export function validateCapabilityEvolution(evolution, capabilities = []) {
  if (evolution === undefined) return;
  if (!evolution || typeof evolution !== 'object' || !evolution.lastHarvest || typeof evolution.lastHarvest !== 'object') {
    throw usageError('capabilityEvolution must contain a lastHarvest record when provided.');
  }
  const harvest = evolution.lastHarvest;
  if (harvest.schemaVersion !== 1 || !HARVEST_OUTCOMES.has(harvest.outcome)) throw usageError('capabilityEvolution has an unsupported harvest outcome.');
  if (harvest.outcome !== 'not-run' && !/^[a-f0-9]{64}$/.test(harvest.productChangeFingerprint ?? '')) {
    throw usageError('capabilityEvolution needs a product change fingerprint.');
  }
  if (!Array.isArray(harvest.candidateIds) || harvest.candidateIds.some((id) => typeof id !== 'string' || !capabilities.some((capability) => capability.id === id))) {
    throw usageError('capabilityEvolution candidateIds must reference configured capabilities.');
  }
  if (!Array.isArray(harvest.detectedCapabilityIds) || harvest.detectedCapabilityIds.some((id) => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) {
    throw usageError('capabilityEvolution needs safe detected capability IDs.');
  }
  if (!Array.isArray(harvest.drift) || harvest.drift.some((entry) => !entry || !capabilities.some((capability) => capability.id === entry.id) || typeof entry.reason !== 'string' || !entry.reason || (entry.observedFingerprint !== null && !/^[a-f0-9]{64}$/.test(entry.observedFingerprint ?? '')))) {
    throw usageError('capabilityEvolution drift entries must reference a capability and fingerprint.');
  }
  if (!Array.isArray(harvest.reviewItems) || harvest.reviewItems.some((entry) => {
    const capability = capabilities.find((candidate) => candidate.id === entry?.id);
    return !capability
      || entry.owner !== capability.owner
      || entry.status !== 'required'
      || !isIsoDate(entry.dueDate)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.code ?? '')
      || typeof entry.reason !== 'string'
      || !entry.reason
      || (entry.observedFingerprint !== null && !/^[a-f0-9]{64}$/.test(entry.observedFingerprint ?? ''));
  })) {
    throw usageError('capabilityEvolution review items must have a capability owner, due date, and bounded evidence.');
  }
  const verification = harvest.verification;
  if (!verification || !HARVEST_VERIFICATION_STATES.has(verification.status) || !Array.isArray(verification.projectCommands) || verification.projectCommands.some((command) => typeof command !== 'string') || typeof verification.boundary !== 'string' || !verification.boundary) {
    throw usageError('capabilityEvolution needs a bounded verification record.');
  }
}

function preserveOrUpdate(existing, discovered) {
  if (!existing) return { capability: discovered, outcome: 'candidate-recorded' };
  if (existing.status === 'adopted') {
    return {
      capability: existing,
      outcome: existing.implementationFingerprint === discovered.implementationFingerprint ? 'no-skill-with-reason' : 'candidate-recorded',
      drift: existing.implementationFingerprint === discovered.implementationFingerprint ? null : {
        id: existing.id,
        code: 'adopted-implementation-drift',
        reason: 'An adopted capability implementation changed. Preserve the adopted record until an owner reviews and upgrades its Skill.',
        observedFingerprint: discovered.implementationFingerprint,
      },
    };
  }
  return {
    capability: {
      ...discovered,
      capabilityVersion: existing.capabilityVersion ?? 1,
      review: existing.review ?? discovered.review,
    },
    outcome: 'candidate-recorded',
  };
}

function observedImplementation(scan, capability) {
  const files = new Set(sourceFiles(scan).map((file) => file.relative));
  if (capability.implementationPaths.some((relative) => !files.has(relative))) return null;
  return implementationFingerprint(scan, capability.implementationPaths);
}

export function capabilityEvidenceIssues(scan, capabilities) {
  const files = new Set(sourceFiles(scan).map((file) => file.relative));
  return capabilities.flatMap((capability) => {
    if (capability.status !== 'adopted') return [];
    const issues = [];
    const observedFingerprint = observedImplementation(scan, capability);
    if (observedFingerprint === null) {
      issues.push({ id: capability.id, code: 'implementation-missing', observedFingerprint: null, reason: 'an adopted implementation path is missing' });
    } else if (observedFingerprint !== capability.implementationFingerprint) {
      issues.push({ id: capability.id, code: 'adopted-implementation-drift', observedFingerprint, reason: 'an adopted implementation fingerprint no longer matches the source' });
    }
    if (capability.publicEntrypoints.some((relative) => !files.has(relative))) {
      issues.push({ id: capability.id, code: 'public-entrypoint-missing', observedFingerprint, reason: 'a confirmed public entrypoint is missing' });
    }
    return issues;
  });
}

function reviewItem(capability, issue, previousReviewItems) {
  const existing = previousReviewItems.find((entry) => entry.id === capability.id && entry.code === issue.code && entry.status === 'required');
  return {
    id: capability.id,
    owner: capability.owner,
    status: 'required',
    dueDate: existing?.dueDate ?? reviewDueDate(),
    ...issue,
  };
}

function retainedOutcome(capability, scan) {
  if (!['candidate', 'adopted'].includes(capability.status)) return { capability };
  const observedFingerprint = observedImplementation(scan, capability);
  const missing = observedFingerprint === null;
  const issue = {
    id: capability.id,
    code: missing ? 'implementation-missing' : `${capability.status}-not-detected`,
    reason: missing
      ? 'The capability implementation path is missing. Preserve the record until the owner reviews retirement, replacement, or repair.'
      : 'The active capability is no longer detected by its original rule. Preserve the record until the owner reviews the changed boundary.',
    observedFingerprint,
  };
  return {
    capability,
    review: issue,
    drift: capability.status === 'adopted' ? issue : null,
  };
}

export function prepareCapabilityHarvest(config, scan) {
  const existing = validateProjectCapabilities(config.projectCapabilities ?? []);
  const byId = new Map(existing.map((capability) => [capability.id, capability]));
  const discovered = detectCapabilityCandidates(scan);
  const outcomes = discovered.map((entry) => preserveOrUpdate(byId.get(entry.id), entry));
  const discoveredIds = new Set(discovered.map((entry) => entry.id));
  const retainedOutcomes = existing.filter((entry) => !discoveredIds.has(entry.id)).map((entry) => retainedOutcome(entry, scan));
  const allOutcomes = [...outcomes, ...retainedOutcomes];
  const capabilities = allOutcomes.map((entry) => entry.capability).sort((left, right) => left.id.localeCompare(right.id));
  const drift = allOutcomes.flatMap((entry) => entry.drift ? [entry.drift] : []);
  const priorReviewItems = config.capabilityEvolution?.lastHarvest?.reviewItems ?? [];
  const detectedReviews = allOutcomes.flatMap((entry) => entry.drift || entry.review ? [reviewItem(entry.capability, entry.drift ?? entry.review, priorReviewItems)] : []);
  const evidenceReviews = capabilityEvidenceIssues(scan, capabilities).map((issue) => reviewItem(capabilities.find((capability) => capability.id === issue.id), issue, priorReviewItems));
  const reviewItems = [...detectedReviews, ...evidenceReviews]
    .filter((item, index, items) => items.findIndex((other) => other.id === item.id && other.code === item.code && other.observedFingerprint === item.observedFingerprint) === index);
  const candidateIds = capabilities.filter((entry) => entry.status === 'candidate').map((entry) => entry.id).sort((left, right) => left.localeCompare(right));
  const outcome = reviewItems.length > 0 ? 'review-required' : candidateIds.length > 0 ? 'candidate-recorded' : 'no-skill-with-reason';
  const harvest = {
    schemaVersion: 1,
    productChangeFingerprint: productFingerprint(scan),
    outcome,
    candidateIds,
    detectedCapabilityIds: discovered.map((entry) => entry.id),
    drift,
    reviewItems,
    verification: {
      projectCommands: commandEvidence(scan),
      status: 'not-run-by-harvest',
      boundary: 'The deterministic harvest only records discovery. Run the relevant project command and explicitly promote a candidate before claiming adopted reuse enforcement.',
    },
  };
  return {
    config: {
      ...config,
      projectCapabilities: capabilities,
      capabilityEvolution: { lastHarvest: harvest },
    },
    harvest,
  };
}

function requireCapabilityPaths(scan, values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !isSafeCapabilityPath(value))) {
    throw usageError(`${label} needs one or more safe repository-relative paths.`);
  }
  const files = new Set(sourceFiles(scan).map((file) => file.relative));
  if (values.some((value) => !files.has(value))) throw usageError(`${label} must reference existing product source files in the target repository.`);
  return unique(values).sort((left, right) => left.localeCompare(right));
}

function promotionDate() {
  return new Date().toISOString().slice(0, 10);
}

export function prepareCapabilityPromotion(config, scan, input) {
  if (!input || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.capabilityId ?? '')) {
    throw usageError('Capability promotion needs a safe capabilityId.');
  }
  const prepared = prepareCapabilityHarvest(config, scan);
  const capability = prepared.config.projectCapabilities.find((entry) => entry.id === input.capabilityId);
  if (!capability || capability.status !== 'candidate') throw usageError(`Only a current candidate can be promoted: ${input.capabilityId}`);
  if (!prepared.harvest.detectedCapabilityIds.includes(capability.id)) {
    throw usageError(`Capability ${capability.id} is not currently detected. Run a harvest and resolve its review before promotion.`);
  }
  if (prepared.harvest.reviewItems.some((item) => item.id === capability.id)) {
    throw usageError(`Capability ${capability.id} has an active review item and cannot be promoted.`);
  }
  const publicEntrypoints = requireCapabilityPaths(scan, input.publicEntrypoints, 'Capability promotion publicEntrypoints');
  if (publicEntrypoints.some((entrypoint) => !capability.implementationPaths.includes(entrypoint))) {
    throw usageError('Capability promotion publicEntrypoints must be current implementation paths until a verified barrel-export resolver is available.');
  }
  const declaredConsumerPaths = input.consumerPaths === undefined || input.consumerPaths.length === 0
    ? []
    : requireCapabilityPaths(scan, input.consumerPaths, 'Capability promotion consumerPaths');
  const verificationCommand = input.verificationCommand;
  if (typeof verificationCommand !== 'string' || !scan.commands.some((command) => command.command === verificationCommand)) {
    throw usageError('Capability promotion verificationCommand must exactly match a discovered repository verification command.');
  }
  const verifiedAt = promotionDate();
  const adopted = {
    ...capability,
    status: 'adopted',
    publicEntrypoints,
    consumerPaths: [],
    consumerEvidence: {
      status: declaredConsumerPaths.length > 0 ? 'operator-declared-unverified' : 'not-declared',
      paths: declaredConsumerPaths,
    },
    capabilityVersion: capability.capabilityVersion + 1,
    review: { status: 'completed', reviewedAt: verifiedAt },
    promotion: {
      verifiedAt,
      command: verificationCommand,
      implementationFingerprint: capability.implementationFingerprint,
      basis: 'operator-confirmed-promotion-v1',
    },
    verification: unique([...capability.verification, verificationCommand]).sort((left, right) => left.localeCompare(right)),
    gaps: [
      'Consumer reuse is not machine-verified.',
      'Bypass enforcement is not enabled by this promotion.',
    ],
  };
  const capabilities = prepared.config.projectCapabilities
    .map((entry) => entry.id === adopted.id ? adopted : entry)
    .sort((left, right) => left.id.localeCompare(right.id));
  const lastHarvest = {
    ...prepared.harvest,
    outcome: 'adopted-promoted',
    candidateIds: capabilities.filter((entry) => entry.status === 'candidate').map((entry) => entry.id),
    reviewItems: prepared.harvest.reviewItems.filter((item) => item.id !== adopted.id),
    verification: {
      projectCommands: [verificationCommand],
      status: 'command-passed',
      boundary: 'The approved promotion writes only after this exact discovered command exits successfully. It proves command execution, not broad product behavior or bypass enforcement.',
    },
    promotion: {
      id: adopted.id,
      verifiedAt,
      command: verificationCommand,
    },
  };
  return {
    config: {
      ...prepared.config,
      projectCapabilities: capabilities,
      capabilityEvolution: { lastHarvest },
    },
    promotion: {
      id: adopted.id,
      status: adopted.status,
      publicEntrypoints,
      declaredConsumerPaths,
      verificationCommand,
      verifiedAt,
    },
  };
}

function candidateSkill(capability) {
  const adoptionInstruction = capability.status === 'candidate'
    ? 'Do not treat this candidate as an approved public API or block a parallel implementation. Confirm and promote it first.'
    : 'Reuse the confirmed public entrypoint when its contract fits; do not create a parallel wrapper, policy, or client.';
  const entrypoints = capability.publicEntrypoints.length > 0
    ? capability.publicEntrypoints.map((entry) => `- \`${entry}\``).join('\n')
    : '- No public entrypoint is confirmed yet.';
  return `---
name: ${path.basename(path.dirname(capability.skill))}
description: ${capability.status === 'candidate' ? 'Review the discovered' : 'Reuse the adopted'} ${capability.title} boundary after checking its current implementation and verification evidence.
---

# ${capability.title}

<!-- ${GENERATED_MARKER} -->

## Capability record

- Stable ID: \`${capability.id}\`
- Status: \`${capability.status}\`
- Owner: \`${capability.owner}\`
- Capability version: \`${capability.capabilityVersion}\`
- Current implementation fingerprint: \`${capability.implementationFingerprint}\`
- Review: \`${capability.review.status}\`${capability.status === 'candidate' ? ` by \`${capability.review.dueDate}\`` : ` on \`${capability.review.reviewedAt}\``}

## Use this boundary when

- The task needs the concern represented by this project capability.
- A new implementation might otherwise duplicate its current boundary.

## Current implementation evidence

${capability.implementationPaths.map((entry) => `- \`${entry}\``).join('\n')}

## Confirmed public entrypoints

${entrypoints}

## Required working method

1. Read the current implementation, exported types, and neighboring tests before calling or changing it.
2. ${adoptionInstruction}
3. Preserve authorization, retry, error, lifecycle, and configuration decisions already encoded by the owner.
4. Update this capability record when its public contract or implementation fingerprint changes.

## Verification

${capability.verification.length > 0 ? capability.verification.map((entry) => `- \`${entry}\``).join('\n') : '- No verified project command was discovered. Add one before promoting this capability.'}

${capability.status === 'adopted' ? `## Promotion evidence

- Operator confirmation: \`${capability.promotion.basis}\`
- Verified on: \`${capability.promotion.verifiedAt}\`
- Command: \`${capability.promotion.command}\`
${capability.consumerEvidence?.paths?.length > 0 ? `- Consumer paths are \`${capability.consumerEvidence.status}\`: ${capability.consumerEvidence.paths.map((entry) => `\`${entry}\``).join(', ')}\n` : ''}
` : ''}

## Capability boundary

${capability.status === 'candidate'
    ? '- This is an automatically discovered candidate, not an adopted or machine-enforced policy. Confirm owner, public entrypoint, consumer scope, and real verification before promotion.'
    : '- This record is adopted only when its promotion evidence and current verification are present in the capability catalog.'}
`;
}

export function buildCapabilityArtifacts(config) {
  const capabilities = validateProjectCapabilities(config.projectCapabilities ?? []);
  validateCapabilityEvolution(config.capabilityEvolution, capabilities);
  const lastHarvest = config.capabilityEvolution?.lastHarvest ?? {
    schemaVersion: 1,
    outcome: 'not-run',
    candidateIds: [],
    detectedCapabilityIds: [],
    drift: [],
    reviewItems: [],
    verification: { status: 'unverified', boundary: 'No capability harvest has been recorded for this governance configuration.' },
  };
  const catalog = {
    schemaVersion: 1,
    lastHarvest,
    capabilities: capabilities.map((capability) => ({
      ...capability,
      implementationPaths: capability.implementationPaths.map(normalizeRelative),
    })),
  };
  const artifacts = [{
    path: 'docs/ai/capability-evolution.json',
    content: stableJson(catalog),
    ownership: 'full',
    kind: 'capability-evolution-catalog',
    source: 'project-capability-harvest',
  }];
  for (const capability of capabilities.filter((entry) => ['candidate', 'adopted'].includes(entry.status))) {
    const content = candidateSkill(capability);
    artifacts.push({
      path: capability.skill,
      content,
      ownership: 'full',
      kind: 'project-capability-skill',
      source: 'project-capability-harvest',
    });
    const adapters = [];
    if (config.clients.some((agent) => ['codex', 'cursor', 'generic'].includes(agent))) adapters.push(`.agents/skills/project/${path.basename(path.dirname(capability.skill))}/SKILL.md`);
    if (config.clients.includes('claude-code')) adapters.push(`.claude/skills/project/${path.basename(path.dirname(capability.skill))}/SKILL.md`);
    for (const adapterPath of unique(adapters)) artifacts.push({
      path: adapterPath,
      content,
      ownership: 'full',
      kind: 'project-capability-adapter-skill',
      source: capability.skill,
    });
  }
  return { catalog, artifacts };
}

export function capabilityHarvestSummary(config, scan) {
  const prepared = prepareCapabilityHarvest(config, scan);
  return {
    schemaVersion: 1,
    mode: 'read-only-preview',
    target: scan.root,
    ...prepared.harvest,
    plannedCapabilities: prepared.config.projectCapabilities,
    boundary: 'No file was written. Applying a harvest requires the explicit write command or a matching chat execution-plan approval.',
  };
}
