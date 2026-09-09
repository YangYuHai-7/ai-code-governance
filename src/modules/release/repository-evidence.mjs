import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readJson } from '../../adapters/filesystem/files.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/paths.mjs';

export function repositoryFile(root, relative, label, errors) {
  if (typeof relative !== 'string' || !isSafeRelative(relative)) {
    errors.push(`${label} must be a safe repository-relative path.`);
    return null;
  }
  const normalized = normalizeRelative(relative);
  let current = root;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      errors.push(`${label} does not exist: ${normalized}.`);
      return null;
    }
    if (stat.isSymbolicLink()) {
      errors.push(`${label} must not traverse a symbolic link: ${normalized}.`);
      return null;
    }
  }
  const finalStat = fs.statSync(current);
  if (!finalStat.isFile()) {
    errors.push(`${label} must be a regular file: ${normalized}.`);
    return null;
  }
  if (finalStat.nlink > 1) {
    errors.push(`${label} must not be a hard-linked file: ${normalized}.`);
    return null;
  }
  const tracked = git(root, ['ls-files', '--error-unmatch', '--', normalized], `${label} Git tracking`, errors);
  if (!tracked) {
    errors.push(`${label} must be tracked by Git: ${normalized}.`);
    return null;
  }
  const unchanged = git(root, ['diff', '--quiet', 'HEAD', '--', normalized], `${label} HEAD binding`, errors, [0, 1]);
  if (!unchanged || unchanged.status !== 0) {
    errors.push(`${label} must match the file committed at HEAD: ${normalized}.`);
    return null;
  }
  return current;
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifactIdentity(file) {
  const stat = fs.statSync(file);
  return {
    inode: stat.ino ? `${stat.dev}:${stat.ino}` : null,
    sha256: sha256File(file),
  };
}

export function claimArtifact(file, label, identities, errors) {
  const identity = artifactIdentity(file);
  if (identity.inode && identities.inodes.has(identity.inode)) errors.push(`${label} must not reuse a hard-linked evidence file.`);
  if (identities.hashes.has(identity.sha256)) errors.push(`${label} must not reuse identical evidence content.`);
  if (identity.inode) identities.inodes.add(identity.inode);
  identities.hashes.add(identity.sha256);
  identities.snapshots.set(file, identity.sha256);
  return identity;
}

export function repositoryJson(root, relative, label, errors, identities = null) {
  const file = repositoryFile(root, relative, label, errors);
  if (!file) return null;
  if (identities) claimArtifact(file, label, identities, errors);
  try {
    return readJson(file);
  } catch (error) {
    errors.push(`${label} must be valid JSON: ${error.message}`);
    return null;
  }
}

export function git(root, args, label, errors, acceptedStatuses = [0]) {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSync(executable, ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || !acceptedStatuses.includes(result.status)) {
    errors.push(`${label} could not be verified by Git.`);
    return null;
  }
  return { stdout: result.stdout, text: result.stdout.trim(), status: result.status };
}

export function validateCandidate(root, evidence, errors) {
  const candidate = evidence.candidate;
  if (!candidate || typeof candidate !== 'object') {
    errors.push('candidate must bind the release to Git base, revision, and tree hashes.');
    return null;
  }
  for (const field of ['baseRevision', 'releaseRevision', 'releaseTree']) {
    if (!/^[a-f0-9]{40}$/.test(candidate[field] ?? '')) errors.push(`candidate.${field} must be a full lowercase Git SHA.`);
  }
  if (errors.some((error) => error.startsWith('candidate.'))) return null;
  const releaseRevision = git(root, ['rev-parse', `${candidate.releaseRevision}^{commit}`], 'candidate release revision', errors);
  const releaseTree = git(root, ['rev-parse', `${candidate.releaseRevision}^{tree}`], 'candidate release tree', errors);
  const baseRevision = git(root, ['rev-parse', `${candidate.baseRevision}^{commit}`], 'candidate base revision', errors);
  const baseTree = git(root, ['rev-parse', `${candidate.baseRevision}^{tree}`], 'candidate base tree', errors);
  if (!releaseRevision || !releaseTree || !baseRevision || !baseTree) return null;
  if (releaseRevision.text !== candidate.releaseRevision) errors.push('candidate.releaseRevision does not resolve to the declared commit.');
  if (releaseTree.text !== candidate.releaseTree) errors.push('candidate.releaseTree does not match the declared release revision.');
  if (candidate.baseRevision === candidate.releaseRevision) errors.push('candidate.baseRevision and candidate.releaseRevision must differ.');
  if (baseTree.text === releaseTree.text) errors.push('candidate release tree must differ from its base tree.');
  const baseAncestor = git(root, ['merge-base', '--is-ancestor', candidate.baseRevision, candidate.releaseRevision], 'candidate base ancestry', errors, [0, 1]);
  if (baseAncestor?.status !== 0) errors.push('candidate.baseRevision must be an ancestor of candidate.releaseRevision.');
  const headAncestor = git(root, ['merge-base', '--is-ancestor', candidate.releaseRevision, 'HEAD'], 'candidate HEAD ancestry', errors, [0, 1]);
  if (headAncestor?.status !== 0) errors.push('candidate.releaseRevision must be an ancestor of HEAD.');
  const changed = git(root, ['diff', '--name-only', '--no-renames', '-z', `${candidate.releaseRevision}..HEAD`, '--'], 'post-candidate changes', errors);
  if (changed) {
    const paths = changed.stdout.split('\0').filter(Boolean);
    const unexpected = paths.filter((relative) => !normalizeRelative(relative).startsWith('docs/ai/release-evidence/'));
    if (unexpected.length > 0) errors.push(`Only release evidence may change after candidate.releaseRevision: ${unexpected.join(', ')}.`);
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'], 'release worktree cleanliness', errors);
  if (status?.stdout) errors.push('Release acceptance requires a clean Git worktree and index.');
  return candidate;
}

export function parseTimestamp(value, label, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    errors.push(`${label} must be an ISO-8601 timestamp.`);
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    errors.push(`${label} must be a valid ISO-8601 timestamp.`);
    return null;
  }
  return timestamp;
}

export function validateRecordedAt(value, label, generatedAt, errors) {
  const timestamp = parseTimestamp(value, label, errors);
  const generated = Date.parse(generatedAt ?? '');
  if (timestamp !== null && Number.isFinite(generated) && timestamp > generated) errors.push(`${label} must not be later than generatedAt.`);
  return timestamp;
}
