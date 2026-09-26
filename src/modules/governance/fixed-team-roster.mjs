import { stableJson } from '../../shared/index.mjs';
import { loadTeamRoleRegistry } from '../team/index.mjs';

export const FIXED_TEAM_ROSTER_PATH = 'docs/ai/team-roster.json';
export const FIXED_TEAM_ROSTER_KIND = 'fixed-team-roster';

/**
 * The fixed base delivery roles are part of the generated governance by default: they are
 * always available and need no discovery or team approval. They are executed by an AI acting
 * as the corresponding human role. Dynamic or regulated roles are a separate, owner-approved
 * surface recorded in agent-team.json, so the fixed roster never grants approval by itself.
 */
export function fixedTeamRoster() {
  const registry = loadTeamRoleRegistry();
  const roles = registry.roles.map((role) => ({
    id: role.id,
    title: role.title,
    defaultPriority: role.defaultPriority,
    responsibilities: role.responsibilities,
    deliverables: role.deliverables,
    canCombineWith: role.canCombineWith,
    mustRemainIndependentFrom: role.mustRemainIndependentFrom,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return stableJson({
    schemaVersion: 1,
    rosterType: 'fixed-project-ai-delivery-roles',
    roleExecution: 'ai-role-play-as-human',
    humanSignoff: 'regulated-domains-only',
    boundary: 'Fixed delivery roles are always available and are executed by an AI acting as the human role. Dynamic or regulated roles require owner approval and are recorded separately in agent-team.json; this roster grants no approval and no professional authority.',
    roles,
  });
}
