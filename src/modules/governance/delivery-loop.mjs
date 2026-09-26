import { stableJson } from '../../shared/index.mjs';

/**
 * Delivery phases owned by the loop. The project flow owns everything before decomposition.
 *
 * The phases are described in `docs/WORKFLOW.md`, which is the single process document.
 * The tool only writes the runtime ledger here; it no longer ships one Skill per phase.
 */
export const DELIVERY_LOOP_LEDGER = 'docs/ai/delivery-loop.json';
export const DELIVERY_PHASES = ['decomposition', 'assignment', 'development', 'test-authoring', 'local-test', 'report', 'fix-loop'];

/**
 * The ledger the loop writes its state into. It is a `seed`: the tool writes the empty
 * baseline once and never overwrites runtime progress, because a regenerated ledger would
 * erase the very evidence the loop exists to keep.
 */
export function deliveryLoopLedger(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  return stableJson({
    schemaVersion: 1,
    phase: 'decomposition',
    phases: DELIVERY_PHASES,
    requirement: { text: '', taskLevel: null, acceptanceCriteria: [] },
    units: [],
    iterations: { budget: 5, used: 0 },
    runs: [],
    openFindings: [],
    classification: { business: null, by: null, reason: null },
    blockedOnOwner: [],
    residualRisk: [],
    boundary: zh
      ? '本文件是交付循环的运行时状态。工具只写入空基线，之后由执行方维护；账本记录声明与证据引用，不等于执行或认证。'
      : 'Runtime state of the delivery loop. The tool writes only the empty baseline; the executing side owns it afterwards. It records declarations and evidence references, not execution or certification.',
  });
}

export function buildDeliveryLoopArtifacts(config) {
  return {
    artifacts: [{
      path: DELIVERY_LOOP_LEDGER,
      content: deliveryLoopLedger(config),
      ownership: 'seed',
      kind: 'delivery-loop-ledger',
      source: 'template:delivery-loop-ledger',
    }],
  };
}
