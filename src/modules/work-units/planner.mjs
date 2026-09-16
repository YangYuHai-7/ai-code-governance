import { scanProject } from '../repository/index.mjs';
import { scanProjectMemoryFacts } from '../memory/index.mjs';
import { classifyReviewMode, minimumTaskLevelFromPaths, validateConfig } from '../governance/index.mjs';
import { validateApprovedProjectAgentTeam } from '../agent-team/index.mjs';
import { readMemoryFile } from '../memory/index.mjs';
import { matchSimpleGlob } from '../../shared/index.mjs';
import { validateWorkUnit, workUnitPlanDigest } from './schema.mjs';

export function selectWorkUnitRoles(config, unit) {
  const paths = unit.scope.flatMap((group) => group.paths);
  const requirements = ['implementation', 'independent-review'];
  if (unit.taskLevel === 'L3') requirements.push('qa');
  let approved = [];
  if (config?.agentTeam?.enabled) { validateApprovedProjectAgentTeam(config.agentTeam); approved = config.agentTeam.roleProposals; }
  const selected = [], recommendations = [];
  for (const capability of requirements) {
    const role = approved.find((entry) => entry.capabilities.includes(capability) && !selected.includes(entry.id)
      && (!entry.activation || paths.some((relative) => entry.activation.paths.some((pattern) => matchSimpleGlob(relative, pattern)))));
    if (role) selected.push(role.id); else recommendations.push(capability);
  }
  for (const role of approved) if (role.activation?.signals.some((signal) => unit.risks.includes(signal)) && paths.some((relative) => role.activation.paths.some((pattern) => matchSimpleGlob(relative, pattern))) && !selected.includes(role.id)) selected.push(role.id);
  return { selected, recommendations, participation: 'not-evidenced', boundary: 'Role availability and recommendations do not prove participation or grant authority.' };
}

export function workUnitCoverage(scan, paths) {
  const facts = scanProjectMemoryFacts(scan);
  return { facts, entries: [...facts.apis.map((entry) => ({ ...entry, kind: 'api' })), ...facts.methods.map((entry) => ({ ...entry, kind: 'method' }))].filter((entry) => paths.includes(entry.implementationPath ?? entry.path)) };
}

export function planWorkUnit(root, unit, { scan = null, config = null } = {}) {
  if (unit?.taskLevel === 'L0') return { workUnit: null, status: 'not-required', actionsPerformed: [] };
  if (unit?.taskLevel === 'L1') return { workUnit: null, status: 'lightweight-receipt', actionsPerformed: [] };
  validateWorkUnit(unit);
  scan ??= scanProject(root, { probeEnvironment: false });
  if (!config) try { config = validateConfig(JSON.parse(readMemoryFile(root, '.ai-governance/config.json'))); } catch (error) { if (error.code !== 'ENOENT') throw error; config = {}; }
  const paths = unit.scope.flatMap((group) => group.paths);
  const roles = selectWorkUnitRoles(config, unit);
  return {
    workUnit: structuredClone(unit), planDigest: workUnitPlanDigest(unit), roles,
    minimumTaskLevel: minimumTaskLevelFromPaths(paths, config), minimumReviewMode: classifyReviewMode({ plannedPaths: paths }).mode,
    coverage: workUnitCoverage(scan, paths).entries, actionsPerformed: [],
    boundary: config.artifactLanguage === 'zh-CN' ? '仅预览一个完整功能工作单元；不启动 Agent、不运行测试、不修改业务代码。' : 'Preview one vertical feature only; no Agent launch, test execution or business code writes.',
  };
}
