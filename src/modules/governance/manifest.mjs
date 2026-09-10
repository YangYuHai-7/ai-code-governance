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
      sha256: sha256(renderedManagedContent(operation.ownership === 'full' ? operation.desired : operation.content, operation.ownership)),
    })),
  };
  if (generatedAt) manifest.generatedAt = generatedAt;
  return manifest;
}
