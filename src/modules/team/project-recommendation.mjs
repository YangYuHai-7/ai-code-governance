import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { dynamicTeamPlan, normalizeDynamicTeamContext } from './product-team-plan.mjs';
import { isSafeRelative, normalizeRelative, readJson, usageError, walkFiles } from '../../utils.mjs';

const REGISTRY_PATH = 'assets/registries/team-role-registry.json';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const SAFE_BUSINESS_TEXT = /^[^\x00-\x1f\x7f]{1,4000}$/;
const ROLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_WORKSPACE_GLOB = /^[A-Za-z0-9@._*/-]+$/;
const SELECTION_FIELDS = new Set(['alwaysWithBusinessContext', 'technologyPackagesAny', 'confirmedSignalsAny', 'stagesAny', 'priorityWhenSignal']);
const REQUIRED_ROLE_IDS = new Set([
  'product-domain-owner',
  'technical-delivery-owner',
  'frontend-delivery-owner',
  'backend-api-and-data-owner',
  'quality-and-release-reviewer',
  'realtime-media-owner',
  'security-and-integrity-reviewer',
  'platform-and-operations-owner',
]);

function sortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function stringArray(value, field, roleId) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item)) {
    throw usageError(`Team role ${roleId} needs a non-empty ${field} array.`);
  }
}

export function validateTeamRoleRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || registry.teamType !== 'human-delivery-and-governance' || !Array.isArray(registry.roles)) {
    throw usageError('Team role registry must declare schemaVersion 1, a human team type, and roles.');
  }
  if (registry.supportedTeamScopes?.length !== 1 || registry.supportedTeamScopes[0] !== 'human') throw usageError('Team role registry supports only the explicit human scope.');
  if (!Array.isArray(registry.supportedBusinessSignals) || registry.supportedBusinessSignals.length === 0 || registry.supportedBusinessSignals.some((signal) => !ROLE_ID.test(signal)) || new Set(registry.supportedBusinessSignals).size !== registry.supportedBusinessSignals.length) {
    throw usageError('Team role registry contains an invalid business signal.');
  }
  if (!Array.isArray(registry.supportedStages) || registry.supportedStages.length === 0 || registry.supportedStages.some((stage) => !ROLE_ID.test(stage)) || new Set(registry.supportedStages).size !== registry.supportedStages.length) {
    throw usageError('Team role registry contains an invalid stage.');
  }
  const ids = new Set();
  for (const role of registry.roles) {
    if (!role || !ROLE_ID.test(role.id ?? '') || ids.has(role.id)) throw usageError(`Team role registry contains an invalid or duplicate role id: ${role?.id ?? '<missing>'}`);
    ids.add(role.id);
    if (typeof role.title !== 'string' || !role.title) throw usageError(`Team role ${role.id} needs a title.`);
    if (!['needed-now', 'conditional-later'].includes(role.defaultPriority)) throw usageError(`Team role ${role.id} has an invalid default priority.`);
    if (!role.selection || typeof role.selection !== 'object' || Array.isArray(role.selection)) throw usageError(`Team role ${role.id} needs a selection rule.`);
    if (Object.keys(role.selection).some((field) => !SELECTION_FIELDS.has(field))) throw usageError(`Team role ${role.id} contains an unsupported selection field.`);
    if (role.selection.alwaysWithBusinessContext !== undefined && role.selection.alwaysWithBusinessContext !== true) throw usageError(`Team role ${role.id} must use alwaysWithBusinessContext only as true.`);
    for (const selector of ['technologyPackagesAny', 'confirmedSignalsAny', 'stagesAny']) {
      if (role.selection[selector] === undefined) continue;
      stringArray(role.selection[selector], selector, role.id);
      if (new Set(role.selection[selector]).size !== role.selection[selector].length) throw usageError(`Team role ${role.id} contains duplicate ${selector} values.`);
    }
    if (role.selection.alwaysWithBusinessContext !== true && !role.selection.technologyPackagesAny && !role.selection.confirmedSignalsAny && !role.selection.stagesAny) {
      throw usageError(`Team role ${role.id} needs at least one effective selection condition.`);
    }
    if (role.selection.technologyPackagesAny?.some((name) => !PACKAGE_NAME.test(name))) throw usageError(`Team role ${role.id} contains an invalid package selector.`);
    if (role.selection.confirmedSignalsAny?.some((signal) => !registry.supportedBusinessSignals.includes(signal))) throw usageError(`Team role ${role.id} contains an unsupported business signal.`);
    if (role.selection.stagesAny?.some((stage) => !registry.supportedStages.includes(stage))) throw usageError(`Team role ${role.id} contains an unsupported stage.`);
    if (role.selection.priorityWhenSignal && (!['needed-now', 'conditional-later'].includes(role.selection.priorityWhenSignal) || !role.selection.confirmedSignalsAny)) throw usageError(`Team role ${role.id} has an invalid signal priority.`);
    stringArray(role.responsibilities, 'responsibilities', role.id);
    stringArray(role.deliverables, 'deliverables', role.id);
    for (const field of ['canCombineWith', 'mustRemainIndependentFrom']) {
      if (!Array.isArray(role[field]) || role[field].some((item) => typeof item !== 'string' || !item) || new Set(role[field]).size !== role[field].length) {
        throw usageError(`Team role ${role.id} needs a string-only ${field} array.`);
      }
    }
  }
  for (const id of REQUIRED_ROLE_IDS) {
    if (!ids.has(id)) throw usageError(`Team role registry is missing required role: ${id}`);
  }
  for (const role of registry.roles) {
    const canCombine = new Set(role.canCombineWith);
    const mustRemainIndependent = new Set(role.mustRemainIndependentFrom);
    for (const relatedId of [...canCombine, ...mustRemainIndependent]) {
      if (!ids.has(relatedId) || relatedId === role.id) throw usageError(`Team role ${role.id} references an unknown or self role: ${relatedId}`);
    }
    for (const relatedId of canCombine) {
      if (mustRemainIndependent.has(relatedId)) throw usageError(`Team role ${role.id} cannot combine with and remain independent from ${relatedId}.`);
      if (!registry.roles.find((candidate) => candidate.id === relatedId).canCombineWith.includes(role.id)) throw usageError(`Team role combination must be symmetric: ${role.id} and ${relatedId}.`);
    }
    for (const relatedId of mustRemainIndependent) {
      if (!registry.roles.find((candidate) => candidate.id === relatedId).mustRemainIndependentFrom.includes(role.id)) throw usageError(`Team role independence must be symmetric: ${role.id} and ${relatedId}.`);
    }
  }
  return registry;
}

export function loadTeamRoleRegistry(registryPath = path.join(PACKAGE_ROOT, REGISTRY_PATH)) {
  return validateTeamRoleRegistry(readJson(registryPath));
}

export function validateTeamContext(context, registry = loadTeamRoleRegistry()) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw usageError('Team context must be a JSON object.');
  if (!registry.supportedTeamScopes.includes(context.teamScope)) {
    throw usageError(`teamScope must be one of: ${registry.supportedTeamScopes.join(', ')}.`);
  }
  if (typeof context.businessDescription !== 'string' || !SAFE_BUSINESS_TEXT.test(context.businessDescription) || !context.businessDescription.trim()) {
    throw usageError('businessDescription must be 1-4000 printable characters and must not contain control characters.');
  }
  if (context.confirmedSignals !== undefined && (!Array.isArray(context.confirmedSignals) || context.confirmedSignals.some((signal) => !registry.supportedBusinessSignals.includes(signal)))) {
    throw usageError(`confirmedSignals may contain only: ${registry.supportedBusinessSignals.join(', ')}.`);
  }
  if (context.stage !== undefined && !registry.supportedStages.includes(context.stage)) {
    throw usageError(`stage must be one of: ${registry.supportedStages.join(', ')}.`);
  }
  if (context.technologyPackages !== undefined && (!Array.isArray(context.technologyPackages) || context.technologyPackages.some((name) => typeof name !== 'string' || !PACKAGE_NAME.test(name)))) {
    throw usageError('technologyPackages must contain valid exact package names.');
  }
  const dynamicTeamContext = normalizeDynamicTeamContext(context);
  return {
    teamScope: context.teamScope,
    businessDescription: context.businessDescription.trim(),
    confirmedSignals: sortedStrings(context.confirmedSignals),
    ...(context.stage ? { stage: context.stage } : {}),
    technologyPackages: sortedStrings(context.technologyPackages),
    ...dynamicTeamContext,
  };
}

export function readTeamContext(root, relativePath, registry = loadTeamRoleRegistry()) {
  if (!relativePath) return null;
  if (!isSafeRelative(relativePath)) throw usageError('Team context --config must be a safe repository-relative path.');
  const absolute = path.resolve(root, relativePath);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(rootWithSeparator)) throw usageError('Team context --config must remain inside the target repository.');
  let current = path.resolve(root);
  for (const part of normalizeRelative(relativePath).split('/')) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) throw usageError('Team context --config must not traverse a symbolic link.');
  }
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw usageError('Team context --config must be an existing regular file, not a symbolic link.');
  if (stat.size > 16 * 1024) throw usageError('Team context --config must be at most 16 KiB.');
  let context;
  try {
    context = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    throw usageError('Team context --config must contain valid JSON.');
  }
  return validateTeamContext(context.teamContext ?? context, registry);
}

function readPackageManifest(absolute) {
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return null;
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return null;
  }
}

function declaredWorkspacePatterns(manifest) {
  const declared = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : Array.isArray(manifest?.workspaces?.packages)
      ? manifest.workspaces.packages
      : [];
  return sortedStrings(declared);
}

function parsePnpmWorkspacePatterns(root) {
  const absolute = path.join(root, 'pnpm-workspace.yaml');
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return [];
  let content;
  try {
    content = fs.readFileSync(absolute, 'utf8');
  } catch {
    return [];
  }
  const patterns = [];
  let readingPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (!readingPackages) {
      if (/^packages:\s*(?:#.*)?$/.test(line)) readingPackages = true;
      continue;
    }
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const item = line.match(/^\s{2,}-\s+(.+?)\s*$/);
    if (!item) break;
    const quoted = item[1].match(/^(?:'([^']+)'|"([^"]+)"|([^\s#]+))(?:\s+#.*)?$/);
    if (quoted) patterns.push(quoted[1] ?? quoted[2] ?? quoted[3]);
  }
  return sortedStrings(patterns);
}

function workspaceSelectors(root, manifest) {
  const includes = [];
  const excludes = [];
  for (const rawPattern of [...declaredWorkspacePatterns(manifest), ...parsePnpmWorkspacePatterns(root)]) {
    const excluded = rawPattern.startsWith('!');
    const pattern = excluded ? rawPattern.slice(1) : rawPattern;
    if (!isSafeRelative(pattern) || !SAFE_WORKSPACE_GLOB.test(pattern)) continue;
    (excluded ? excludes : includes).push(pattern);
  }
  return {
    includes: sortedStrings(includes),
    excludes: sortedStrings(excludes),
  };
}

function rootAnchoredWorkspaceMatch(relativeDirectory, pattern) {
  const normalizedDirectory = normalizeRelative(relativeDirectory);
  const normalizedPattern = normalizeRelative(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '::DOUBLE::')
    .replaceAll('*', '[^/]*')
    .replaceAll('::DOUBLE::', '.*');
  return new RegExp(`^${escaped}$`, process.platform === 'win32' ? 'i' : '').test(normalizedDirectory);
}

function appendManifestDependencies(dependencies, manifest, relativePath) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!PACKAGE_NAME.test(name)) continue;
      const paths = dependencies.get(name) ?? new Set();
      paths.add(relativePath);
      dependencies.set(name, paths);
    }
  }
}

function normalizedDependencies(dependencies) {
  return new Map([...dependencies.entries()].map(([name, paths]) => [name, [...paths].sort((left, right) => left.localeCompare(right))]));
}

function repositoryPackageEvidence(root) {
  const dependencies = new Map();
  const rootManifest = readPackageManifest(path.join(root, 'package.json'));
  if (!rootManifest) return normalizedDependencies(dependencies);
  appendManifestDependencies(dependencies, rootManifest, 'package.json');
  const selectors = workspaceSelectors(root, rootManifest);
  if (selectors.includes.length === 0) return normalizedDependencies(dependencies);
  for (const file of walkFiles(root, { maxDepth: 5 })) {
    if (file.type !== 'file' || file.relative === 'package.json' || path.basename(file.relative) !== 'package.json') continue;
    const workspaceDirectory = path.posix.dirname(file.relative);
    if (!selectors.includes.some((pattern) => rootAnchoredWorkspaceMatch(workspaceDirectory, pattern))) continue;
    if (selectors.excludes.some((pattern) => rootAnchoredWorkspaceMatch(workspaceDirectory, pattern))) continue;
    const manifest = readPackageManifest(file.absolute);
    if (manifest) appendManifestDependencies(dependencies, manifest, file.relative);
  }
  return normalizedDependencies(dependencies);
}

function roleTechnologyEvidence(role, repositoryPackages, declaredPackages) {
  const evidence = [];
  for (const packageName of sortedStrings(role.selection.technologyPackagesAny)) {
    const paths = repositoryPackages.get(packageName);
    if (paths) evidence.push({ id: `technology.${packageName}.repository`, kind: 'detected-exact-package', package: packageName, confidence: 'high', paths });
    if (declaredPackages.includes(packageName)) evidence.push({ id: `technology.${packageName}.user`, kind: 'user-confirmed-technology', package: packageName, confidence: 'medium', paths: [] });
  }
  return evidence;
}

function roleSignalEvidence(role, context) {
  return sortedStrings(role.selection.confirmedSignalsAny)
    .filter((signal) => context.confirmedSignals.includes(signal))
    .map((signal) => ({ id: `business.${signal}`, kind: 'user-confirmed-business-signal', signal, confidence: 'high' }));
}

function stageEvidence(role, context) {
  if (!context.stage || !role.selection.stagesAny?.includes(context.stage)) return [];
  return [{ id: `business.stage.${context.stage}`, kind: 'user-confirmed-stage', stage: context.stage, confidence: 'high' }];
}

function selectedRole(role, context, repositoryPackages, declaredPackages) {
  const technologyEvidence = roleTechnologyEvidence(role, repositoryPackages, declaredPackages);
  const signalEvidence = roleSignalEvidence(role, context);
  const lifecycleEvidence = stageEvidence(role, context);
  const always = role.selection.alwaysWithBusinessContext === true;
  const selected = always || technologyEvidence.length > 0 || signalEvidence.length > 0 || lifecycleEvidence.length > 0;
  if (!selected) return null;
  const priority = signalEvidence.length > 0 && role.selection.priorityWhenSignal
    ? role.selection.priorityWhenSignal
    : role.defaultPriority;
  const businessEvidence = [
    ...(always ? [{ id: 'business.description', kind: 'user-provided-business-description', confidence: 'high' }] : []),
    ...signalEvidence,
    ...lifecycleEvidence,
  ];
  const evidence = [...technologyEvidence, ...businessEvidence];
  const confidence = evidence.some((item) => item.confidence === 'high') ? 'high' : 'medium';
  const activationTrigger = priority === 'conditional-later'
    ? 'Activate only after the product owner confirms that the related capability is in delivery scope or production use.'
    : signalEvidence.length > 0
      ? 'Needed now because the product owner confirmed the related business signal.'
      : lifecycleEvidence.length > 0
        ? 'Needed now because the product owner confirmed the current delivery stage.'
        : technologyEvidence.some((item) => item.kind === 'detected-exact-package')
          ? 'Needed now because exact repository dependency evidence is present.'
          : technologyEvidence.length > 0
            ? 'Needed now because the technology package was explicitly confirmed by the user; repository installation is not verified.'
            : 'Needed now because the user provided a business context; technology-specific scope may still need confirmation.';
  return {
    id: role.id,
    title: role.title,
    priority,
    confidence,
    responsibilities: role.responsibilities,
    deliverables: role.deliverables,
    canCombineWith: role.canCombineWith,
    mustRemainIndependentFrom: role.mustRemainIndependentFrom,
    stackEvidence: technologyEvidence,
    businessEvidence,
    rationaleEvidenceIds: evidence.map((item) => item.id),
    assumptions: priority === 'conditional-later'
      ? ['The relevant technology is detected or declared, but the product owner has not yet confirmed that this capability is in current delivery scope.']
      : always
        ? ['The role is inferred from an explicit business context; technology-specific scope may still need confirmation.']
        : ['The role is inferred from the stated evidence and does not prove production use or staffing availability.'],
    activationTrigger,
  };
}

function needsInputResult() {
  return {
    schemaVersion: 1,
    mode: 'read-only-advice',
    teamType: 'human-delivery-and-governance',
    target: '.',
    status: 'needs-user-input',
    requiredInputs: ['teamScope', 'businessDescription'],
    productTeam: dynamicTeamPlan(),
    actionsPerformed: [],
    boundary: 'No people, agents, permissions, tasks, files, or external messages were created or changed.',
  };
}

function repositoryFacts(repositoryPackages, roles, context) {
  const allowedPackages = new Set(roles.flatMap((role) => role.selection.technologyPackagesAny ?? []));
  const facts = [];
  for (const packageName of [...allowedPackages].sort((left, right) => left.localeCompare(right))) {
    const paths = repositoryPackages.get(packageName);
    if (paths) facts.push({ id: `technology.${packageName}.repository`, kind: 'detected-exact-package', package: packageName, confidence: 'high', paths });
  }
  for (const packageName of context.technologyPackages) {
    if (allowedPackages.has(packageName)) facts.push({ id: `technology.${packageName}.user`, kind: 'user-confirmed-technology', package: packageName, confidence: 'medium', paths: [] });
  }
  return facts;
}

function requiredSeparations(recommendations) {
  const selected = new Set(recommendations.map((role) => role.id));
  const pairs = new Map();
  for (const role of recommendations) {
    for (const relatedId of role.mustRemainIndependentFrom) {
      if (!selected.has(relatedId)) continue;
      const [left, right] = [role.id, relatedId].sort((first, second) => first.localeCompare(second));
      const key = `${left}:${right}`;
      if (pairs.has(key)) continue;
      pairs.set(key, {
        roles: [left, right],
        reason: 'These selected responsibilities require independent review; one implementation owner must not be the sole approver for both sides.',
      });
    }
  }
  return [...pairs.values()].sort((left, right) => left.roles.join(':').localeCompare(right.roles.join(':')));
}

export function teamRecommendation(root, context = null, registry = loadTeamRoleRegistry()) {
  const target = fs.statSync(root, { throwIfNoEntry: false });
  if (!target?.isDirectory()) throw usageError('Target directory does not exist.');
  if (!context) return needsInputResult();
  const verifiedContext = validateTeamContext(context, registry);
  const repositoryPackages = repositoryPackageEvidence(root);
  const recommendations = registry.roles
    .map((role) => selectedRole(role, verifiedContext, repositoryPackages, verifiedContext.technologyPackages))
    .filter(Boolean);
  const neededNow = recommendations.filter((role) => role.priority === 'needed-now').map((role) => role.id);
  const conditionalLater = recommendations.filter((role) => role.priority === 'conditional-later').map((role) => role.id);
  const coreIds = neededNow.filter((id) => ['product-domain-owner', 'technical-delivery-owner', 'quality-and-release-reviewer'].includes(id));
  const minimumRoleIds = [...new Set([
    ...coreIds,
    ...recommendations.filter((role) => role.priority === 'needed-now' && role.id.endsWith('-reviewer')).map((role) => role.id),
  ])];
  const confirmedSignals = verifiedContext.confirmedSignals.map((signal) => ({ id: `business.${signal}`, kind: 'user-confirmed-business-signal', signal, confidence: 'high' }));
  const openQuestions = [];
  if (!verifiedContext.stage) openQuestions.push('Confirm the delivery stage before treating platform and operations coverage as needed now.');
  if (verifiedContext.confirmedSignals.length === 0) openQuestions.push('Confirm whether authorization, tenancy, payment, sensitive data, regulated data, or realtime media are in scope before assigning specialist review coverage.');
  if (repositoryPackages.size === 0 && verifiedContext.technologyPackages.length === 0) openQuestions.push('Confirm the intended technology packages; no exact package evidence was available for stack-specific coverage.');
  const productTeam = dynamicTeamPlan(verifiedContext);
  return {
    schemaVersion: 1,
    mode: 'read-only-advice',
    teamType: registry.teamType,
    target: '.',
    status: 'complete',
    teamScope: verifiedContext.teamScope,
    businessDescription: { status: 'provided-not-returned' },
    evidence: {
      repositoryFacts: repositoryFacts(repositoryPackages, registry.roles, verifiedContext),
      confirmedInputs: [
        { id: 'business.description', kind: 'user-provided-business-description', confidence: 'high' },
        ...confirmedSignals,
        ...(verifiedContext.stage ? [{ id: `business.stage.${verifiedContext.stage}`, kind: 'user-confirmed-stage', stage: verifiedContext.stage, confidence: 'high' }] : []),
      ],
    },
    recommendations,
    productTeam,
    variants: [
      {
        id: 'minimum',
        appliesWhen: 'Start with the core accountable coverage; one person may combine compatible slots, but independent review remains required for high-risk changes.',
        roleIds: minimumRoleIds,
      },
      {
        id: 'recommended',
        appliesWhen: 'Cover every responsibility marked needed-now by the confirmed context and exact technology evidence.',
        roleIds: neededNow,
      },
      {
        id: 'scale-up',
        appliesWhen: 'Add only the conditional coverage after its stated activation trigger is confirmed.',
        roleIds: [...neededNow, ...conditionalLater],
      },
    ],
    requiredSeparations: requiredSeparations(recommendations),
    assumptions: [
      'This is a responsibility-coverage suggestion, not a hiring plan, staffing commitment, cost estimate, or delivery guarantee.',
      'Repository dependencies are evidence of declared technology only; they do not prove production use, business scope, security, compliance, or team capability.',
      'The business description is processed as untrusted local input and is not persisted or returned in this result.',
    ],
    openQuestions,
    actionsPerformed: [],
    boundary: 'No people, agents, permissions, tasks, files, or external messages were created or changed. Unapproved roles remain proposals only; legal, privacy, and employment decisions require qualified human review.',
  };
}
