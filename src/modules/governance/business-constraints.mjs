import { GENERATED_MARKER } from '../../constants.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';

export const BUSINESS_CONSTRAINTS_PATH = 'docs/ai/business-constraints.json';
export const BUSINESS_CONSTRAINT_SKILL_PATH = 'docs/ai/skills/business-constraints/SKILL.md';
export const BUSINESS_ACCEPTANCE_RESULTS_PATH = 'docs/ai/business-acceptance-results.json';
export const BUSINESS_RISK_EVIDENCE_PATH = 'docs/ai/risk-evidence.json';

const RISK_CHECKLISTS = Object.freeze({
  authentication: [
    'Reject missing, forged, expired, and revoked identities before business authorization runs.',
    'Bind the application principal to a trusted authentication mechanism; do not accept identity claims solely from request-controlled fields.',
  ],
  authorization: [
    'Treat untrusted client-supplied identity headers as attacker-controlled unless a trusted authentication boundary verifies and replaces them.',
    'Exercise least-privilege allow and deny paths, including inactive, suspended, or revoked membership.',
  ],
  payment: [
    'Verify amount and currency boundaries, allowed state transitions, duplicate payment references, and rollback or compensation after failure.',
    'Exercise idempotent replay and conflicting replay without double settlement or duplicate audit success.',
  ],
  'sensitive-data': [
    'Fail closed when a secret or encryption key is absent; never ship a default credential.',
    'Verify key lifecycle, rotation and revocation, unauthorized reads, and secret redaction from logs, errors, and audit records.',
  ],
  'external-side-effect': [
    'Verify persistent idempotency across replay, restart, concurrent workers, and crash recovery.',
    'Record or coordinate the side effect atomically through an inbox, outbox, target idempotency key, or an explicitly evidenced equivalent.',
  ],
  'multi-tenancy': [
    'Derive the tenant boundary from a trusted principal rather than accepting an unchecked request value.',
    'Exercise cross-tenant read and write attempts plus inactive, suspended, or revoked membership paths.',
  ],
  'data-consistency': [
    'Exercise concurrent lost updates, duplicate requests, and unique constraints at the authoritative persistence boundary.',
    'Verify atomicity, rollback, crash recovery and multi-instance execution without relying on one process memory.',
  ],
  'public-api': [
    'Enforce request size and rate limits plus input schema validation before expensive work.',
    'Verify authentication and authorization boundaries and a stable error contract across success, denial, malformed input, and internal failure.',
  ],
});

const CHINESE_RISK_CHECKLISTS = {
  authentication: ['业务授权前拒绝缺失、伪造、过期和已撤销的身份。', '将应用主体绑定到可信认证机制；不得仅信任请求可控字段中的身份声明。'],
  authorization: ['除非可信认证边界已验证并替换，否则将客户端身份请求头视为攻击者可控。', '验证最小权限的允许和拒绝路径，包括未激活、停用或已撤销的成员资格。'],
  payment: ['验证金额与币种边界、合法状态转换、重复支付编号以及失败后的回滚或补偿。', '验证幂等重放和冲突重放，避免重复结算或重复记录审计成功。'],
  'sensitive-data': ['缺少密钥或加密密钥时拒绝继续，不得发布默认凭据。', '验证密钥生命周期、轮换与撤销、未授权读取，以及日志、错误和审计记录中的秘密脱敏。'],
  'external-side-effect': ['验证重放、重启、并发工作进程及崩溃恢复中的持久幂等性。', '通过 inbox、outbox、目标幂等键或有明确证据的等效机制，以原子方式记录或协调副作用。'],
  'multi-tenancy': ['从可信主体推导租户边界，不得接受未经检查的请求值。', '验证跨租户读写尝试，以及未激活、停用或已撤销的成员资格路径。'],
  'data-consistency': ['在权威持久化边界验证并发更新丢失、重复请求和唯一约束。', '验证原子性、回滚、崩溃恢复与多实例执行，不得依赖单进程内存。'],
  'public-api': ['在昂贵操作前执行请求大小、频率限制与输入模式校验。', '验证认证和授权边界，以及成功、拒绝、畸形输入和内部失败时稳定的错误契约。'],
};

export function businessConstraintRecords(config) {
  return (config.domainConstraints ?? []).map((value) => {
    const constraint = value.trim();
    const constraintHash = sha256(constraint);
    return {
      id: `constraint-${constraintHash}`,
      constraint,
      constraintHash,
      owner: 'product-owner',
      source: 'owner-confirmed',
      evidenceRequirements: ['success-evidence', 'negative-or-boundary-evidence'],
    };
  });
}

export function businessConstraintRegistry(config) {
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    owner: 'product-owner',
    source: 'owner-confirmed',
    confirmedRiskSignals: [...(config.confirmedRiskSignals ?? [])],
    constraints: businessConstraintRecords(config),
    acceptanceResultsPath: BUSINESS_ACCEPTANCE_RESULTS_PATH,
    riskEvidencePath: BUSINESS_RISK_EVIDENCE_PATH,
    boundary: config.artifactLanguage === 'zh-CN' ? '约束文本和风险信号仅来自负责人明确确认的配置，不按关键词推断风险。' : 'Constraint text and risk signals come only from explicit owner-confirmed configuration. No keyword-based risk inference is performed.',
  };
}

function riskChecklist(config) {
  const signals = config.confirmedRiskSignals ?? [];
  if (config.artifactLanguage === 'zh-CN') return signals.length === 0
    ? '尚未确认结构化风险信号。不得从约束措辞推断；添加风险专属检查表前，先询问负责人。'
    : signals.map((signal) => `### ${signal}\n\n${CHINESE_RISK_CHECKLISTS[signal].map((check) => `- ${check}`).join('\n')}`).join('\n\n');
  if (signals.length === 0) return 'No structured risk signal was confirmed. Do not infer one from constraint wording; ask the owner before adding a risk-specific checklist.';
  return signals.map((signal) => `### ${signal}\n\n${RISK_CHECKLISTS[signal].map((check) => `- ${check}`).join('\n')}`).join('\n\n');
}

export function businessConstraintSkill(config) {
  if (config.artifactLanguage === 'zh-CN') return `---
name: business-constraints
description: 应用负责人确认的项目不变量，并为每项受影响约束提供证据。
---

# 负责人确认的业务约束

<!-- ${GENERATED_MARKER} -->

本技能由负责人明确确认的配置路由。不得按关键词推断额外约束或风险信号。

## 必需流程

1. 识别请求行为影响的每项下列约束。
2. 保留 \`${BUSINESS_CONSTRAINTS_PATH}\` 中的稳定 id、原始文本和 SHA-256 绑定。
3. 为每项受影响约束定义并运行至少一个成功用例。
4. 为每项受影响约束定义并运行至少一个负向或边界用例。
5. 在 \`${BUSINESS_ACCEPTANCE_RESULTS_PATH}\` 记录证据；通过项须绑定 \`id\`、\`constraint\` 和 \`constraintHash\`，并包含非空的 \`successEvidence\` 与 \`failureOrBoundaryEvidence\`。
6. 为每项负责人确认的风险信号，在 \`${BUSINESS_RISK_EVIDENCE_PATH}\` 记录明确适用性、负向诊断与恢复证据，并绑定当前源码和配置指纹。模拟或项目本地记录不得声称已获认证。
7. 业务或风险证据缺失、不完整或不匹配时，将生产就绪状态报告为 blocked。即使全部记录完成，也仅可报告 unverified 和 eligible-for-review；完成命令不会重放或认证任意业务证据。

## 约束

${businessConstraintRecords(config).map((record) => `### ${record.id}\n\n- 负责人：\`${record.owner}\`\n- 来源：\`${record.source}\`\n- 约束哈希：\`${record.constraintHash}\`\n- 约束：${JSON.stringify(record.constraint)}\n- 必需证据：一个具体成功证据和一个具体负向或边界证据，均绑定此精确 id、文本和哈希。`).join('\n\n')}

## 负责人确认的风险信号

${(config.confirmedRiskSignals ?? []).join(', ') || '无'}

${riskChecklist(config)}
`;
  const constraints = businessConstraintRecords(config).map((record) => `### ${record.id}\n\n- Owner: \`${record.owner}\`\n- Source: \`${record.source}\`\n- Constraint hash: \`${record.constraintHash}\`\n- Constraint: ${JSON.stringify(record.constraint)}\n- Required evidence: one concrete success evidence item and one concrete negative or boundary evidence item bound to this exact id, text, and hash.`).join('\n\n');
  return `---
name: business-constraints
description: Apply owner-confirmed project invariants and require evidence for every affected constraint.
---

# Owner-confirmed business constraints

<!-- ${GENERATED_MARKER} -->

This Skill is routed from explicit owner-confirmed configuration. Do not infer additional constraints or risk signals from keywords.

## Required workflow

1. Identify every constraint below affected by the requested behavior.
2. Preserve its stable id, exact text, and SHA-256 binding from \`${BUSINESS_CONSTRAINTS_PATH}\`.
3. Define and run at least one success case for each affected constraint.
4. Define and run at least one negative or boundary case for each affected constraint.
5. Record evidence in \`${BUSINESS_ACCEPTANCE_RESULTS_PATH}\`; a passing item binds \`id\`, \`constraint\`, and \`constraintHash\` and includes non-empty \`successEvidence\` and \`failureOrBoundaryEvidence\`.
6. For every owner-confirmed risk signal, record explicit applicability plus negative diagnostic and recovery evidence in \`${BUSINESS_RISK_EVIDENCE_PATH}\`, bound to the current source/config fingerprint. Simulation or project-local records must never claim certification.
7. Report production readiness as blocked while business or risk evidence is missing, incomplete, or mismatched. Even after every item is recorded, report only unverified and eligible-for-review; a completion command does not replay or certify arbitrary business evidence.

## Constraints

${constraints}

## Owner-confirmed risk signals

${(config.confirmedRiskSignals ?? []).join(', ') || 'none'}

${riskChecklist(config)}
`;
}

export function businessConstraintRegistryContent(config) {
  return stableJson(businessConstraintRegistry(config));
}
