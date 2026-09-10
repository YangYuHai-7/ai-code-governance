import { SUPPORTED_INTERACTION_LANGUAGES, TOOL_VERSION } from '../constants.mjs';
import { classifyProject, detectSurfaceSignals, projectSourcePaths, verificationNpmCommands } from '../modules/repository/index.mjs';
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

function guidedInitCommand(prefix, locale, { migrateLinks = false } = {}) {
  return `${prefix} init . --guided --locale ${locale}${migrateLinks ? ' --migrate-links' : ''}`;
}

function guidanceReason(locale, action) {
  if (action.id === 'confirm-lifecycle') {
    return localized(locale, '当前文件不足以可靠判断项目阶段，需要你确认后才能安全生成治理文件。', 'The current files do not reliably identify the project stage, so your confirmation is required before governance files can be created safely.');
  }
  if (action.id === 'migrate-managed-links') {
    return localized(locale, '检测到旧的适配器链接；先预览精确迁移可避免覆盖未知文件。', 'A legacy managed adapter link was detected; previewing its exact migration avoids overwriting unknown files.');
  }
  if (action.id === 'resolve-incomplete-repository-scan') {
    return localized(locale, '扫描没有读完仓库，因此当前建议可能遗漏重要文件。', 'The scan did not finish reading the repository, so the current advice may omit important files.');
  }
  return localized(locale, '这是当前最早可安全完成的一步；完成后再根据新结果继续。', 'This is the earliest safe next step; complete it before choosing from later recommendations.');
}

function claimBoundary(locale) {
  return localized(locale, '本次结果只解释当前仓库证据，不会写入文件，也不证明应用已可上线。', 'This result only explains current repository evidence; it writes no files and does not prove the application is ready for production.');
}

export function printHumanGuidance(result) {
  const guide = result.actionGuide;
  const locale = guide.locale;
  const action = guide.recommendedAction;
  const labels = locale === 'zh-CN'
    ? { action: '建议操作：', command: '下一条命令：', reason: '原因：', boundary: '边界：' }
    : { action: 'ACTION: ', command: 'NEXT COMMAND: ', reason: 'REASON: ', boundary: 'BOUNDARY: ' };
  console.log(`${labels.action}${action.description}`);
  if (action.command) console.log(`${labels.command}${action.command}`);
  console.log(`${labels.reason}${guide.reason}`);
  console.log(`${labels.boundary}${guide.claimBoundary}`);
}

export function initSuccessGuidance(config) {
  const locale = resolveLocale(null, config);
  const prefix = invocationPrefix(config);
  const action = {
    id: 'check-generated-governance',
    description: localized(locale, '检查刚生成的治理文件是否完整。', 'Check that the generated governance files are complete.'),
    command: `${prefix} check . --json`,
    readOnly: true,
  };
  return {
    actionGuide: {
      locale,
      recommendedAction: action,
      reason: localized(locale, '初始化已完成；下一步是用只读检查确认文件和入口一致。', 'Initialization is complete; the next step is a read-only check that generated files and entrypoints agree.'),
      claimBoundary: localized(locale, '初始化成功只证明治理文件已生成，不证明业务功能或上线条件已验证。', 'Successful initialization only proves governance files were generated; it does not verify product behavior or production readiness.'),
    },
  };
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
  const warnings = [];
  const surfaceSignals = detectSurfaceSignals(scan);

  if (!scanComplete) {
    const recoveryAction = {
      id: 'resolve-incomplete-repository-scan',
      description: localized(locale, '先处理未读取的路径或过大文件，然后重新运行本检查。', 'Resolve unreadable paths or oversized files, then run this check again.'),
      command: null,
      readOnly: true,
    };
    nextSteps.push(recoveryAction);
    warnings.push({
      id: 'incomplete-repository-scan',
      message: localized(locale, '未能读完仓库。', 'The repository scan did not complete.'),
      recoveryAction,
    });
  }

  const managedLinksDetected = scan.links.filter((relative) => /(^|\/)(\.cursor|\.claude|\.agents|docs\/ai)(\/|$)/.test(relative));
  if (managedLinksDetected.length > 0) {
    const recoveryAction = {
      id: 'migrate-managed-links',
      description: localized(locale, '预览旧适配器链接的安全迁移。', 'Preview the safe migration of the managed adapter link.'),
      command: config
        ? `${prefix} sync . --dry-run --migrate-links`
        : guidedInitCommand(prefix, locale, { migrateLinks: true }),
      readOnly: true,
    };
    nextSteps.unshift(recoveryAction);
    warnings.unshift({
      id: 'managed-adapter-link',
      message: localized(locale, '检测到旧的适配器链接。', 'A legacy managed adapter link was detected.'),
      paths: managedLinksDetected,
      recoveryAction,
    });
  }

  if (!confirmedLifecycle && classification.codebase.lifecycle.value === 'ambiguous') {
    nextSteps.push({
      id: 'confirm-lifecycle',
      description: localized(locale, '请选择“新项目”或“已有项目”，然后按引导完成初始化。', 'Choose "new project" or "existing project", then finish setup through the guided flow.'),
      command: guidedInitCommand(prefix, locale),
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
  if (scanComplete && surfaceSignals.length > 0) {
    nextSteps.push({
      id: 'declare-surface-verification',
      description: localized(
        locale,
        '检测到尚未验证的运行界面；查看 docs/ai/surface-verification-profiles.json，并在 docs/ai/surface-verification.json 声明真实可达入口后再选择安全验证命令。',
        'Detected runtime surfaces remain unverified; review docs/ai/surface-verification-profiles.json and declare a real reachable entrypoint in docs/ai/surface-verification.json before selecting a safe verification command.',
      ),
      command: null,
      readOnly: false,
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

  if (nextSteps.length === 0) {
    nextSteps.push(config
      ? {
          id: 'check-current-governance',
          description: localized(locale, '运行只读检查，确认当前治理文件仍然一致。', 'Run the read-only check to confirm the current governance files still agree.'),
          command: `${prefix} check . --json`,
          readOnly: true,
        }
      : {
          id: 'start-guided-initialization',
          description: localized(locale, '按引导选择项目阶段、工具和治理强度。', 'Choose the project stage, tools, and governance level through the guided setup.'),
          command: guidedInitCommand(prefix, locale),
          readOnly: false,
        });
  }

  const recommendedAction = nextSteps[0];

  return {
    ...result,
    actionGuide: {
      locale,
      readOnly: true,
      recommendedAction,
      reason: guidanceReason(locale, recommendedAction),
      claimBoundary: claimBoundary(locale),
      warnings,
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
      surfaceVerification: {
        state: surfaceSignals.length > 0 ? 'detected-unverified' : 'not-applicable',
        signals: surfaceSignals,
        declarationPath: 'docs/ai/surface-verification.json',
        profilesPath: 'docs/ai/surface-verification-profiles.json',
        mutatesConfiguration: false,
      },
      postInitRescan: rescan,
    },
    nextSteps,
  };
}
