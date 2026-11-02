import path from 'node:path';
import { PACKAGE_ROOT } from '../kernel/config/constants.mjs';
import { sha256 } from '../shared/index.mjs';
import { readBoundedTextTree, readText } from '../adapters/filesystem/index.mjs';

const BUNDLE_ROOT = path.join(PACKAGE_ROOT, 'assets/bundled-skills');
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function bundleLocation(candidate) {
  const pm = /^official:phuryn\/pm-skills\/([a-z0-9][a-z0-9._-]{0,127})$/.exec(candidate.source);
  if (pm && candidate.capabilityOwner === `pm-${pm[1]}`) {
    return { id: pm[1], root: path.join(BUNDLE_ROOT, 'pm-skills', pm[1]), license: path.join(BUNDLE_ROOT, 'pm-skills/LICENSE') };
  }
  if (candidate.source === 'curated:next-ai-draw-io/mcp-adapter' && candidate.capabilityOwner === 'diagram-authoring') {
    return { id: 'next-ai-draw-io', root: path.join(BUNDLE_ROOT, 'next-ai-draw-io'), license: null };
  }
  return null;
}

/** Exact approved catalog candidates can be projected from packaged, pinned text. */
export function bundledSkillFiles(candidate) {
  const location = bundleLocation(candidate);
  if (!location) return null;
  if (!SAFE_ID.test(location.id)) throw new Error('Bundled Skill id is invalid.');
  const files = readBoundedTextTree(location.root);
  const manifest = files.find((file) => file.relative === 'SKILL.md');
  if (!manifest || sha256(manifest.content) !== candidate.contentSha256) throw new Error(`Bundled Skill digest mismatch: ${location.id}.`);
  if (location.license) files.push({ relative: 'LICENSE', content: readText(location.license) });
  return { id: location.id, files };
}
