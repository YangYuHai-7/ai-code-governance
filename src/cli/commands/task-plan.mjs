import path from 'node:path';
import { buildDevelopmentGuidance } from '../../modules/governance/development-guidance.mjs';
import { usageError } from '../../kernel/index.mjs';
import { scanProject } from '../../scanner.mjs';
import { classifyTaskRoute, minimumTaskLevelFromPaths } from '../../modules/governance/task-routing.mjs';
import { recommendTaskRoles } from '../../modules/governance/task-role-routing.mjs';
import { buildDeliveryCapabilityPlan, readDeliveryAuthority } from '../../modules/governance/delivery-capabilities.mjs';
import { assertManagedArchitectureConfigTrusted, loadExistingConfig, mergeConfig } from '../shared.mjs';
import { defaultConfig, validateConfig } from '../../generator.mjs';

const WRITE_SIGNAL = /(?:修复|修改|更改|改动|新增|添加|实现|重构|开发|编辑|写入|\b(?:fix(?:es|ed|ing)?|change(?:s|d|ing)?|modif(?:y|ies|ied|ying)|edit(?:s|ed|ing)?|add(?:s|ed|ing)?|implement(?:s|ed|ing)?|refactor(?:s|ed|ing)?|build(?:s|ing)?|built|write(?:s|ing)?|wrote|written)\b)/gi;
const READ_ONLY_SIGNAL = /(?:只读|仅(?:做|进行)?(?:评估|审查|检查|分析|查看|解释|读取|调研|复核|总结)|只(?:做|进行)?(?:评估|审查|检查|分析|查看|解释|读取|调研|复核|总结)|\bread[- ]only\b|\b(?:review|analyse|analyze|inspect|evaluate|check|explain)\s+only\b|\bonly\s+(?:review|analyse|analyze|inspect|evaluate|check|explain)\b)/gi;
const HIGH_RISK_SIGNAL = /(?:迁移|部署|发布|支付|权限|认证|migration|deploy|release|payment|authorization|authentication)/i;
const BUSINESS_SIGNAL = /(?:业务|合同|需求|规则|流程|business|contract|requirements|workflow)/i;

function uniqueSignals(matches) {
  return [...new Set(matches.map((value) => value.toLocaleLowerCase()))];
}

function clausePrefix(text, index) {
  const boundary = Math.max(
    text.lastIndexOf(',', index - 1), text.lastIndexOf('，', index - 1),
    text.lastIndexOf(';', index - 1), text.lastIndexOf('；', index - 1),
    text.lastIndexOf('.', index - 1), text.lastIndexOf('。', index - 1),
    text.lastIndexOf('!', index - 1), text.lastIndexOf('！', index - 1),
    text.lastIndexOf('?', index - 1), text.lastIndexOf('？', index - 1),
    text.lastIndexOf('\n', index - 1),
  );
  return text.slice(boundary + 1, index);
}

function isNegatedWriteSignal(text, index) {
  const prefix = clausePrefix(text, index);
  // Keep this deterministic and bounded: explicit read-only scopes and local clause negation
  // suppress keyword hits, while contrast words and "not only" keep real write requests visible.
  if (/\bnot\s+only\s*$/i.test(prefix)) return false;
  const chineseReadOnlyScope = /^\s*(?:仅|只)(?:做|进行)?(?:评估|审查|检查|分析|查看|解释|读取|调研|复核|总结)(?![^\n]*?(?:但|却|而是|除非))[^\n]*$/;
  const englishReadOnlyScope = /^\s*(?:(?:only\s+)?(?:review|analyse|analyze|inspect|evaluate|check|explain)\s+only|only\s+(?:review|analyse|analyze|inspect|evaluate|check|explain))(?![^\n]*?\b(?:but|however|instead|unless|then)\b)[^\n]*$/i;
  if (chineseReadOnlyScope.test(prefix) || englishReadOnlyScope.test(prefix)) return true;
  const chineseNegation = /(?:不要|不得|禁止|避免|无需|无须|不需(?:要)?|不允许|不应|不能|不)\s*(?:(?:对|将|把|任何|该|这些|此|目标|相关|文件|代码|内容|项目|仓库|它|其|进行|作|做|再|直接)\s*)*$/;
  const englishNegation = /(?:\bdo\s+not|\bdon't|\bmust\s+not|\bshould\s+not|\bshouldn't|\bcannot|\bcan't|\bnever|\bwithout|\bavoid|\bno)\s+(?:(?:make|making|any|the|a|an|file|files|code|source|content|project|repository|repo|please|directly)\s+)*$/i;
  const chineseCoordinatedNegation = /(?:不要|不得|禁止|避免|无需|无须|不需(?:要)?|不允许|不应|不能|不)\s*(?:(?:对|将|把|任何|该|这些|此|目标|相关|文件|代码|内容|项目|仓库|它|其|进行|作|做|再|直接|修复|修改|更改|改动|新增|添加|实现|重构|开发|编辑|写入|或|和|与|以及|、)\s*)*$/;
  const englishCoordinatedNegation = /(?:\bdo\s+not|\bdon't|\bmust\s+not|\bshould\s+not|\bshouldn't|\bcannot|\bcan't|\bnever|\bwithout|\bavoid|\bno)\s+(?:(?:make|making|any|the|a|an|file|files|code|source|content|project|repository|repo|please|directly|fix(?:es|ed|ing)?|change(?:s|d|ing)?|modif(?:y|ies|ied|ying)|edit(?:s|ed|ing)?|add(?:s|ed|ing)?|implement(?:s|ed|ing)?|refactor(?:s|ed|ing)?|build(?:s|ing)?|built|write(?:s|ing)?|wrote|written|or|and)\s+)*$/i;
  return chineseNegation.test(prefix) || englishNegation.test(prefix)
    || chineseCoordinatedNegation.test(prefix) || englishCoordinatedNegation.test(prefix);
}

export function classifyTaskTextIntent(text) {
  const writeMatches = [...text.matchAll(WRITE_SIGNAL)];
  const positiveWriteSignals = [];
  const negatedWriteSignals = [];
  for (const match of writeMatches) {
    const target = isNegatedWriteSignal(text, match.index) ? negatedWriteSignals : positiveWriteSignals;
    target.push(match[0]);
  }
  const readOnlySignals = uniqueSignals([...text.matchAll(READ_ONLY_SIGNAL)].map((match) => match[0]));
  const positive = uniqueSignals(positiveWriteSignals);
  const negated = uniqueSignals(negatedWriteSignals);
  const hasReadOnlyEvidence = readOnlySignals.length > 0 || negated.length > 0;
  const classification = positive.length > 0 && hasReadOnlyEvidence
    ? 'ambiguous-write'
    : positive.length > 0
      ? 'write'
      : hasReadOnlyEvidence
        ? 'read-only'
        : 'unspecified';
  return { classification, positiveWriteSignals: positive, negatedWriteSignals: negated, readOnlySignals };
}

export function planTask(root, { text, paths = [], taskKind = 'feature', bugfix = null } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw usageError('route --text requires a nonempty task of at most 4000 characters.');
  const scan = scanProject(root);
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('Task role routing requires initialized governance. Run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  if (!Array.isArray(paths) || paths.length > 128) throw usageError('route paths must be an array of at most 128 repository-relative paths.');
  const pathLevel = paths.length ? minimumTaskLevelFromPaths(paths, config, { taskKind, bugfix }) : 'L0';
  const textIntent = classifyTaskTextIntent(text);
  // Callers pass changed paths as mutation evidence, so path evidence outranks prose that says
  // the task is read-only. The conflict remains visible in intentEvidence and reasonCodes.
  const wantsWrite = textIntent.positiveWriteSignals.length > 0 || paths.length > 0;
  const surfaceCount = new Set(paths.map((relative) => relative.split('/')[0])).size;
  const classifiedRoute = classifyTaskRoute({
    mutation: !wantsWrite ? 'none' : ['L2', 'L3'].includes(pathLevel) || textIntent.positiveWriteSignals.length > 0 ? 'product-behavior' : 'non-production',
    scope: pathLevel === 'L3' && surfaceCount > 1 ? 'multi-surface' : surfaceCount > 1 ? 'multi-module' : paths.length ? 'single-module' : 'single-file',
    risk: wantsWrite && (HIGH_RISK_SIGNAL.test(text) || (pathLevel === 'L3' && surfaceCount <= 1)) ? 'high-consequence' : wantsWrite && BUSINESS_SIGNAL.test(text) ? 'business' : 'low',
    clarity: paths.length || !wantsWrite ? 'clear' : 'locally-ambiguous',
    taskKind,
    bugfix,
  });
  const intentReasonCode = textIntent.classification === 'read-only'
    ? 'text-intent:read-only-explicit'
    : textIntent.classification === 'ambiguous-write'
      ? 'text-intent:ambiguous-write-conservative'
      : textIntent.classification === 'write'
        ? 'text-intent:write'
        : null;
  const route = {
    ...classifiedRoute,
    level: ['L0', 'L1', 'L1.5', 'L2', 'L3'].indexOf(pathLevel) > ['L0', 'L1', 'L1.5', 'L2', 'L3'].indexOf(classifiedRoute.level) ? pathLevel : classifiedRoute.level,
    reasonCodes: [
      ...classifiedRoute.reasonCodes,
      ...(intentReasonCode ? [intentReasonCode] : []),
      ...(paths.length ? ['path-evidence:changed-paths-priority'] : []),
      ...(paths.length && config.taskRouting?.productionMinimumLevel && ['L2', 'L3'].includes(pathLevel) ? ['path-evidence:project-production-floor'] : []),
    ],
    intentEvidence: {
      ...textIntent,
      effectiveIntent: wantsWrite ? 'write' : 'read-only',
      changedPathCount: paths.length,
    },
  };
  const recommendation = recommendTaskRoles({ taskText: text, changedPaths: paths, route, availableRoles: config.agentTeam?.enabled ? config.agentTeam.roleProposals : [], taskKind, bugfix });
  const effectiveLevel = recommendation.routeEvidence.effectiveLevel;
  return {
    schemaVersion: 1,
    task: text,
    route: { ...route, level: effectiveLevel },
    roles: recommendation,
    developmentGuidance: buildDevelopmentGuidance(scan.root, config, scan, effectiveLevel, paths),
    delivery: buildDeliveryCapabilityPlan({ text, paths, route: { ...route, level: effectiveLevel }, config, scan, authority: readDeliveryAuthority(scan.root) }),
    process: {
      [effectiveLevel]: {
        L0: 'Answer or analyze using read-only evidence; no implementation or test run is required.',
        L1: 'Confirm the local change scope, apply a small reversible change, run targeted verification, and write a test result report.',
        'L1.5': 'Reproduce the defect, apply a bounded fix, rerun the reproduction and the affected cases, and write the fix report; requirements, design and architect PK approvals are skipped.',
        L2: 'Confirm requirements and the implementation plan, obtain user approval before code changes, implement one vertical feature, run behavior tests, and write a test result report.',
        L3: 'Confirm requirements and design, obtain user approval before code changes and external actions, run integrated verification, and write a test result report.',
      }[effectiveLevel],
      implementationConsent: wantsWrite ? 'required-before-business-code-change' : 'not-applicable',
      governanceApplicationConsent: 'exact-plan-approval-before-application',
      skillGrowth: 'candidate-only-until-user-approval',
      commitGate: 'report-only-by-default',
    },
    status: recommendation.status === 'role-gap' || recommendation.status === 'human-review-required' ? recommendation.status : 'plan-ready-for-owner-confirmation',
    boundary: 'This command plans work only. It does not launch Agents, edit code, run tests, or satisfy a professional human review requirement.',
  };
}

export function taskPlanCommand(target, options) {
  if (!options.text) throw usageError('route requires --text.');
  const paths = options.paths ? options.paths.split(',').map((value) => value.trim()).filter(Boolean) : [];
  const taskKind = options['task-kind'] ?? 'feature';
  let bugfix = null;
  if (options.bugfix !== undefined) {
    try { bugfix = JSON.parse(options.bugfix); } catch { throw usageError('route --bugfix must be a JSON object of booleans.'); }
  }
  const result = planTask(path.resolve(target), { text: options.text, paths, taskKind, bugfix });
  console.log(JSON.stringify(result, null, 2));
  return result;
}
