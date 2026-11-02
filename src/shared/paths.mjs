export function normalizeRelative(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSafeRelative(value) {
  const normalized = normalizeRelative(value);
  if (!normalized || /[\x00-\x1f\x7f]/.test(normalized) || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '' || part === '.' || part === '..');
}

// Cache only immutable pattern compilation, never file results or repository content.
// Bound caller-controlled patterns so long-lived processes cannot retain an unbounded set.
const compiledGlobs = new Map();
const MAX_COMPILED_GLOBS = 512;
const MAX_CACHED_PATTERN_LENGTH = 4096;

export function matchSimpleGlob(file, pattern) {
  const normalizedFile = normalizeRelative(file);
  const normalizedPattern = normalizeRelative(pattern);
  let regex = compiledGlobs.get(normalizedPattern);
  if (!regex) {
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '::DOUBLE::').replaceAll('*', '[^/]*').replaceAll('::DOUBLE::', '.*');
    regex = new RegExp(`(^|/)${escaped}$`, process.platform === 'win32' ? 'i' : '');
    if (normalizedPattern.length <= MAX_CACHED_PATTERN_LENGTH) {
      if (compiledGlobs.size >= MAX_COMPILED_GLOBS) compiledGlobs.delete(compiledGlobs.keys().next().value);
      compiledGlobs.set(normalizedPattern, regex);
    }
  }
  return regex.test(normalizedFile);
}
