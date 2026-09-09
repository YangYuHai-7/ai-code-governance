import { GENERATED_MARKER, MANAGED_END, MANAGED_START } from '../../constants.mjs';

export function renderManagedBlock(body) {
  return `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
}

export function extractManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) throw new Error('Managed block markers are incomplete or out of order.');
  const endIndex = end + MANAGED_END.length;
  return content.slice(start, endIndex);
}

export function mergeManagedBlock(current, body) {
  const block = renderManagedBlock(body);
  const existing = extractManagedBlock(current);
  if (!existing) return current.trim().length === 0 ? `${block}\n` : `${current.replace(/\s+$/, '')}\n\n${block}\n`;
  return `${current.slice(0, current.indexOf(existing))}${block}${current.slice(current.indexOf(existing) + existing.length)}`;
}

export function removeManagedBlock(current) {
  const existing = extractManagedBlock(current);
  if (!existing) return current;
  const before = current.slice(0, current.indexOf(existing)).replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const after = current.slice(current.indexOf(existing) + existing.length).replace(/^\s+/, '');
  if (!before && !after) return '';
  if (!before) return `${after.replace(/\s+$/, '')}\n`;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after.replace(/\s+$/, '')}\n`;
}

export function generatedHeader(comment = '<!--') {
  return comment === '<!--' ? `<!-- ${GENERATED_MARKER} -->` : `${comment} ${GENERATED_MARKER}`;
}
