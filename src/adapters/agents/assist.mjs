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
  const prompt = 'Read docs/ai/bootstrap-prompt.md and complete the repository-specific governance work it describes. Preserve generated adapters.';
  const args = agent.assist.args.map((value) => value.replace('{target}', target).replace('{prompt}', prompt));
  const result = runner(agent.assist.command, args, { cwd: target, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    return { ok: false, status: 'unverified', reason: result.error?.message ?? `${agent.assist.command} exited with ${result.status}`, retry };
  }
  return { ok: true, status: 'completed', reason: `${agent.label} completed its interactive run.`, retry: null };
}
