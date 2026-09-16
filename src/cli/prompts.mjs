import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultConfig, governanceBootstrapCommand, projectLocalAvailable } from '../generator.mjs';
import { classifyProject } from '../project-assessment.mjs';
import { usageError } from '../kernel/index.mjs';
import { loadCapabilityRegistry } from '../registry.mjs';

/** Recommendations start deferred; inspecting metadata never approves a candidate. */
export async function promptAdaptiveDecisions(summary, { readline, locale = 'en' } = {}) {
  const rl = readline ?? createInterface({ input, output });
  const decisions = { skills: [], roles: [] };
  try {
    for (const [kind, items] of [['skills', summary.skills.candidates], ['roles', summary.team.roleProposals]]) {
      for (const item of items) {
        let action;
        do {
          action = await chooseOne(rl, `${kind}: ${item.title ?? item.id}`, [
            { value: 'defer', label: locale === 'zh-CN' ? '暂缓（默认）' : 'Defer (default)' },
            { value: 'add', label: locale === 'zh-CN' ? '加入精确审批计划' : 'Add to exact approval plan' },
            { value: 'reject', label: locale === 'zh-CN' ? '拒绝' : 'Reject' },
            { value: 'details', label: locale === 'zh-CN' ? '查看元数据' : 'Inspect metadata' },
          ], 0, locale);
          if (action === 'details') console.log(JSON.stringify(item, null, 2));
        } while (action === 'details');
        decisions[kind].push({ id: item.id, action });
      }
    }
    return decisions;
  } finally {
    if (!readline) rl.close();
  }
}

function indexes(value, size) {
  const result = value.split(',').map((item) => Number.parseInt(item.trim(), 10) - 1).filter((item) => Number.isInteger(item) && item >= 0 && item < size);
  return [...new Set(result)].sort((left, right) => left - right);
}

async function chooseOne(rl, label, options, defaultIndex = 0, locale = null) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
  const basePrompt = locale === 'zh-CN' ? '请选择' : locale === 'en' ? 'Select' : '请选择 / Select';
  const prompt = Number.isInteger(defaultIndex) ? `${basePrompt} [${defaultIndex + 1}]: ` : `${basePrompt}: `;
  const answer = (await rl.question(prompt)).trim();
  const selected = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) throw usageError(`必须显式选择 / An explicit selection is required for ${label}.`);
  return options[selected].value;
}

async function chooseMany(rl, label, options, defaultValues, { locale = null, required = true } = {}) {
  console.log(`\n${label}`);
  const defaultMarker = locale === 'zh-CN' ? ' [默认]' : locale === 'en' ? ' [default]' : ' [默认 / default]';
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}${defaultValues.includes(option.value) ? defaultMarker : ''}`));
  const prompt = locale === 'zh-CN'
    ? '请选择编号，多个用逗号分隔 [默认值]: '
    : locale === 'en' ? 'Select comma-separated numbers [defaults]: '
      : '请选择编号，多个用逗号分隔 / Select comma-separated numbers [defaults]: ';
  const answer = (await rl.question(prompt)).trim();
  if (!answer && defaultValues.length > 0) {
    const defaults = new Set(defaultValues);
    return options.map((option) => option.value).filter((value) => defaults.has(value));
  }
  if (!answer && !required) return [];
  if (!answer) throw usageError(`至少选择一项 / Select at least one value for ${label}.`);
  const selected = indexes(answer, options.length);
  if (selected.length === 0) throw usageError(`至少选择一项 / Select at least one value for ${label}.`);
  return selected.map((index) => options[index].value);
}

function localized(locale, en, zh) {
  if (locale === 'zh-CN') return zh;
  if (locale === 'en') return en;
  return `${en} / ${zh}`;
}

function clientOptions(locale) {
  return [
    { label: localized(locale, 'Codex (recommended)', 'Codex（推荐）'), value: 'codex' },
    { label: 'Claude Code', value: 'claude-code' },
    { label: 'Cursor', value: 'cursor' },
    { label: localized(locale, 'Generic AGENTS.md-compatible agent', '通用 AGENTS.md 兼容 Agent'), value: 'generic' },
  ];
}

function clientSupportMode(clients) {
  return clients.length === 3 && ['codex', 'claude-code', 'cursor'].every((client) => clients.includes(client))
    ? 'all-built-in'
    : 'selected';
}

function artifactLanguageOptions(locale) {
  return [
    { label: localized(locale, 'English (recommended)', '英语（推荐）'), value: 'en' },
    { label: localized(locale, 'Simplified Chinese', '简体中文'), value: 'zh-CN' },
  ];
}

function stackOptions() {
  return loadCapabilityRegistry().packs.map((pack) => ({
    label: `${pack.id} (${pack.evidence})`,
    value: pack.id,
  }));
}

function detectedStackSummary(scan) {
  return scan.stacks.map((stack) => {
    const paths = stack.paths?.length > 0 ? `; ${stack.paths.join(', ')}` : '';
    return `${stack.id} (${stack.evidence}${paths})`;
  }).join(', ');
}

async function promptStacks(rl, scan, initialization, locale, { guided = false } = {}) {
  const choose = guided
    ? (label, options, defaultIndex) => guidedChoice(rl, locale, label, options, defaultIndex)
    : (label, options, defaultIndex) => chooseOne(rl, label, options, defaultIndex, locale);
  const detected = scan.stacks.map((stack) => stack.id);
  if (initialization.lifecycle === 'existing') {
    const separator = locale === 'zh-CN' ? '：' : ': ';
    console.log(`\n${localized(locale, 'Detected technology stacks', '检测到的技术栈')}${separator}${detectedStackSummary(scan)}`);
    const action = await choose(
      localized(locale, 'Confirm or correct detected technology stacks?', '确认或修正检测到的技术栈？'),
      [
        { label: localized(locale, 'Confirm detected stacks (recommended)', '确认检测结果（推荐）'), value: 'confirm' },
        { label: localized(locale, 'Correct the stack selection', '修正技术栈选择'), value: 'correct' },
      ],
      0,
    );
    if (action === 'confirm') return detected;
    return chooseMany(rl, localized(locale, 'Correct technology stacks', '修正技术栈'), stackOptions(), detected, { locale });
  }
  return chooseMany(
    rl,
    localized(locale, 'Target technology stacks', '目标技术栈'),
    stackOptions(),
    detected,
    { locale },
  );
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
  preserveCodeDocumentationPolicy = false,
  preserveInvocation = false,
} = {}) {
  const rl = readline ?? createInterface({ input, output });
  const ownsReadline = readline === null;
  try {
    const interactionLanguage = locale ?? seed.interactionLanguage ?? 'en';
    const zh = interactionLanguage === 'zh-CN';
    const assessment = classifyProject(scan);

    let clients = seed.clients;
    let clientSupport = seed.clientSupport;
    if (!clientSupport) {
      clients = await chooseMany(
        rl,
        localized(locale, 'Which AI coding tools should this project support?', '要支持哪些 AI 编码工具？'),
        clientOptions(locale),
        ['codex'],
        { locale },
      );
      clientSupport = {
        mode: clientSupportMode(clients),
        selectedClients: clients,
        source: 'interactive',
      };
    }

    const artifactLanguage = preserveArtifactLanguage ? seed.artifactLanguage : await guidedChoice(
      rl,
      interactionLanguage,
      localized(locale, 'Governance artifact language', '治理产物语言'),
      artifactLanguageOptions(locale),
      0,
    );

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
    const stacks = await promptStacks(rl, scan, initialization, interactionLanguage, { guided: true });
    if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
      const existingCodeStrategy = await guidedChoice(rl, interactionLanguage, zh ? '新治理如何对待现有代码？' : 'How should new governance treat existing code?', [
        { label: zh ? '保持现有代码不变（推荐）' : 'Keep existing code unchanged (recommended)', value: 'keep-existing' },
        { label: zh ? '仅对以后的新代码使用新规则' : 'Apply new rules only to future code', value: 'new-code-standard' },
        { label: zh ? '只准备一份待单独批准的分阶段计划' : 'Prepare a separately approved staged plan', value: 'staged-migration' },
      ]);
      initialization = { ...initialization, existingCodeStrategy };
    }

    const governanceDepth = preserveDepth ? seed.governanceDepth : await guidedChoice(rl, interactionLanguage, zh ? '需要多少治理内容？' : 'How much governance do you need?', [
      { label: zh ? '最小：先获得基本规则和检查（推荐）' : 'Minimal: start with core rules and checks (recommended)', value: 'minimal' },
      { label: zh ? '标准：加入路由、项目规则和验证指引' : 'Standard: add routing, project rules, and verification guidance', value: 'standard' },
      { label: zh ? '完整：适合长期、多人协作' : 'Complete: for long-running, multi-person work', value: 'complete' },
    ]);
    let invocationMode = seed.invocationMode;
    if (!preserveInvocation) {
      const localAvailable = projectLocalAvailable(scan.root);
      if (!localAvailable) console.log(zh
        ? '\n未检测到项目本地 AICG 可执行文件。请显式选择固定版本启动或全局安装方式。'
        : '\nNo project-local AICG executable was found. Explicitly choose pinned bootstrap or a global installation.');
      invocationMode = await chooseOne(rl, zh ? '以后如何在这个项目里运行 AICG？' : 'How will you run AICG in this project?', [
        ...(localAvailable ? [{ label: zh ? '使用项目已安装的版本（推荐）' : 'Use the version installed in this project (recommended)', value: 'project-local' }] : []),
        { label: zh ? '固定版本启动（需要 npm 包解析）' : 'Pinned bootstrap (requires npm package resolution)', value: 'npm-exec-pinned' },
        { label: zh ? '使用电脑上全局安装的版本' : 'Use a globally installed version', value: 'global' },
      ], localAvailable ? 0 : null, interactionLanguage);
      if (invocationMode === 'npm-exec-pinned') console.log(zh
        ? `固定版本启动帮助：${governanceBootstrapCommand(seed)}。这不会安装日常 CLI；日常使用前请显式安装全局版本，或本地安装后选择 project-local。`
        : `Pinned bootstrap help: ${governanceBootstrapCommand(seed)}. This does not install a daily CLI; explicitly install globally before daily work, or install locally and select project-local.`);
    }

    return {
      ...seed,
      interactionLanguage,
      artifactLanguage,
      codeDocumentationPolicy: preserveCodeDocumentationPolicy
        ? seed.codeDocumentationPolicy
        : initialization.lifecycle === 'existing' ? 'inherit-existing' : 'en',
      clients,
      clientSupport,
      stacks,
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

export async function promptConfig(scan, seed = defaultConfig(scan), {
  locale = null,
  readline = null,
  preserveCodeDocumentationPolicy = false,
} = {}) {
  const rl = readline ?? createInterface({ input, output });
  const ownsReadline = readline === null;
  try {
    const interactionLanguage = locale ?? seed.interactionLanguage ?? 'en';
    const zh = interactionLanguage === 'zh-CN';

    const clients = await chooseMany(
      rl,
      localized(locale, 'Which AI coding tools should this project support?', '要支持哪些 AI 编码工具？'),
      clientOptions(locale),
      seed.clientSupport?.selectedClients ?? ['codex'],
      { locale },
    );
    const artifactLanguage = await chooseOne(
      rl,
      localized(locale, 'Governance artifact language', '治理产物语言'),
      artifactLanguageOptions(locale),
      0,
      locale,
    );

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
      initialization = { lifecycle: 'existing', existingCodeStrategy: null, source: null };
    } else {
      console.log('Repository lifecycle: greenfield (high-confidence scanner result).');
      initialization = { lifecycle: 'greenfield', existingCodeStrategy: null, source: null };
    }
    const stacks = await promptStacks(rl, scan, initialization, interactionLanguage);
    if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
      const strategy = await chooseOne(rl, 'Existing-code strategy', [
        { label: 'Keep existing code unchanged', value: 'keep-existing' },
        { label: 'Apply the standard to new code only', value: 'new-code-standard' },
        { label: 'Prepare a separately approved staged migration', value: 'staged-migration' },
      ], null);
      initialization = { ...initialization, existingCodeStrategy: strategy };
    }

    const governanceDepth = await chooseOne(rl, 'Governance depth', [
      { label: 'Minimal', value: 'minimal' },
      { label: 'Standard (recommended)', value: 'standard' },
      { label: 'Complete', value: 'complete' },
    ], ['minimal', 'standard', 'complete'].indexOf(seed.governanceDepth));
    const supportedOs = await chooseMany(rl, 'Supported operating systems', [
      { label: 'macOS', value: 'macos' },
      { label: 'Windows', value: 'windows' },
      { label: 'Linux', value: 'linux' },
    ], seed.supportedOs, { locale: interactionLanguage });
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
    ], seed.confirmedRiskSignals ?? [], { locale: interactionLanguage, required: false });
    const aiAssist = await yesNo(rl, 'Run an installed AI agent after deterministic initialization?', false);

    return {
      ...seed,
      interactionLanguage,
      clients,
      clientSupport: {
        mode: clientSupportMode(clients),
        selectedClients: clients,
        source: 'interactive',
      },
      stacks,
      governanceDepth,
      artifactLanguage,
      codeDocumentationPolicy: preserveCodeDocumentationPolicy
        ? seed.codeDocumentationPolicy
        : initialization.lifecycle === 'existing' ? 'inherit-existing' : 'en',
      supportedOs,
      initialization,
      features: { knowledge, taskRuntime, hooks, externalWorkflows, ciIntegration, aiAssist },
      domainConstraints: constraintAnswer ? constraintAnswer.split(';').map((item) => item.trim()).filter(Boolean) : [],
      confirmedRiskSignals,
    };
  } finally {
    if (ownsReadline) rl.close();
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
