import { spawnSync } from 'node:child_process';

export function commandExists(command, env = process.env) {
  const executable = process.platform === 'win32' ? 'where' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command];
  return spawnSync(executable, args, { env, stdio: 'ignore' }).status === 0;
}

export function commandVersion(command, env = process.env) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}
