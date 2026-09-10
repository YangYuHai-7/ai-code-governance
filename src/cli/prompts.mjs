import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultConfig } from '../generator.mjs';
import { classifyProject } from '../project-assessment.mjs';
import { usageError } from '../kernel/index.mjs';

function indexes(value, size) {
  const result = value.split(',').map((item) => Number.parseInt(item.trim(), 10) - 1).filter((item) => Number.isInteger(item) && item >= 0 && item < size);
  return [...new Set(result)];
}

async function chooseOne(rl, label, options, defaultIndex = 0) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
  const prompt = Number.isInteger(defaultIndex) ? `请选择 / Select [${defaultIndex + 1}]: ` : '请选择 / Select: ';
  const answer = (await rl.question(prompt)).trim();
  const selected = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) throw usageError(`必须显式选择 / An explicit selection is required for ${label}.`);
  return options[selected].value;
}

async function chooseMany(rl, label, options, defaultValues) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}${defaultValues.includes(option.value) ? ' [默认 / default]' : ''}`));
  const answer = (await rl.question('请选择编号，多个用逗号分隔 / Select comma-separated numbers [defaults]: ')).trim();
  if (!answer) return [...defaultValues];
  const selected = indexes(answer, options.length);
  if (selected.length === 0) throw usageError(`至少选择一项 / Select at least one value for ${label}.`);
  return selected.map((index) => options[index].value);
}

async function yesNo(rl, label, defaultValue = false) {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await rl.question(`${label} ${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (['y', 'yes', '是'].includes(answer)) return true;
  if (['n', 'no', '否'].includes(answer)) return false;
  throw usageError(`请输入是或否 / Expected yes or no for: ${label}`);
}

export async function promptConfig(scan, seed = defaultConfig(scan), { locale = null } = {}) {
  const rl = createInterface({ input, output });
  try {
    const interactionLanguage = locale ?? await chooseOne(rl, 'Interaction language / 交互语言', [
      { label: '中文', value: 'zh-CN' },
      { label: 'English', value: 'en' },
    ], seed.interactionLanguage === 'zh-CN' ? 0 : 1);
    const zh = interactionLanguage === 'zh-CN';
    console.log(zh ? `目标：${scan.root}` : `Target: ${scan.root}`);
    console.log(zh ? `检测到的项目模式：${scan.projectMode}` : `Detected mode: ${scan.projectMode}`);
    console.log(zh ? `检测到的技术栈：${scan.stacks.map((stack) => `${stack.id} (${stack.evidence})`).join(', ')}` : `Detected stacks: ${scan.stacks.map((stack) => `${stack.id} (${stack.evidence})`).join(', ')}`);
    const assessment = classifyProject(scan);
    const recordedInitialization = seed.initialization?.lifecycle && seed.initialization?.source ? seed.initialization : null;
    let initialization = recordedInitialization ?? { lifecycle: null, existingCodeStrategy: null, source: null };
    if (recordedInitialization) {
      console.log(`Recorded initialization decision is preserved: lifecycle=${recordedInitialization.lifecycle}, strategy=${recordedInitialization.existingCodeStrategy ?? 'not-applicable'}, source=${recordedInitialization.source}. Use an explicit --config initialization change to replace it.`);
    } else if (assessment.codebase.lifecycle.value === 'ambiguous') {
      const lifecycle = await chooseOne(rl, 'Repository lifecycle confirmation', [
        { label: 'New project scaffold', value: 'greenfield' },
        { label: 'Existing project governance', value: 'existing' },
      ], null);
      initialization = { lifecycle, existingCodeStrategy: null, source: null };
    } else if (assessment.codebase.lifecycle.value === 'existing') {
      const strategy = await chooseOne(rl, 'Existing-code strategy', [
        { label: 'Keep existing code unchanged', value: 'keep-existing' },
        { label: 'Apply the standard to new code only', value: 'new-code-standard' },
        { label: 'Prepare a separately approved staged migration', value: 'staged-migration' },
      ], null);
      initialization = { lifecycle: 'existing', existingCodeStrategy: strategy, source: null };
    } else {
      console.log('Repository lifecycle: greenfield (high-confidence scanner result).');
      initialization = { lifecycle: 'greenfield', existingCodeStrategy: null, source: null };
    }
    if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
      const strategy = await chooseOne(rl, 'Existing-code strategy', [
        { label: 'Keep existing code unchanged', value: 'keep-existing' },
        { label: 'Apply the standard to new code only', value: 'new-code-standard' },
        { label: 'Prepare a separately approved staged migration', value: 'staged-migration' },
      ], null);
      initialization = { ...initialization, existingCodeStrategy: strategy };
    }

    const clientMode = await chooseOne(rl, zh ? '客户端支持范围' : 'Client support scope', [
      { label: zh ? '全部内建客户端（Codex、Claude Code、Cursor）' : 'All built-in clients (Codex, Claude Code, Cursor)', value: 'all-built-in' },
      { label: zh ? '仅指定客户端' : 'Selected clients only', value: 'selected' },
    ], null);
    const clients = clientMode === 'all-built-in' ? ['codex', 'claude-code', 'cursor'] : await chooseMany(
      rl,
      zh ? 'AI 客户端' : 'AI clients',
      [
        { label: 'Codex', value: 'codex' },
        { label: 'Claude Code', value: 'claude-code' },
        { label: 'Cursor', value: 'cursor' },
        { label: 'Generic AGENTS.md-compatible agent', value: 'generic' },
      ],
      [],
    );
    const allPacks = (await import('../registry.mjs')).loadCapabilityRegistry().packs.map((pack) => ({ label: `${pack.id} (${pack.evidence})`, value: pack.id }));
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
    const confirmedRiskSignals = !constraintAnswer ? [] : await chooseMany(rl, zh ? '已由负责人确认的风险信号（不从约束文本推断）' : 'Owner-confirmed risk signals (not inferred from constraint text)', [
      { label: 'Authentication', value: 'authentication' },
      { label: 'Authorization', value: 'authorization' },
      { label: 'Payment', value: 'payment' },
      { label: 'Sensitive data', value: 'sensitive-data' },
      { label: 'External side effect', value: 'external-side-effect' },
      { label: 'Multi-tenancy', value: 'multi-tenancy' },
      { label: 'Data consistency', value: 'data-consistency' },
      { label: 'Public API', value: 'public-api' },
    ], seed.confirmedRiskSignals ?? []);
    const aiAssist = await yesNo(rl, 'Run an installed AI agent after deterministic initialization?', false);

    return {
      ...seed,
      interactionLanguage,
      clients,
      clientSupport: { mode: clientMode, selectedClients: clients, source: 'interactive' },
      stacks,
      governanceDepth,
      artifactLanguage,
      supportedOs,
      initialization,
      features: { knowledge, taskRuntime, hooks, externalWorkflows, ciIntegration, aiAssist },
      domainConstraints: constraintAnswer ? constraintAnswer.split(';').map((item) => item.trim()).filter(Boolean) : [],
      confirmedRiskSignals,
    };
  } finally {
    rl.close();
  }
}
export async function confirmPlan(paths, planHash = null, initialization = null, implementationBoundary = null) {
  const rl = createInterface({ input, output });
  try {
    console.log('\nPlanned managed files:');
    for (const item of paths) console.log(`  ${item.changed ? 'write' : 'keep '} ${item.path}`);
    if (planHash) console.log(`Plan hash: ${planHash}`);
    if (initialization) {
      console.log(`Initialization lifecycle: ${initialization.lifecycle} (source: ${initialization.source})`);
      console.log(`Existing-code strategy: ${initialization.existingCodeStrategy ?? 'not-applicable'}`);
      console.log(`Implementation boundary: ${implementationBoundary ?? 'unverified'}`);
    }
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
