import { MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME } from '../../constants.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

export function validateManifestRemovalAuthority(root, manifest) {
  void root;
  const errors = [];
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push('schemaVersion');
  if (manifest?.generatedBy !== TOOL_NAME) errors.push('generatedBy');
  if (!Number.isInteger(manifest?.templateVersion) || manifest.templateVersion < 1 || manifest.templateVersion > TEMPLATE_VERSION) errors.push('templateVersion');
  if (!Array.isArray(manifest?.files)) errors.push('files');
  for (const entry of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (!isSafeRelative(entry?.path ?? '')) errors.push(`unsafe path: ${entry?.path}`);
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry?.ownership)) errors.push(`ownership: ${entry?.path}`);
    if (typeof entry?.kind !== 'string' || typeof entry?.source !== 'string') errors.push(`source: ${entry?.path}`);
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')) errors.push(`sha256: ${entry?.path}`);
  }
  return { trusted: errors.length === 0, errors };
}
