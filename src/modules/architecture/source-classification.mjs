const NON_SOURCE_ROOTS = new Set(['.runtime']);

export function isArchitectureNonSourcePath(relative) {
  const [root] = relative.replaceAll('\\', '/').toLowerCase().split('/');
  return NON_SOURCE_ROOTS.has(root);
}
