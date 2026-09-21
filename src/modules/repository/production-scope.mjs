import { declaredGovernanceDirectories } from '../../catalogs/index.mjs';

// Directories that hold governance state rather than product source. Client-declared roots
// come from the agent registry so a new client is covered automatically; the local state
// roots stay explicit because no agent registry entry declares them. Compiled once because
// this predicate runs for every scanned file.
const GOVERNANCE_STATE_DIRECTORIES = ['.ai-governance', '.codex'];
const GOVERNANCE_DIRECTORY = new RegExp(`^(?:${[...new Set([
  ...GOVERNANCE_STATE_DIRECTORIES,
  ...declaredGovernanceDirectories().map((directory) => directory.split('/')[0]),
])].map((directory) => directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/`);

// Conservative production scope shared by work-unit and Memory gates. Unknown
// formats remain in scope; only explicit repository-local documentation,
// generated roots and test/fixture paths are excluded.
export function isProductionScopePath(relative) {
  return typeof relative === 'string'
    && !/^(?:docs?|dist|build|coverage|reports|reviews)(?:\/|$)/i.test(relative)
    && !/(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|node_modules)(?:\/|$)/i.test(relative)
    && !GOVERNANCE_DIRECTORY.test(relative)
    && !/\.(?:md|mdx|txt|rst|adoc)$/i.test(relative)
    && !/(?:^|\/)(?:readme|changelog|contributing|license)(?:[.-]|$)/i.test(relative)
    && !/(?:\.(?:test|spec)\.|(?:^|\/)test_[^/]+|_test\.[^/]+$)/i.test(relative)
    && !/^(?:\.gitignore|\.gitattributes|\.gitmodules)$/.test(relative);
}
