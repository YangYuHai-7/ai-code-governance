import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, MANIFEST_PATH, TOOL_NAME } from '../../constants.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';
import { decideSkillCandidates, validateSkillDecision } from '../skills/index.mjs';
import { validateConfig } from './compiler.mjs';
import { applyArtifactPlan, planArtifacts } from './managed-files.mjs';

const INDEX_PATH = '.ai-governance/state/skill-index.json';

function readRegular(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Relocation refuses symbolic links.');
  }
  if (!fs.statSync(current).isFile()) throw new Error('Relocation requires regular managed files.');
  return fs.readFileSync(current, 'utf8');
}

export function prepareRootRelocation(root, previousRoot) {
  if (!path.isAbsolute(root) || !path.isAbsolute(previousRoot) || root === previousRoot
    || path.resolve(root) !== root || path.resolve(previousRoot) !== previousRoot) {
    throw new Error('Relocation requires distinct normalized absolute roots.');
  }
  if (fs.realpathSync(root) !== root) throw new Error('Relocation refuses a linked root.');
  const manifestText = readRegular(root, MANIFEST_PATH);
  const manifest = JSON.parse(manifestText);
  if (manifest.generatedBy !== TOOL_NAME || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Relocation requires a managed manifest.');
  }
  const originals = new Map();
  const entries = new Map();
  for (const relative of [CONFIG_PATH, INDEX_PATH]) {
    const matches = manifest.files.filter(entry => entry.path === relative && entry.ownership === 'full');
    if (matches.length !== 1) throw new Error('Relocation requires unique managed entries.');
    const content = readRegular(root, relative);
    const historical = content.replaceAll(root, previousRoot);
    if (sha256(historical) !== matches[0].sha256) throw new Error('Changes exceed a root-only relocation.');
    originals.set(relative, content);
    entries.set(relative, matches[0]);
  }
  const config = JSON.parse(originals.get(CONFIG_PATH));
  const decision = config.skillDiscovery?.decision;
  if (!decision || stableJson(decision) !== stableJson(JSON.parse(originals.get(INDEX_PATH)))) {
    throw new Error('Relocation requires matching configuration and Skill index.');
  }
  if (decision.applied || decision.activeForTask) throw new Error('Active Skill receipts require a separate migration.');
  const candidates = decision.candidates.map(candidate => {
    if (candidate.sourceKind !== 'project') return candidate;
    if (![root, previousRoot].includes(candidate.location?.root)) throw new Error('Unexpected project source root.');
    return { ...candidate, location: { ...candidate.location, root } };
  });
  const proposed = decideSkillCandidates({ candidates, sourceStatus: decision.sourceStatus }, { selectedIds: decision.selectedIds });
  const rebound = decideSkillCandidates({ candidates, sourceStatus: decision.sourceStatus }, {
    selectedIds: decision.selectedIds, approvalPlanHash: proposed.planHash,
  });
  config.skillDiscovery.decision = rebound;
  const { skillDiscovery, agentTeam, ...base } = config;
  const artifactPlan = skillDiscovery.artifactPlan;
  if (!artifactPlan || artifactPlan.contextHash !== sha256(stableJson(base))) throw new Error('Governance context changed.');
  artifactPlan.planHash = sha256(stableJson({ schemaVersion: 1, contextHash: artifactPlan.contextHash,
    decision: rebound, bundledSkillImports: skillDiscovery.bundledSkillImports === true, agentTeam, cost: artifactPlan.cost }));
  skillDiscovery.approvalPlanHash = artifactPlan.planHash;
  validateConfig(config);
  validateSkillDecision(rebound, { root });
  const artifacts = [
    { ...entries.get(CONFIG_PATH), content: JSON.stringify(config, null, 2) + '\n' },
    { ...entries.get(INDEX_PATH), content: JSON.stringify(rebound, null, 2) + '\n' },
  ];
  const plan = planArtifacts(root, artifacts, { force: true });
  if (plan.conflicts.length || plan.operations.some(operation => operation.remove || ![CONFIG_PATH, INDEX_PATH].includes(operation.path))) {
    throw new Error('Relocation plan exceeds the two managed metadata files.');
  }
  const retainedManifest = structuredClone(manifest);
  for (const artifact of artifacts) {
    retainedManifest.files.find(entry => entry.path === artifact.path).sha256 = sha256(artifact.content);
  }
  plan.manifest = { value: retainedManifest, content: stableJson(retainedManifest), changed: true };
  const planHash = sha256(stableJson({ root, previousRoot, manifest: sha256(manifestText),
    before: [...originals].map(([relative, content]) => [relative, sha256(content)]),
    after: artifacts.map(artifact => [artifact.path, sha256(artifact.content)]) }));
  return { root, previousRoot, planHash, plan, config, actionsPerformed: [] };
}

export function applyRootRelocation(root, previousRoot, approvedPlanHash) {
  const prepared = prepareRootRelocation(root, previousRoot);
  if (approvedPlanHash !== prepared.planHash) throw new Error('Relocation requires exact plan approval.');
  return applyArtifactPlan(root, prepared.plan, {
    transactional: true,
    verify: () => {
      const config = JSON.parse(readRegular(root, CONFIG_PATH));
      validateConfig(config);
      validateSkillDecision(config.skillDiscovery.decision, { root });
      return { ok: true };
    },
  });
}
