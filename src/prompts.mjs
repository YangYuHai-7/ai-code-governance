import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultConfig } from './generator.mjs';

function indexes(value, size) {
  const result = value.split(',').map((item) => Number.parseInt(item.trim(), 10) - 1).filter((item) => Number.isInteger(item) && item >= 0 && item < size);
  return [...new Set(result)];
}

async function chooseOne(rl, label, options, defaultIndex = 0) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
  const answer = (await rl.question(`Select [${defaultIndex + 1}]: `)).trim();
  const selected = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) throw new Error(`Invalid selection for ${label}.`);
  return options[selected].value;
}

async function chooseMany(rl, label, options, defaultValues) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}${defaultValues.includes(option.value) ? ' [default]' : ''}`));
  const answer = (await rl.question('Select comma-separated numbers [defaults]: ')).trim();
  if (!answer) return [...defaultValues];
  const selected = indexes(answer, options.length);
  if (selected.length === 0) throw new Error(`Select at least one value for ${label}.`);
  return selected.map((index) => options[index].value);
}

async function yesNo(rl, label, defaultValue = false) {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await rl.question(`${label} ${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (['y', 'yes'].includes(answer)) return true;
  if (['n', 'no'].includes(answer)) return false;
  throw new Error(`Expected yes or no for: ${label}`);
}

export async function promptConfig(scan, seed = defaultConfig(scan)) {
  const rl = createInterface({ input, output });
  try {
    console.log(`Target: ${scan.root}`);
    console.log(`Detected mode: ${scan.projectMode}`);
    console.log(`Detected stacks: ${scan.stacks.map((stack) => `${stack.id} (${stack.evidence})`).join(', ')}`);

    const clients = await chooseMany(
      rl,
      'AI agents',
      [
        { label: 'Codex', value: 'codex' },
        { label: 'Claude Code', value: 'claude-code' },
        { label: 'Cursor', value: 'cursor' },
        { label: 'Generic AGENTS.md-compatible agent', value: 'generic' },
      ],
      seed.clients,
    );
    const allPacks = (await import('./registry.mjs')).loadCapabilityRegistry().packs.map((pack) => ({ label: `${pack.id} (${pack.evidence})`, value: pack.id }));
    const stacks = await chooseMany(rl, 'Technology stacks', allPacks, seed.stacks);
    const governanceDepth = await chooseOne(rl, 'Governance depth', [
      { label: 'Minimal', value: 'minimal' },
      { label: 'Standard (recommended)', value: 'standard' },
      { label: 'Complete', value: 'complete' },
    ], ['minimal', 'standard', 'complete'].indexOf(seed.governanceDepth));
    const artifactLanguage = await chooseOne(rl, 'Governance artifact language', [
      { label: 'Chinese', value: 'zh-CN' },
      { label: 'English', value: 'en' },
      { label: 'Bilingual', value: 'bilingual' },
    ], ['zh-CN', 'en', 'bilingual'].indexOf(seed.artifactLanguage));
    const supportedOs = await chooseMany(rl, 'Supported operating systems', [
      { label: 'macOS', value: 'macos' },
      { label: 'Windows', value: 'windows' },
      { label: 'Linux', value: 'linux' },
    ], seed.supportedOs);
    const knowledge = governanceDepth === 'complete' && await yesNo(rl, 'Generate the knowledge-memory layer?', true);
    const taskRuntime = governanceDepth === 'complete' && await yesNo(rl, 'Generate the long-running task runtime?', true);
    const hooks = await yesNo(rl, 'Prepare project hooks?', false);
    const externalWorkflows = await yesNo(rl, 'Enable an external workflow provider configuration?', false);
    const ciIntegration = await yesNo(rl, 'Prepare target-project CI integration?', false);
    const constraintAnswer = (await rl.question('Optional project constraints (semicolon separated): ')).trim();
    const aiAssist = await yesNo(rl, 'Run an installed AI agent after deterministic initialization?', false);

    return {
      ...seed,
      clients,
      stacks,
      governanceDepth,
      artifactLanguage,
      supportedOs,
      features: { knowledge, taskRuntime, hooks, externalWorkflows, ciIntegration, aiAssist },
      domainConstraints: constraintAnswer ? constraintAnswer.split(';').map((item) => item.trim()).filter(Boolean) : [],
    };
  } finally {
    rl.close();
  }
}
export async function confirmPlan(paths, planHash = null) {
  const rl = createInterface({ input, output });
  try {
    console.log('\nPlanned managed files:');
    for (const item of paths) console.log(`  ${item.changed ? 'write' : 'keep '} ${item.path}`);
    if (planHash) console.log(`Plan hash: ${planHash}`);
    return yesNo(rl, 'Apply this plan?', false);
  } finally {
    rl.close();
  }
}

export async function chooseAssistAgent(candidates) {
  if (candidates.length === 0) return null;
  const rl = createInterface({ input, output });
  try {
    return chooseOne(rl, 'AI completion agent', candidates.map((candidate) => ({ label: candidate.label, value: candidate.id })), 0);
  } finally {
    rl.close();
  }
}
