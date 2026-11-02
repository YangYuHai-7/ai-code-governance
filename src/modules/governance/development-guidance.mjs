import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';
import { sha256 } from '../../shared/index.mjs';
import { buildProjectDocumentSkills } from '../skills/index.mjs';
import { buildTechnicalStandardArtifacts } from '../standards/index.mjs';

const BASELINE = new Set(['proportionate-design', 'module-boundaries', 'component-reuse']);

/** Select concrete implementation guidance, without asserting that an Agent read it. */
export function buildDevelopmentGuidance(root, config, scan, level, paths = []) {
  const result = { status: 'not-required', skills: [], application: 'unverified',
    review: ['Search existing capabilities before adding another implementation.',
      'Review actual consumers, module dependencies, state ownership and any new abstractions.',
      'Run affected behavior and boundary checks; retain failed and unexecuted results.'],
    boundary: 'File integrity and task selection do not prove Agent loading, design quality or executed verification.' };
  if (!['L1.5', 'L2', 'L3'].includes(level)) return result;
  const built = buildTechnicalStandardArtifacts(config, scan);
  const dotnet = !paths.length || paths.some(relative => /\.(?:cs|fs|vb|csproj|fsproj|vbproj|slnx?|axaml|props|targets)$/i.test(relative));
  const selected = built.selection.selected.filter(({ standard }) => BASELINE.has(standard.id)
    || (dotnet && standard.id === 'dotnet-development'));
  result.skills = selected.map(({ standard }) => {
    const artifact = built.artifacts.find(entry => entry.path === `docs/ai/skills/standards/${standard.id}/SKILL.md`);
    let status = 'missing';
    let actualSha256 = null;
    try {
      actualSha256 = sha256(readBoundedRepositoryFile(root, artifact.path, 128 * 1024).bytes);
      status = actualSha256 === sha256(artifact.content) ? 'current' : 'stale';
    } catch (error) { if (error.code !== 'ENOENT') status = 'unreadable'; }
    return { id: standard.id, path: artifact.path, status, sha256: actualSha256,
      reason: BASELINE.has(standard.id) ? 'production-change-baseline' : 'matching-dotnet-manifests-and-paths' };
  });
  for (const artifact of buildProjectDocumentSkills(config, scan).artifacts.filter(entry => entry.kind === 'project-document-skill')) {
    let status = 'missing';
    let actualSha256 = null;
    try {
      actualSha256 = sha256(readBoundedRepositoryFile(root, artifact.path, 128 * 1024).bytes);
      status = actualSha256 === sha256(artifact.content) ? 'current' : 'stale';
    } catch (error) { if (error.code !== 'ENOENT') status = 'unreadable'; }
    result.skills.push({ id: artifact.path.split('/').at(-2), path: artifact.path, status, sha256: actualSha256, reason: 'project-development-document' });
  }
  result.status = result.skills.every(entry => entry.status === 'current') ? 'ready' : 'needs-sync';
  return result;
}
