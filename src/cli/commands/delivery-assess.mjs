import path from 'node:path';
import { planTask } from './task-plan.mjs';
import { assessDeliveryArtifacts } from '../../modules/governance/delivery-assessment.mjs';
import { loadExistingConfig } from '../shared.mjs';
import { usageError } from '../../kernel/index.mjs';

export function deliveryAssessCommand(target, options) {
  if (!options.text || !options.scope) throw usageError('delivery assess requires --text and --scope matching the prepared task.');
  const root = path.resolve(target);
  const config = loadExistingConfig(root) ?? {};
  const task = planTask(root, { text: options.text, paths: options.paths?.split(',').filter(Boolean) ?? [], taskKind: options['task-kind'] ?? 'feature', bugfix: options.bugfix ? JSON.parse(options.bugfix) : null });
  const result = assessDeliveryArtifacts(root, { delivery: task.delivery, scope: options.scope, text: options.text,
    caseRoot: config.testing?.caseRoot, caseFormat: config.testing?.caseFormat, reportRoot: config.testing?.reportRoot, language: config.artifactLanguage,
    approvalEvidence: options['approval-evidence'], approve: options.approve });
  console.log(JSON.stringify(result, null, 2));
  if (options.enforce && (result.findings.length || result.implementationReadiness === 'awaiting-customer-confirmation')) process.exitCode = 1;
  return result;
}
