import { changedMemoryBehaviorPaths } from '../memory/index.mjs';
import { isProductionScopePath } from '../repository/index.mjs';

// Unknown production formats are behavior candidates, never an extension waiver.
export function isWorkUnitProductionPath(relative) {
  return isProductionScopePath(relative);
}

export function changedWorkUnitBehaviorPaths(root, scan, paths) {
  const recognized = new Set(changedMemoryBehaviorPaths(root, scan, paths));
  return paths.filter(isWorkUnitProductionPath).filter((relative) => recognized.has(relative));
}
