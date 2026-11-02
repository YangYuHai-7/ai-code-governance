import { loadAgentRegistry } from '../../registry.mjs';
import { commandExists, runCommand } from '../process/index.mjs';

export function assistCandidates(config, options = {}) {
  const registry = loadAgentRegistry();
  const isAvailable = options.commandExists ?? commandExists;
  return registry.agents.filter((agent) => config.clients.includes(agent.id) && agent.assist && isAvailable(agent.assist.command));
}

export function runAssist(agentId, target, options = {}) {
  const agent = loadAgentRegistry().agents.find((candidate) => candidate.id === agentId);
  const isAvailable = options.commandExists ?? commandExists;
  const runner = options.spawnSync ?? runCommand;
  const retry = `aicg init . --yes --assist ${agentId}`;
  if (!agent?.assist) return { ok: false, status: 'unverified', reason: `${agentId} does not provide an AI completion command.`, retry };
  if (!isAvailable(agent.assist.command)) return { ok: false, status: 'unverified', reason: `${agent.assist.command} is not installed or not on PATH.`, retry };
  let prompt = options.lifecycle === 'existing'
    ? 'Read docs/ai/skills/brownfield-enrichment/SKILL.md, docs/ai/skills/brownfield-understanding/SKILL.md, and docs/ai/development/index.json. Record the owner answer in brownfieldEnrichmentDecision before doing the work. Work through every indexed unit using actual code, tests, manifests, and contracts: replace each scan baseline with Evidence-reviewed behavior and Local development workflow sections, record existing business meaning in docs/memory/INDEX.json and owning module pages, and propose evidence-backed, reusable project Skills plus project conventions through the configured discovery and approval workflow. Keep semantic summaries unverified until owner review and preserve source digests and reciprocal links; never invent business rules. Preserve all product code, existing human content, and generated adapters. Run aicg check . and report brownfield.gaps and any unverified claims.'
    : 'Read docs/ai/bootstrap-prompt.md and complete the repository-specific governance work it describes. Preserve generated adapters.';
  if (options.lifecycle === 'existing' && (options.brownfieldEnrichment === 'off' || options.businessMemoryDeclined)) {
    prompt = 'Read the selected development documents and current source, tests, manifests and contracts. Complete only authorized code-backed documentation and development guidance. Business Memory enrichment was declined or disabled: do not expand that scope. Preserve product code, manual documents and generated adapters; report unknowns as gaps.';
  }
  prompt += ' Keep human development explanations, architecture and business-flow diagrams together in docs/development/. Derive separate actionable guides in docs/development/skills/<name>.md from reviewed documentation; compile them with aicg sync into complete development Skills. Each guide needs name/description frontmatter and When to use, Required invariants, Correct implementation shape, Incorrect implementation shape and Verification matrix sections. Include concrete rules and examples, no source-code hyperlinks or symlinks, and no whole-document pointer substitutes. Preserve unknowns as gaps. Baseline role definitions must map responsibilities and handoffs to the actual project units; role files do not prove independent participation.';
  if (options.architectureDocumentation) prompt += ' Read docs/development/architecture.md and follow its existing authoritative references. Complete system overview, module architecture and core business flow diagrams from source or requirements, with evidence references and a negative branch. Preserve manual diagrams. A scan skeleton is not completed documentation.';
  if (options.lifecycle === 'greenfield') prompt += ' First produce a requirements-backed system overview, module architecture, business flow, development conventions and implementation plan. Present the concrete package for customer confirmation before application scaffolds, dependency installation, product configuration or implementation code. Existing same-scope confirmation can be reused; material changes require renewed confirmation. Templates and checks do not prove customer approval.';
  const args = agent.assist.args.map((value) => value.replace('{target}', target).replace('{prompt}', prompt));
  const result = runner(agent.assist.command, args, { cwd: target, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    return { ok: false, status: 'unverified', reason: result.error?.message ?? `${agent.assist.command} exited with ${result.status}`, retry };
  }
  return { ok: true, status: 'completed', reason: `${agent.label} completed its interactive run.`, retry: null };
}
