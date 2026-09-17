// Conservative production scope shared by work-unit and Memory gates. Unknown
// formats remain in scope; only explicit repository-local documentation,
// generated roots and test/fixture paths are excluded.
export function isProductionScopePath(relative) {
  return typeof relative === 'string'
    && !/^(?:docs?|dist|build|coverage)(?:\/|$)/i.test(relative)
    && !/(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|node_modules)(?:\/|$)/i.test(relative)
    && !/^(?:\.ai-governance|\.agents|\.claude|\.cursor|\.codex)\//.test(relative)
    && !/\.(?:md|mdx|txt|rst|adoc)$/i.test(relative)
    && !/(?:^|\/)(?:readme|changelog|contributing|license)(?:[.-]|$)/i.test(relative)
    && !/(?:\.(?:test|spec)\.|(?:^|\/)test_[^/]+|_test\.[^/]+$)/i.test(relative)
    && !/^(?:\.gitignore|\.gitattributes|\.gitmodules)$/.test(relative);
}
