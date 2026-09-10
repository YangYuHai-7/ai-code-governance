import {
  GENERATED_MARKER,
  GITIGNORE_MANAGED_END,
  GITIGNORE_MANAGED_START,
  MANAGED_END,
  MANAGED_START,
} from '../../constants.mjs';

function renderBlock(body, startMarker, endMarker) {
  return `${startMarker}\n${body.trim()}\n${endMarker}`;
}

function extractBlock(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) throw new Error('Managed block markers are incomplete or out of order.');
  if (start !== content.lastIndexOf(startMarker) || end !== content.lastIndexOf(endMarker)) {
    throw new Error('Managed block markers must appear exactly once.');
  }
  const endIndex = end + endMarker.length;
  return content.slice(start, endIndex);
}

function mergeBlock(current, body, startMarker, endMarker) {
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const block = renderBlock(body, startMarker, endMarker).replaceAll('\n', newline);
  const existing = extractBlock(current, startMarker, endMarker);
  if (!existing) {
    if (current.length === 0) return `${block}${newline}`;
    const separator = current.endsWith(newline)
      ? current.endsWith(`${newline}${newline}`) ? '' : newline
      : `${newline}${newline}`;
    return `${current}${separator}${block}${newline}`;
  }
  return `${current.slice(0, current.indexOf(existing))}${block}${current.slice(current.indexOf(existing) + existing.length)}`;
}

function removeBlock(current, startMarker, endMarker) {
  const existing = extractBlock(current, startMarker, endMarker);
  if (!existing) return current;
  return `${current.slice(0, current.indexOf(existing))}${current.slice(current.indexOf(existing) + existing.length)}`;
}

export function renderManagedBlock(body) {
  return renderBlock(body, MANAGED_START, MANAGED_END);
}

export function extractManagedBlock(content) {
  return extractBlock(content, MANAGED_START, MANAGED_END);
}

export function mergeManagedBlock(current, body) {
  return mergeBlock(current, body, MANAGED_START, MANAGED_END);
}

export function removeManagedBlock(current) {
  return removeBlock(current, MANAGED_START, MANAGED_END);
}

export function renderGitignoreBlock(body) {
  return renderBlock(body, GITIGNORE_MANAGED_START, GITIGNORE_MANAGED_END);
}

export function extractGitignoreBlock(content) {
  return extractBlock(content, GITIGNORE_MANAGED_START, GITIGNORE_MANAGED_END);
}

export function mergeGitignoreBlock(current, body) {
  return mergeBlock(current, body, GITIGNORE_MANAGED_START, GITIGNORE_MANAGED_END);
}

export function removeGitignoreBlock(current) {
  return removeBlock(current, GITIGNORE_MANAGED_START, GITIGNORE_MANAGED_END);
}

export function generatedHeader(comment = '<!--') {
  return comment === '<!--' ? `<!-- ${GENERATED_MARKER} -->` : `${comment} ${GENERATED_MARKER}`;
}
