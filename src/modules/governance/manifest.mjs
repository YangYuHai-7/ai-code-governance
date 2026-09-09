import {
  MANIFEST_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
} from '../../constants.mjs';
import { sha256 } from '../../utils.mjs';
import { extractManagedBlock, renderManagedBlock } from './managed-block.mjs';

export function previousManifestEntry(manifest, relative) {
  if (!Array.isArray(manifest?.files)) return null;
  return manifest.files.find((entry) => entry?.path === relative) ?? null;
}

export function managedContentHash(content, ownership) {
  if (ownership === 'managed-block') {
    const block = extractManagedBlock(content);
    return block ? sha256(block) : null;
  }
  return sha256(content);
}

export function buildManifest(operations, { generatedAt = null } = {}) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    templateVersion: TEMPLATE_VERSION,
    files: operations.filter((operation) => !operation.remove && operation.ownership !== 'seed').map((operation) => ({
      path: operation.path,
      ownership: operation.ownership,
      kind: operation.kind,
      source: operation.source,
      sha256: operation.ownership === 'managed-block' ? sha256(renderManagedBlock(operation.content)) : sha256(operation.desired),
    })),
  };
  if (generatedAt) manifest.generatedAt = generatedAt;
  return manifest;
}
