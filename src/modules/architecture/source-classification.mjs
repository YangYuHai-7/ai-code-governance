const NON_SOURCE_ROOTS = new Set(['.runtime']);
const OUTPUT_DIRECTORIES = ['node_modules', 'dist', 'target', 'build', 'coverage'];

export function isArchitectureNonSourcePath(relative, sourceRoots = []) {
  const normalized = relative.replaceAll('\\', '/');
  if (NON_SOURCE_ROOTS.has(normalized.toLowerCase().split('/')[0])) return true;
  // Exclude conventional outputs only at a declared application root. A directory
  // named build or dist inside an unknown/source location must not hide source.
  return sourceRoots.some(sourceRoot => {
    const unitRoot = sourceRoot.replace(/(?:^|\/)(?:src(?:\/main\/java)?|internal|Sources)$/, '');
    if (unitRoot === sourceRoot) return false;
    return OUTPUT_DIRECTORIES.some(directory => normalized.startsWith(`${unitRoot ? `${unitRoot}/` : ''}${directory}/`));
  });
}
