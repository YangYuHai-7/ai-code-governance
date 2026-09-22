import {
  MANIFEST_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
} from '../../constants.mjs';
import { sha256 } from '../../shared/index.mjs';
import {
  extractGitignoreBlock,
  extractManagedBlock,
  renderGitignoreBlock,
  renderManagedBlock,
} from './managed-block.mjs';
import { buildProjectionReceipt, PROJECTION_TEMPLATE_VERSION } from './projections.mjs';

function renderedManagedContent(content, ownership) {
  if (ownership === 'managed-block') return renderManagedBlock(content);
  if (ownership === 'gitignore-block') return renderGitignoreBlock(content);
  return content;
}

export function previousManifestEntry(manifest, relative) {
  if (!Array.isArray(manifest?.files)) return null;
  return manifest.files.find((entry) => entry?.path === relative) ?? null;
}

export function managedContentHash(content, ownership) {
  if (ownership === 'managed-block') {
    const block = extractManagedBlock(content);
    return block ? sha256(block.replaceAll('\r\n', '\n')) : null;
  }
  if (ownership === 'gitignore-block') {
    const block = extractGitignoreBlock(content);
    return block ? sha256(block.replaceAll('\r\n', '\n')) : null;
  }
  return sha256(content);
}

/**
 * One receipt per (projection, owning client). A shared client directory such as
 * .agents/skills is written once but owned by every selected client that declares it, so the
 * same path can produce more than one receipt with identical hashes.
 */
function projectionReceipts(operations) {
  const receipts = [];
  // The canonical artifact this plan writes is the receipt's source of truth. Reading it from
  // disk before apply would bind a stale preimage when the same transaction replaces it, which
  // then looked like a source mismatch on post-apply verification.
  const canonicalDesired = new Map();
  for (const operation of operations) {
    if (operation.remove || typeof operation.path !== 'string') continue;
    if (operation.ownership !== 'full' && operation.ownership !== 'seed') continue;
    canonicalDesired.set(operation.path, operation.desired ?? operation.content ?? '');
  }
  for (const operation of operations) {
    if (operation.remove || !operation.projection) continue;
    const projection = typeof operation.projection === 'function' ? operation.projection(operation) : operation.projection;
    const clientIds = Array.isArray(projection?.clientIds) ? projection.clientIds : [];
    const content = operation.desired ?? operation.content ?? '';
    const canonicalContent = canonicalDesired.has(projection.canonicalPath)
      ? canonicalDesired.get(projection.canonicalPath)
      : (projection.canonicalContent ?? '');
    for (const clientId of clientIds) {
      if (typeof clientId !== 'string') continue;
      receipts.push({
        ...buildProjectionReceipt({
          clientId,
          surfaceId: projection.surfaceId,
          path: operation.path,
          canonicalPath: projection.canonicalPath,
          content,
          canonicalContent,
          templateVersion: projection.templateVersion ?? PROJECTION_TEMPLATE_VERSION,
        }),
        ...(projection.template ? { template: projection.template } : {}),
        ...(typeof operation.source === 'string' ? { source: operation.source } : {}),
      });
    }
  }
  receipts.sort((left, right) => left.path.localeCompare(right.path)
    || left.clientId.localeCompare(right.clientId)
    || String(left.surfaceId).localeCompare(String(right.surfaceId)));
  return receipts;
}

export function buildManifest(operations, { generatedAt = null, retained = [] } = {}) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    templateVersion: TEMPLATE_VERSION,
    files: [
      ...operations.filter((operation) => !operation.remove && operation.ownership !== 'seed').map((operation) => ({
        path: operation.path,
        ownership: operation.ownership,
        kind: operation.kind,
        source: operation.source,
        sha256: sha256(renderedManagedContent(operation.ownership === 'full' ? operation.desired : operation.content, operation.ownership)),
      })),
      ...retained.map((entry) => ({
        path: entry.path,
        ownership: entry.ownership,
        kind: entry.kind,
        source: entry.source,
        sha256: entry.sha256,
      })),
    ],
  };
  manifest.projections = projectionReceipts(operations);
  if (generatedAt) manifest.generatedAt = generatedAt;
  return manifest;
}
