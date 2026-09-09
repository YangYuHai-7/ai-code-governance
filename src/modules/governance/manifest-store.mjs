import path from 'node:path';
import { MANIFEST_PATH } from '../../constants.mjs';
import { readJson } from '../../utils.mjs';

export function loadManifest(root) {
  try {
    return readJson(path.join(root, MANIFEST_PATH));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${MANIFEST_PATH}: ${error.message}`);
  }
}
