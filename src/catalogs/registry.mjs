import path from 'node:path';
import { CONFIG_PATH, PACKAGE_ROOT, SUPPORTED_CLIENTS } from '../constants.mjs';
import { readJson } from '../adapters/filesystem/index.mjs';
import { usageError } from '../kernel/index.mjs';

/** Historical governance roots, kept in this order because they feed a recorded hash. */
const LEGACY_GOVERNANCE_ROOTS = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/rules',
  '.claude/skills',
  '.agents/skills',
  'docs/ai',
  // The single delivery workflow document sits at the docs root, next to the canonical AI
  // governance root. It is generated governance, so the scanner must never report it as
  // unowned production source and init must be allowed to write it.
  'docs/WORKFLOW.md',
  CONFIG_PATH,
]);

export function loadAgentRegistry() {
  const registry = readJson(path.join(PACKAGE_ROOT, 'assets/registries/agent-registry.json'));
  if (registry.schema_version !== 1 || !Array.isArray(registry.agents)) {
    throw new Error('Agent registry is invalid.');
  }
  const ids = registry.agents.map((agent) => agent.id);
  for (const id of SUPPORTED_CLIENTS) {
    if (!ids.includes(id)) throw new Error(`Agent registry is missing ${id}.`);
  }
  return registry;
}

/**
 * Built-in clients `--clients all` selects, in registry declaration order.
 *
 * `built_in` is deliberate: the registry also carries client entries (generic, deepseek)
 * that are selectable by id but are not part of the one-shot all-client scope, and a bare
 * `SUPPORTED_CLIENTS` list cannot distinguish them. New built-in clients are declared once
 * in the registry and every scope derivation follows.
 */
export function allBuiltInClientIds(registry = loadAgentRegistry()) {
  return registry.agents.filter((agent) => agent.built_in === true).map((agent) => agent.id);
}

export function loadCapabilityRegistry() {
  const registry = readJson(path.join(PACKAGE_ROOT, 'assets/registries/capability-pack-registry.json'));
  if (registry.schema_version !== 1 || !Array.isArray(registry.packs)) {
    throw new Error('Capability pack registry is invalid.');
  }
  return registry;
}

export function resolveAgents(ids, registry = loadAgentRegistry()) {
  const requested = [...new Set(ids)];
  if (requested.length === 0) throw usageError('Select at least one agent.');
  return requested.map((id) => {
    const agent = registry.agents.find((candidate) => candidate.id === id);
    if (!agent) throw usageError(`Unsupported agent: ${id}`);
    return agent;
  });
}
export function resolvePacks(ids, registry = loadCapabilityRegistry()) {
  const requested = [...new Set(ids)];
  if (requested.length === 0) throw usageError('Select at least one technology stack.');
  return requested.map((id) => {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    if (!pack) throw usageError(`Unsupported technology stack: ${id}`);
    return pack;
  });
}

/**
 * The registry is the single source of truth for where each client reads Skills and rules.
 * Every generated adapter path derives from this map. Previously each generator repeated its
 * own `clients.includes('claude-code')` branch, which meant adding one client required editing
 * eight call sites and any missed site silently generated an unreachable adapter.
 */
export function skillDirectoryOwners(registry = loadAgentRegistry()) {
  const owners = new Map();
  for (const agent of registry.agents) {
    for (const directory of agent.skill_directories ?? []) {
      if (!owners.has(directory)) owners.set(directory, []);
      owners.get(directory).push(agent.id);
    }
  }
  return owners;
}

/** Adapter roots to write for the selected clients, in registry declaration order. */
export function selectedSkillDirectories(clients, registry = loadAgentRegistry()) {
  const selected = new Set(clients);
  return [...skillDirectoryOwners(registry).entries()]
    .filter(([, owners]) => owners.some((id) => selected.has(id)))
    .map(([directory]) => directory);
}

/** Governance-owned roots a scanner must never classify as production source. */
export function governanceRoots(registry = loadAgentRegistry()) {
  // Roots feed `input_fingerprint`, so their order is part of a repository's recorded hash.
  // The legacy roots keep their historical position and any root a newly registered client
  // introduces is appended in sorted order. That keeps existing recorded approvals valid
  // while still covering every directory an agent can read governance from.
  const roots = new Set(LEGACY_GOVERNANCE_ROOTS);
  for (const agent of registry.agents) {
    if (agent.instruction_entry) roots.add(agent.instruction_entry);
    for (const directory of agent.skill_directories ?? []) roots.add(directory);
    for (const directory of agent.rule_directories ?? []) roots.add(directory);
  }
  const known = LEGACY_GOVERNANCE_ROOTS.filter((relative) => roots.has(relative));
  const added = [...roots].filter((relative) => !LEGACY_GOVERNANCE_ROOTS.includes(relative)).sort();
  return [...known, ...added];
}

/** Registry-declared directories an agent reads governance from, excluding entry files. */
export function declaredGovernanceDirectories(registry = loadAgentRegistry()) {
  return governanceRoots(registry).filter((relative) => !/\.[a-z0-9]+$/i.test(relative));
}

/** Registry-declared Skill directories only. */
export function declaredSkillDirectories(registry = loadAgentRegistry()) {
  return [...skillDirectoryOwners(registry).keys()];
}

/**
 * Repository-home directory of every registered client's governance (`.claude`, `.dsh`, ...).
 *
 * Modules that classify a client's repository home as governance derive it here instead of
 * repeating client names, so registering a client needs no module edit. `docs/ai` is the
 * canonical root rather than a client home and is deliberately excluded.
 */
export function clientGovernanceHomeDirectories(registry = loadAgentRegistry()) {
  const homes = new Set();
  for (const agent of registry.agents) {
    for (const directory of [...(agent.skill_directories ?? []), ...(agent.rule_directories ?? [])]) {
      const home = String(directory).split('/')[0];
      if (home && home !== 'docs') homes.add(home);
    }
  }
  return [...homes].sort();
}

/**
 * Boundary helpers over the registered client governance homes. Build once per module so the
 * registry is read a single time instead of once per scanned file.
 */
export function clientGovernanceMatchers(registry = loadAgentRegistry()) {
  const homes = clientGovernanceHomeDirectories(registry);
  const set = new Set(homes);
  return {
    homes,
    /** True when the path's first segment is a client governance home. */
    isPath(relative) {
      if (typeof relative !== 'string') return false;
      return set.has(relative.replaceAll('\\', '/').split('/')[0]);
    },
    /** True when any segment of the path is a client governance home. */
    touches(relative) {
      if (typeof relative !== 'string') return false;
      return relative.replaceAll('\\', '/').split('/').some((segment) => set.has(segment));
    },
  };
}

/**
 * Clients whose governance footprint already exists in the repository.
 *
 * Client scope is the one choice AICG refuses to guess silently, because the answer decides
 * which adapter trees get written. A repository that already carries a client's governance
 * directory has answered that question itself, so the answer can be read instead of asked.
 *
 * The signal is a declared root, not a Skill file inside it: `.claude/settings.json` proves
 * Claude Code as well as `.claude/skills/x/SKILL.md` does, and an operator who deleted every
 * Skill still has the client. Roots come from the registry, so registering a client teaches
 * this function about it instead of requiring another branch here.
 *
 * `.agents` is declared by codex, cursor and generic, so on its own it cannot name a client,
 * and neither can `AGENTS.md`. A shared root is only reported when nothing else already
 * covers one of its owners - a Cursor repository carries `.cursor/rules` next to
 * `.agents/skills`, and must not be reported as also using codex.
 *
 * Returns null when the repository shows no footprint at all: silence is not ambiguity, and
 * a guess there writes adapter trees for tools that are not present.
 */
export function inferClientScopeFromRepository(relativePaths, registry = loadAgentRegistry()) {
  const owners = new Map();
  const add = (root, client) => {
    if (!root) return;
    if (!owners.has(root)) owners.set(root, []);
    if (!owners.get(root).includes(client)) owners.get(root).push(client);
  };
  for (const agent of registry.agents) {
    // A client can opt out of repository inference when its declared roots are too common to
    // prove anything: `.github/` is present in almost every repository, so seeing it must not
    // silently switch Copilot on.
    if (agent.inferable === false) continue;
    add(agent.instruction_entry, agent.id);
    for (const directory of [...(agent.skill_directories ?? []), ...(agent.rule_directories ?? [])]) {
      add(String(directory).split('/')[0], agent.id);
    }
  }
  const present = [...new Set(relativePaths ?? [])];
  const matched = [];
  for (const [root, candidates] of owners) {
    const path = present.find((relative) => relative === root || relative.startsWith(`${root}/`));
    if (path !== undefined) matched.push({ root, path, candidates });
  }
  if (matched.length === 0) return null;
  const selected = new Set();
  for (const entry of matched) if (entry.candidates.length === 1) selected.add(entry.candidates[0]);
  const evidence = [];
  for (const entry of matched) {
    // Shared roots are satisfied when an unambiguous root already named one of their owners.
    const unambiguous = entry.candidates.length === 1;
    const covered = entry.candidates.find((id) => selected.has(id));
    const inferred = unambiguous ? entry.candidates[0] : covered ?? entry.candidates[0];
    selected.add(inferred);
    evidence.push({ root: entry.root, path: entry.path, candidates: entry.candidates, inferred, shared: !unambiguous });
  }
  const order = registry.agents.map((agent) => agent.id);
  const clients = order.filter((id) => selected.has(id));
  return { clients, evidence };
}

