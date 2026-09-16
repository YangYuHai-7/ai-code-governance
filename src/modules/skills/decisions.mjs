import { sha256, stableJson } from '../../shared/index.mjs';
import { assertSkillCandidateFresh } from './discovery.mjs';

const STATES = new Set(['discovered', 'recommended', 'approved', 'applied', 'active-for-task']);

function candidateSnapshot(candidate) {
  if (!candidate || typeof candidate.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(candidate.id)
    || !['project', 'installed', 'official-curated'].includes(candidate.sourceKind)
    || typeof candidate.source !== 'string' || !candidate.source || candidate.source.length > 512
    || typeof candidate.version !== 'string' || !candidate.version || candidate.version.length > 128
    || !/^[a-f0-9]{64}$/.test(candidate.contentSha256 ?? '')
    || !Array.isArray(candidate.capabilities) || !candidate.capabilities.includes(candidate.capabilityOwner)
    || !Array.isArray(candidate.permissions) || !STATES.has(candidate.decision)
    || !['verified', 'reachable', 'stated', 'unverified'].includes(candidate.verification)
    || !['available', 'needs-user-decision', 'refresh-due'].includes(candidate.availability)) throw new Error('Invalid Skill decision metadata.');
  for (const list of [candidate.capabilities, candidate.permissions]) {
    if (list.length > 32 || list.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id))) throw new Error('Invalid Skill permission or capability.');
  }
  if (candidate.sourceKind !== 'official-curated' && (!candidate.location || typeof candidate.location.root !== 'string' || typeof candidate.location.relative !== 'string')) throw new Error('Local Skill source location is required.');
  if (Buffer.byteLength(stableJson(candidate)) > 8192) throw new Error('Skill decision metadata budget exceeded.');
  const snapshot = structuredClone(candidate);
  delete snapshot.decision;
  if (Object.hasOwn(snapshot, 'content') || Object.hasOwn(snapshot, 'body')) throw new Error('Skill decisions must contain metadata only.');
  return snapshot;
}

/** Pure state transitions record caller evidence; they never install or activate client code. */
export function decideSkillCandidates(candidates, decisions = {}) {
  if (!Array.isArray(candidates) || candidates.length > 5) throw new Error('At most five Skill candidates can be decided.');
  const snapshots = candidates.map(candidateSnapshot);
  if (new Set(snapshots.map((item) => item.id)).size !== snapshots.length || new Set(snapshots.map((item) => item.capabilityOwner)).size !== snapshots.length) throw new Error('Skill decisions require unique candidates and capability owners.');
  const selectedIds = decisions.selectedIds ?? snapshots.map((item) => item.id);
  if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !snapshots.some((item) => item.id === id))) throw new Error('Unknown or duplicate Skill selection.');
  const payload = { schemaVersion: 1, candidates: snapshots, selectedIds: [...selectedIds].sort() };
  const planHash = sha256(stableJson(payload));
  const approved = decisions.approvalPlanHash !== undefined;
  if (approved && decisions.approvalPlanHash !== planHash) throw new Error('Skill approval planHash does not match the exact candidate decision.');
  if (approved && snapshots.some((item) => selectedIds.includes(item.id) && ['needs-user-decision', 'refresh-due'].includes(item.availability))) throw new Error('Resolve candidate conflict or refresh the offline catalog before approval.');
  if (approved) for (const item of snapshots.filter((candidate) => selectedIds.includes(candidate.id))) assertSkillCandidateFresh(item);
  const appliedIds = decisions.applied?.ids ?? [];
  const activeIds = decisions.activeForTask?.ids ?? [];
  if (decisions.applied && decisions.applied.planHash !== planHash) throw new Error('Applied evidence requires the approved planHash.');
  if (decisions.activeForTask && (typeof decisions.activeForTask.taskId !== 'string' || !decisions.activeForTask.taskId.trim() || activeIds.length > 3)) throw new Error('Task activation requires a task id and at most three Skills.');
  for (const list of [appliedIds, activeIds]) {
    if (!Array.isArray(list) || new Set(list).size !== list.length || list.some((id) => !selectedIds.includes(id))) throw new Error('Invalid applied or active Skill selection.');
  }
  if ((decisions.applied || decisions.activeForTask) && !approved) throw new Error('Skill application and task activation require exact approval.');
  return {
    ...payload, planHash, status: approved ? 'approved' : 'recommended',
    candidates: snapshots.map((item) => ({ ...item, decision: activeIds.includes(item.id) ? 'active-for-task' : appliedIds.includes(item.id) ? 'applied' : selectedIds.includes(item.id) ? (approved ? 'approved' : 'recommended') : 'discovered' })),
    ...(approved ? { approval: { planHash } } : {}),
    ...(decisions.applied ? { applied: structuredClone(decisions.applied) } : {}),
    ...(decisions.activeForTask ? { activeForTask: structuredClone(decisions.activeForTask) } : {}),
    actionsPerformed: [],
  };
}

export function validateSkillDecision(decision, { root = null } = {}) {
  if (decision?.status !== 'approved' || !decision.approval || !Array.isArray(decision.actionsPerformed) || decision.actionsPerformed.length) throw new Error('Approved Skill decision is required.');
  const expected = decideSkillCandidates(decision.candidates, { selectedIds: decision.selectedIds, approvalPlanHash: decision.approval.planHash, applied: decision.applied, activeForTask: decision.activeForTask });
  if (stableJson(expected) !== stableJson(decision)) throw new Error('Skill decision approval planHash or state is stale.');
  if (root) {
    for (const item of decision.candidates.filter((candidate) => decision.selectedIds.includes(candidate.id))) {
      assertSkillCandidateFresh(item, root);
    }
  }
  return decision;
}

export function validateApprovedAgentTeam(team) {
  if (!team || team.teamType !== 'project-ai-agent-team' || team.status !== 'approved'
    || !/^[a-f0-9]{64}$/.test(team.planHash ?? '') || team.approval?.planHash !== team.planHash
    || !Array.isArray(team.roleProposals) || !Array.isArray(team.professionalBoundaries)
    || !Array.isArray(team.gaps) || !Array.isArray(team.actionsPerformed) || team.actionsPerformed.length) throw new Error('Approved project AI agent team and exact approval planHash are required.');
  // Role semantics are owned by the project-agent-team module, not this integration boundary.
  if (Buffer.byteLength(stableJson(team)) > 16 * 1024) throw new Error('Agent team metadata budget exceeded.');
  return team;
}
