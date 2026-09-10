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

async function guidedChoice(rl, locale, label, options, defaultIndex = 0) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
  const prompt = locale === 'zh-CN' ? `请选择 [${defaultIndex + 1}]: ` : `Select [${defaultIndex + 1}]: `;
  const answer = (await rl.question(prompt)).trim();
  const selected = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    throw usageError(locale === 'zh-CN' ? `请为“${label}”选择一个有效编号。` : `Select one valid number for "${label}".`);
  }
  return options[selected].value;
}

export async function promptGuidedConfig(scan, seed = defaultConfig(scan), {
  locale = null,
  readline = null,
  preserveDepth = false,
  preserveArtifactLanguage = false,
  preserveInvocation = false,
} = {}) {
  const rl = readline ?? createInterface({ input, output });
  const ownsReadline = readline === null;
  try {
    const interactionLanguage = locale ?? await guidedChoice(rl, 'en', 'Choose your language / 选择语言', [
      { label: '中文', value: 'zh-CN' },
      { label: 'English', value: 'en' },
    ], seed.interactionLanguage === 'zh-CN' ? 0 : 1);
    const zh = interactionLanguage === 'zh-CN';
    const assessment = classifyProject(scan);

    let initialization = seed.initialization?.lifecycle
      ? { ...seed.initialization }
      : { lifecycle: null, existingCodeStrategy: null, source: null };
    if (!initialization.lifecycle) {
      const detected = assessment.codebase.lifecycle.value;
      const defaultIndex = detected === 'existing' ? 1 : 0;
      const lifecycle = await guidedChoice(rl, interactionLanguage, zh ? '这是哪类项目？' : 'What kind of project is this?', [
        { label: zh ? '新项目或只有初始文件（推荐）' : 'New project or starter files (recommended)', value: 'greenfield' },
        { label: zh ? '已有可运行代码的项目' : 'Existing project with working code', value: 'existing' },
      ], defaultIndex);
      initialization = { lifecycle, existingCodeStrategy: null, source: null };
    }
    if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
      const existingCodeStrategy = await guidedChoice(rl, interactionLanguage, zh ? '新治理如何对待现有代码？' : 'How should new governance treat existing code?', [
        { label: zh ? '保持现有代码不变（推荐）' : 'Keep existing code unchanged (recommended)', value: 'keep-existing' },
        { label: zh ? '仅对以后的新代码使用新规则' : 'Apply new rules only to future code', value: 'new-code-standard' },
        { label: zh ? '只准备一份待单独批准的分阶段计划' : 'Prepare a separately approved staged plan', value: 'staged-migration' },
      ]);
      initialization = { ...initialization, existingCodeStrategy };
    }

    let clients = seed.clients;
    let clientSupport = seed.clientSupport;
    if (!clientSupport) {
      const clientChoice = await guidedChoice(rl, interactionLanguage, zh ? '要支持哪些 AI 编码工具？' : 'Which AI coding tools should this project support?', [
        { label: zh ? '仅 Codex（推荐）' : 'Codex only (recommended)', value: 'codex' },
        { label: zh ? '全部内建工具（Codex、Claude Code、Cursor）' : 'All built-in tools (Codex, Claude Code, Cursor)', value: 'all' },
        { label: zh ? '仅 Claude Code' : 'Claude Code only', value: 'claude-code' },
        { label: zh ? '仅 Cursor' : 'Cursor only', value: 'cursor' },
      ]);
      clients = clientChoice === 'all' ? ['codex', 'claude-code', 'cursor'] : [clientChoice];
      clientSupport = {
        mode: clientChoice === 'all' ? 'all-built-in' : 'selected',
        selectedClients: clients,
        source: 'interactive',
      };
    }

    const governanceDepth = preserveDepth ? seed.governanceDepth : await guidedChoice(rl, interactionLanguage, zh ? '需要多少治理内容？' : 'How much governance do you need?', [
      { label: zh ? '最小：先获得基本规则和检查（推荐）' : 'Minimal: start with core rules and checks (recommended)', value: 'minimal' },
      { label: zh ? '标准：加入路由、项目规则和验证指引' : 'Standard: add routing, project rules, and verification guidance', value: 'standard' },
      { label: zh ? '完整：适合长期、多人协作' : 'Complete: for long-running, multi-person work', value: 'complete' },
    ]);
    const invocationMode = preserveInvocation ? seed.invocationMode : await guidedChoice(rl, interactionLanguage, zh ? '以后如何在这个项目里运行 AICG？' : 'How will you run AICG in this project?', [
      { label: zh ? '使用项目已安装的版本（推荐）' : 'Use the version installed in this project (recommended)', value: 'project-local' },
      { label: zh ? '每次使用当前固定版本' : 'Use the currently pinned version each time', value: 'npm-exec-pinned' },
      { label: zh ? '使用电脑上全局安装的版本' : 'Use a globally installed version', value: 'global' },
    ]);

    return {
      ...seed,
      interactionLanguage,
      artifactLanguage: preserveArtifactLanguage ? seed.artifactLanguage : interactionLanguage,
      clients,
      clientSupport,
      governanceDepth,
      invocationMode,
      initialization,
      features: {
        ...seed.features,
        knowledge: false,
        taskRuntime: false,
        hooks: false,
        externalWorkflows: false,
        ciIntegration: false,
        aiAssist: false,
      },
    };
  } finally {
    if (ownsReadline) rl.close();
  }
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
    return await yesNo(rl, 'Apply this plan?', false);
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
