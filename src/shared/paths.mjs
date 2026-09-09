export function normalizeRelative(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSafeRelative(value) {
  const normalized = normalizeRelative(value);
  if (!normalized || /[\x00-\x1f\x7f]/.test(normalized) || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function matchSimpleGlob(file, pattern) {
  const normalizedFile = normalizeRelative(file);
  const normalizedPattern = normalizeRelative(pattern);
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '::DOUBLE::').replaceAll('*', '[^/]*').replaceAll('::DOUBLE::', '.*');
  const regex = new RegExp(`(^|/)${escaped}$`, process.platform === 'win32' ? 'i' : '');
  return regex.test(normalizedFile);
}
