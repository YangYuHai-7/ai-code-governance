import fs from 'node:fs';
import path from 'node:path';
import { runGit, runNpm } from '../../adapters/process/index.mjs';

const ORGANIZATIONAL_ENV = [
  'AICG_RELEASE_TYPE',
  'AICG_RELEASE_EVIDENCE',
  'AICG_RELEASE_APPROVAL',
];

const REQUIRED_PACKAGE_PATHS = [
  'LICENSE',
  'README.md',
  'SKILL.md',
  'bin/aicg.js',
  'docs/zh-CN/README.md',
  'package.json',
];

function supplied(environment, key) {
  return typeof environment[key] === 'string' && environment[key].trim().length > 0;
}

export function resolvePrepublishMode(environment = process.env) {
  const suppliedKeys = ORGANIZATIONAL_ENV.filter((key) => supplied(environment, key));
  if (suppliedKeys.length === 0) return { mode: 'engineering-publication' };
  if (suppliedKeys.length !== ORGANIZATIONAL_ENV.length) {
    throw new Error(`${ORGANIZATIONAL_ENV.join(', ')} must all be provided for organizational certification.`);
  }
  return {
    mode: 'organizational-certification',
    changeType: environment.AICG_RELEASE_TYPE.trim(),
    evidencePath: environment.AICG_RELEASE_EVIDENCE.trim(),
    replayApproval: environment.AICG_RELEASE_APPROVAL.trim(),
  };
}

/**
 * npm < 11 emits an array for `npm pack --json`; npm >= 11 emits an object keyed by package
 * name. Return the first packed entry regardless of the installed npm version.
 */
export function parseNpmPackOutput(stdout) {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) return parsed[0];
  if (parsed && typeof parsed === 'object') return Object.values(parsed)[0];
  return undefined;
}

function gitResult(root, args, label, errors) {
  const result = runGit(root, args);
  if (result.error || result.status !== 0) {
    errors.push(`${label} could not be verified by Git.`);
    return null;
  }
  return result.stdout.trim();
}

function readPackage(root, errors) {
  const packagePath = path.join(root, 'package.json');
  try {
    const stat = fs.lstatSync(packagePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      errors.push('package.json must be a regular, non-linked file.');
      return null;
    }
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    errors.push(`package.json could not be read: ${error.message}`);
    return null;
  }
}

function packedArtifact(root, packageDocument, errors) {
  const result = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    errors.push(`npm package shape could not be verified: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
    return null;
  }
  let packed;
  try {
    packed = parseNpmPackOutput(result.stdout);
  } catch (error) {
    errors.push(`npm package shape output is invalid: ${error.message}`);
    return null;
  }
  if (packed?.name !== packageDocument?.name || packed?.version !== packageDocument?.version) {
    errors.push('npm packed name and version must match package.json.');
  }
  const paths = new Set((packed?.files ?? []).map((entry) => entry.path));
  for (const required of REQUIRED_PACKAGE_PATHS) {
    if (!paths.has(required)) errors.push(`npm package is missing required path: ${required}.`);
  }
  return packed ?? null;
}

export function runEngineeringPublicationGate(target) {
  const root = path.resolve(target);
  const errors = [];
  const repositoryRoot = gitResult(root, ['rev-parse', '--show-toplevel'], 'repository root', errors);
  if (repositoryRoot) {
    try {
      // Windows realpath may add a \\?\\ prefix and differ in case, so compare canonically.
      const normalize = (value) => {
        const stripped = value.startsWith(String.fromCharCode(92, 92, 63, 92)) ? value.slice(4) : value;
        return process.platform === 'win32' ? stripped.toLowerCase() : stripped;
      };
      if (normalize(fs.realpathSync(repositoryRoot)) !== normalize(fs.realpathSync(root))) {
        errors.push('Engineering publication must run from the package repository root.');
      }
    } catch {
      errors.push('Engineering publication repository root could not be resolved.');
    }
  }
  const revision = gitResult(root, ['rev-parse', 'HEAD'], 'publication revision', errors);
  const status = gitResult(root, ['status', '--porcelain=v1', '--untracked-files=all'], 'publication worktree', errors);
  if (status) errors.push('Engineering publication requires a clean Git worktree and index.');

  const packageDocument = readPackage(root, errors);
  if (packageDocument) {
    if (packageDocument.name !== 'ai-code-governance') errors.push('Engineering publication is restricted to the ai-code-governance package.');
    if (!/^\d+\.\d+\.\d+$/.test(packageDocument.version ?? '')) errors.push('Engineering publication requires a stable SemVer package version.');
    if (packageDocument.bin?.aicg !== 'bin/aicg.js') errors.push('Engineering publication requires the aicg binary entrypoint.');
  }
  const packed = packageDocument ? packedArtifact(root, packageDocument, errors) : null;
  return {
    schemaVersion: 1,
    ok: errors.length === 0,
    mode: 'engineering-publication',
    target: root,
    revision,
    package: packageDocument ? { name: packageDocument.name ?? null, version: packageDocument.version ?? null } : null,
    packageArtifact: packed ? {
      filename: packed.filename,
      shasum: packed.shasum,
      integrity: packed.integrity,
      entryCount: packed.entryCount,
    } : null,
    errors,
    boundaries: [
      'This gate proves a clean Git candidate and the current npm package shape after the prepublish test, validation, and smoke scripts pass.',
      'It does not claim organizational certification, independent human review, real-client execution, or cross-platform verification.',
    ],
  };
}
