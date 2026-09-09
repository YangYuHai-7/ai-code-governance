import fs from 'node:fs';
import { applyArtifactPlanCore } from './artifact-apply.mjs';

export {
  extractManagedBlock,
  generatedHeader,
  mergeManagedBlock,
  removeManagedBlock,
  renderManagedBlock,
} from './managed-block.mjs';
export { buildManifest } from './manifest.mjs';
export { loadManifest } from './manifest-store.mjs';
export { planArtifacts } from './artifact-plan.mjs';

function restoreUserOwnedLink(entry, absolute) {
  // Controlled rollback: restore only the user-owned link removed by this failed migration.
  fs.symlinkSync(entry.target, absolute);
}

export function applyArtifactPlan(root, plan, options = {}) {
  return applyArtifactPlanCore(root, plan, options, { restoreUserOwnedLink });
}
