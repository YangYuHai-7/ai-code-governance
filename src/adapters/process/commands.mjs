import { spawnSync } from 'node:child_process';

export function runCommand(command, args = [], options = {}) {
  return spawnSync(command, args, options);
}

export function runGit(root, args, options = {}) {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  return runCommand(executable, ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

export function resolveGitRoot(target) {
  const result = runGit(target, ['rev-parse', '--show-toplevel'], { timeout: 5000 });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

export function runNpm(args, options = {}) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return runCommand(executable, args, options);
}

export function runNpmScript(root, script, options = {}) {
  return runNpm(['run', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

export function commandExists(command, env = process.env) {
  const executable = process.platform === 'win32' ? 'where' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command];
  return runCommand(executable, args, { env, stdio: 'ignore' }).status === 0;
}

export function commandVersion(command, env = process.env) {
  const result = runCommand(command, ['--version'], { env, encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}
