import { SUPPORTED_INTERACTION_LANGUAGES, TOOL_VERSION } from '../constants.mjs';
import { classifyProject, projectSourcePaths, verificationNpmCommands } from '../modules/repository/index.mjs';
import { usageError } from '../kernel/index.mjs';

function resolveLocale(requestedLocale, config) {
  const locale = requestedLocale ?? config?.interactionLanguage ?? 'en';
  if (!SUPPORTED_INTERACTION_LANGUAGES.includes(locale)) {
    throw usageError(`--locale must be one of: ${SUPPORTED_INTERACTION_LANGUAGES.join(', ')}.`);
  }
  return locale;
}

function invocationPrefix(config) {
  if (config?.invocationMode === 'project-local') return 'npm exec -- aicg';
  if (config?.invocationMode === 'global') return 'aicg';
  if (config?.invocationMode === 'npm-exec-pinned') {
    return `npm exec --yes --package=ai-code-governance@${config.toolVersion ?? TOOL_VERSION} -- aicg`;
  }
  return 'aicg';
}

function localized(locale, zh, en) {
  return locale === 'zh-CN' ? zh : en;
}

function lifecycleMeaning(locale, classification, config) {
  const detected = classification.codebase.lifecycle.value;
  const confirmed = config?.initialization?.lifecycle ?? null;
  if (confirmed) {
    return localized(
      locale,
      `扫描证据当前为 ${detected}；用户已确认 lifecycle=${confirmed}。projectMode 和后续扫描变化不会覆盖该决定，也不构成冲突。`,
      `Current scan evidence is ${detected}; the user-confirmed lifecycle is ${confirmed}. projectMode and later scan changes do not override that decision or create a conflict.`,
    );
  }
  if (detected === 'ambiguous') {
    return localized(
      locale,
      '当前只有 manifest 或未解释文件；lifecycle 需要用户确认是新脚手架还是已有项目，扫描得到的 brownfield/ambiguous 不是初始化冲突。',
      'Only manifests or unexplained files were detected; lifecycle needs user confirmation as a new scaffold or existing project. The scanned brownfield/ambiguous shape is not an initialization conflict.',
    );
  }
  return localized(
    locale,
    `扫描证据推断 lifecycle=${detected}；写入治理前仍应确认会影响现有代码的边界。`,
    `Scan evidence suggests lifecycle=${detected}; confirm any boundary that affects existing code before governance writes.`,
  );
}

function postInitRescan(scan, config) {
  if (!config) {
    return { recommended: false, newSourcePathCount: 0, newSourcePaths: [], detectedUnconfiguredStacks: [], mutatesConfiguration: false };
  }
  const baseline = new Set(
    config.architecture?.scope?.baselineSourcePaths
      ?? config.initialClassification?.codebase?.evidence?.sourceFiles
      ?? [],
  );
  const allNewSourcePaths = projectSourcePaths(scan).filter((relative) => !baseline.has(relative));
  const configuredStacks = new Set(config.stacks ?? []);
  const detectedUnconfiguredStacks = scan.stacks
    .map((stack) => stack.id)
    .filter((id) => id !== 'generic-unknown' && !configuredStacks.has(id));
  return {
    recommended: allNewSourcePaths.length > 0 || detectedUnconfiguredStacks.length > 0,
    newSourcePathCount: allNewSourcePaths.length,
    newSourcePaths: allNewSourcePaths.slice(0, 12),
    detectedUnconfiguredStacks,
    mutatesConfiguration: false,
  };
}

export function addReadOnlyGuidance(kind, result, scan, { locale: requestedLocale, config = null } = {}) {
  const locale = resolveLocale(requestedLocale, config);
  const classification = kind === 'assess' ? result.classification : classifyProject(scan);
  const confirmedLifecycle = config?.initialization?.lifecycle ?? null;
  const prefix = invocationPrefix(config);
  const rescan = postInitRescan(scan, config);
  const scanComplete = scan.scanBudget?.complete !== false;
  const allowedVerificationCommands = verificationNpmCommands(scan.commands)
    .map((candidate) => candidate.command)
    .sort((left, right) => left.localeCompare(right));
  const nextSteps = [];

  if (!scanComplete) {
    nextSteps.push({
      id: 'resolve-incomplete-repository-scan',
      description: localized(locale, '仓库扫描不完整；先处理不可读路径、过大文件或扫描预算边界，再依赖分类、架构建议或完成门禁。', 'The repository scan is incomplete; resolve unreadable paths, oversized files, or scan-budget limits before relying on classification, architecture advice, or completion.'),
      command: null,
      readOnly: true,
    });
  }

  if (!confirmedLifecycle && classification.codebase.lifecycle.value === 'ambiguous') {
    nextSteps.push({
      id: 'confirm-lifecycle',
      description: localized(locale, '确认这是新脚手架还是已有项目，再选择 init 的 lifecycle；不要把 projectMode 当作用户决定。', 'Confirm whether this is a new scaffold or an existing project before selecting the init lifecycle; do not treat projectMode as the user decision.'),
      command: null,
      readOnly: true,
    });
  }
  if (kind === 'doctor' && result.ok) {
    nextSteps.push({
      id: 'assess-current-repository',
      description: localized(locale, '只读扫描当前仓库形态、生命周期证据和可用验证命令。', 'Read the current repository shape, lifecycle evidence, and allowed verification commands without writing files.'),
      command: `${prefix} assess . --locale ${locale} --json`,
      readOnly: true,
    });
  }
  if (scanComplete && rescan.recommended) {
    nextSteps.push(
      {
        id: 'review-current-architecture',
        description: localized(locale, '源码在 init 后发生增长；只读复查当前架构建议，不自动改变已确认生命周期、配置或技术栈。', 'Source appeared after init; review current architecture advice without changing the confirmed lifecycle, configuration, or stacks.'),
        command: `${prefix} architecture . --locale ${locale} --json`,
        readOnly: true,
      },
      {
        id: 'preview-current-standards',
        description: localized(locale, '只读预览当前已配置技术栈的标准；检测到的新技术栈仅作为候选，需用户明确决定后才能更新治理。', 'Preview standards for the currently configured stacks. Newly detected stacks remain candidates until the user explicitly decides to update governance.'),
        command: `${prefix} standards . --json`,
        readOnly: true,
      },
    );
  } else if (scanComplete && kind === 'assess') {
    nextSteps.push({
      id: 'review-current-architecture',
      description: localized(locale, '只读查看适合当前扫描结果的架构建议。', 'Review architecture advice for the current scan without writing files.'),
      command: `${prefix} architecture . --locale ${locale} --json`,
      readOnly: true,
    });
  }
  if (scanComplete && allowedVerificationCommands.length > 0) {
    nextSteps.push({
      id: 'select-verification-command',
      description: localized(locale, '从 allowedVerificationCommands 选择一条当前命令传给 complete；不要附加未列出的参数。', 'Select one current allowedVerificationCommands entry for complete; do not append unlisted arguments.'),
      command: `${prefix} complete . --verify "<allowed command>" --json`,
      readOnly: true,
    });
  }

  return {
    ...result,
    actionGuide: {
      locale,
      readOnly: true,
      repositoryScan: {
        complete: scanComplete,
        budget: scan.scanBudget ?? null,
      },
      projectMode: {
        value: scan.projectMode,
        meaning: localized(locale, 'projectMode 仅描述扫描到的仓库形态，不是用户确认的项目 lifecycle。', 'projectMode describes the detected repository scan shape; it is not the user-confirmed project lifecycle.'),
      },
      lifecycle: {
        detected: classification.codebase.lifecycle.value,
        confirmed: confirmedLifecycle,
        requiresUserConfirmation: !confirmedLifecycle && classification.codebase.lifecycle.value === 'ambiguous',
        meaning: lifecycleMeaning(locale, classification, config),
      },
      allowedVerificationCommands,
      postInitRescan: rescan,
    },
    nextSteps,
  };
}
