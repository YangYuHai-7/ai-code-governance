import path from 'node:path';
import { planTask } from './task-plan.mjs';
import { prepareDeliveryArtifacts } from '../../modules/governance/delivery-preparation.mjs';
import { loadExistingConfig } from '../shared.mjs';
import { usageError } from '../../kernel/index.mjs';

export function deliveryPrepareCommand(target, options) {
  if (!options.text || !options.scope) throw usageError('delivery prepare requires --text and --scope; --yes creates missing drafts, otherwise preview only.');
  const root = path.resolve(target);
  const config = loadExistingConfig(root) ?? {};
  const task = planTask(root, { text: options.text, paths: options.paths?.split(',').filter(Boolean) ?? [], taskKind: options['task-kind'] ?? 'feature', bugfix: options.bugfix ? JSON.parse(options.bugfix) : null });
  const result = prepareDeliveryArtifacts(root, { delivery: task.delivery, scope: options.scope, text: options.text,
    caseRoot: config.testing?.caseRoot, caseFormat: config.testing?.caseFormat, reportRoot: config.testing?.reportRoot, language: config.artifactLanguage, write: options.yes === true });
  console.log(JSON.stringify({ ...result, delivery: task.delivery }, null, 2));
  return result;
}
