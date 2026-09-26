import { stableJson } from '../../shared/index.mjs';

/**
 * Pre-delivery phases owned by the project flow. The delivery loop owns everything from
 * decomposition onward, so the two lists must never overlap or a requirement would be
 * routed twice.
 *
 * The phases are described in `docs/WORKFLOW.md`, which is the single process document.
 * The tool only writes the runtime ledger here; it no longer ships one Skill per phase.
 */
export const PROJECT_FLOW_LEDGER = 'docs/ai/flow-state.json';
export const PROJECT_FLOW_PHASES = ['requirements', 'design', 'plan'];

/**
 * The flow ledger is a `seed`: the tool writes the empty baseline once and never overwrites
 * runtime progress, because a regenerated ledger would erase the evidence the flow exists to keep.
 */
export function projectFlowLedger(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  return stableJson({
    schemaVersion: 1,
    phase: 'requirements',
    phases: PROJECT_FLOW_PHASES,
    requirement: { path: null, digest: null },
    design: { status: 'not-needed', proposals: [] },
    plan: { path: null, digest: null, planHash: null },
    review: { mode: null, participants: [] },
    delivery: { ledger: 'docs/ai/delivery-loop.json' },
    classification: { business: null, by: null, reason: null },
    openFindings: [],
    blockedOnOwner: [],
    boundary: zh
      ? '本文件是项目流程的运行时状态。工具只写入空基线，之后由执行方维护；账本记录声明与证据引用，不等于执行或认证。'
      : 'Runtime state of the project flow. The tool writes only the empty baseline; the executing side owns it afterwards. It records declarations and evidence references, not execution or certification.',
  });
}

export function buildProjectFlowArtifacts(config) {
  return {
    artifacts: [{
      path: PROJECT_FLOW_LEDGER,
      content: projectFlowLedger(config),
      ownership: 'seed',
      kind: 'project-flow-ledger',
      source: 'template:project-flow-ledger',
    }],
  };
}
