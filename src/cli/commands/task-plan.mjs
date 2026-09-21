import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { scanProject } from '../../scanner.mjs';
import { classifyTaskRoute, minimumTaskLevelFromPaths } from '../../modules/governance/task-routing.mjs';
import { recommendTaskRoles } from '../../modules/governance/task-role-routing.mjs';
import { assertManagedArchitectureConfigTrusted, loadExistingConfig, mergeConfig } from '../shared.mjs';
import { defaultConfig, validateConfig } from '../../generator.mjs';

const WRITE_SIGNAL = /(?:修复|修改|新增|实现|重构|开发|fix|change|modify|add|implement|refactor|build)/i;
const HIGH_RISK_SIGNAL = /(?:迁移|部署|发布|支付|权限|认证|migration|deploy|release|payment|authorization|authentication)/i;
const BUSINESS_SIGNAL = /(?:业务|合同|需求|规则|流程|business|contract|requirements|workflow)/i;

export function planTask(root, { text, paths = [] } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw usageError('route --text requires a nonempty task of at most 4000 characters.');
  const scan = scanProject(root);
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('Task role routing requires initialized governance. Run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  if (!Array.isArray(paths) || paths.length > 128) throw usageError('route paths must be an array of at most 128 repository-relative paths.');
  const pathLevel = paths.length ? minimumTaskLevelFromPaths(paths, config) : 'L0';
  const wantsWrite = WRITE_SIGNAL.test(text) || paths.length > 0;
  const surfaceCount = new Set(paths.map((relative) => relative.split('/')[0])).size;
  const route = classifyTaskRoute({
    mutation: !wantsWrite ? 'none' : ['L2', 'L3'].includes(pathLevel) || WRITE_SIGNAL.test(text) ? 'product-behavior' : 'non-production',
    scope: pathLevel === 'L3' && surfaceCount > 1 ? 'multi-surface' : surfaceCount > 1 ? 'multi-module' : paths.length ? 'single-module' : 'single-file',
    risk: wantsWrite && (HIGH_RISK_SIGNAL.test(text) || (pathLevel === 'L3' && surfaceCount <= 1)) ? 'high-consequence' : wantsWrite && BUSINESS_SIGNAL.test(text) ? 'business' : 'low',
    clarity: paths.length || !wantsWrite ? 'clear' : 'locally-ambiguous',
  });
  const recommendation = recommendTaskRoles({ taskText: text, changedPaths: paths, route, availableRoles: config.agentTeam?.enabled ? config.agentTeam.roleProposals : [] });
  const effectiveLevel = recommendation.routeEvidence.effectiveLevel;
  return {
    schemaVersion: 1,
    task: text,
    route: { ...route, level: effectiveLevel },
    roles: recommendation,
    process: {
      [effectiveLevel]: {
        L0: 'Answer or analyze using read-only evidence; no implementation or test run is required.',
        L1: 'Confirm the local change scope, apply a small reversible change, run targeted verification, and write a test result report.',
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
  const result = planTask(path.resolve(target), { text: options.text, paths });
  console.log(JSON.stringify(result, null, 2));
  return result;
}
