import { runGit } from '../../adapters/process/index.mjs';
import { readMemoryFile, isMemoryCodePath, changedMemoryBehaviorPaths } from '../memory/index.mjs';

// Unknown production formats are behavior candidates, never an extension waiver.
export function isWorkUnitProductionPath(relative) {
  // Like the repository scanner, output-root names cannot hide nested source.
  return !/^(?:docs?|tests?|__tests__|fixtures?|__fixtures__|dist|build|coverage)(?:\/|$)/i.test(relative)
    && !/(?:^|\/)node_modules(?:\/|$)/i.test(relative)
    && !/^(?:\.ai-governance|\.agents|\.claude|\.cursor|\.codex|\.superpowers)\//.test(relative)
    && !/\.(?:md|mdx|txt|rst|adoc)$/i.test(relative)
    && !/(?:^|\/)(?:readme|changelog|contributing|license)(?:[.-]|$)/i.test(relative)
    && !/(?:\.(?:test|spec)\.|(?:^|\/)test_[^/]+|_test\.[^/]+$)/i.test(relative)
    && !/^(?:\.gitignore|\.gitattributes|\.gitmodules)$/.test(relative);
}

export function changedWorkUnitBehaviorPaths(root, scan, paths) {
  const recognized = new Set(changedMemoryBehaviorPaths(root, scan, paths));
  return paths.filter(isWorkUnitProductionPath).filter((relative) => {
    if (isMemoryCodePath(relative)) return recognized.has(relative);
    // Only exact text equality is evidence of no behavior change for unknown
    // syntax. Unreadable, removed, binary and new files conservatively require QA.
    try {
      const current = readMemoryFile(root, relative);
      const before = runGit(scan.memoryGitRoot ?? root, ['show', `HEAD:${relative}`], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      return before.status !== 0 || before.stdout !== current;
    } catch { return true; }
  });
}
