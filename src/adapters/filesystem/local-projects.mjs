import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lstatSafe, writeAtomicFile } from './files.mjs';

const MAX_RECENTS = 8;
const MAX_PATH_LENGTH = 4096;

function stateFile({ env = process.env, platform = process.platform } = {}) {
  const home = os.homedir();
  const base = path.isAbsolute(env.XDG_CONFIG_HOME ?? '') ? env.XDG_CONFIG_HOME
    : platform === 'win32' && path.isAbsolute(env.APPDATA ?? '') ? env.APPDATA
      : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config');
  return path.join(base, 'ai-code-governance', 'recent-projects.json');
}

export function resolveProjectDirectory(candidate, { allowBroad = false } = {}) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_PATH_LENGTH || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new Error('Choose an existing absolute directory path.');
  }
  const stat = lstatSafe(candidate);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Project path must be a real directory, not a file or symbolic link.');
  const canonical = fs.realpathSync(candidate);
  if (!allowBroad && (canonical === path.parse(canonical).root || canonical === fs.realpathSync(os.homedir()))) {
    throw new Error('Choose a project folder, not the filesystem root or home directory.');
  }
  return canonical;
}

export function homeDirectory() {
  return os.homedir();
}

export function listDirectories(candidate) {
  const directory = resolveProjectDirectory(candidate, { allowBroad: true });
  const names = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 120);
  const parent = path.dirname(directory);
  return { directory, parent: parent === directory ? null : parent, directories: names };
}

export function recentProjects(options = {}) {
  const file = stateFile(options);
  const stat = lstatSafe(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) return [];
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item) => typeof item === 'string' && path.isAbsolute(item) && item.length <= MAX_PATH_LENGTH))]
      .filter((item) => lstatSafe(item)?.isDirectory())
      .slice(0, MAX_RECENTS);
  } catch { return []; }
}

export function rememberProject(root, options = {}) {
  const canonical = resolveProjectDirectory(root);
  const file = stateFile(options);
  const current = recentProjects(options);
  const next = [canonical, ...current.filter((item) => item !== canonical)].slice(0, MAX_RECENTS);
  writeAtomicFile(file, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}
