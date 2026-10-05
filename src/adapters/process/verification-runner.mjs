import { spawnSync } from 'node:child_process';

function environment() {
  const keys = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
  return { ...Object.fromEntries(keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])), CI: '1', NODE_ENV: 'test' };
}

export function executeVerificationProcess(root, command, policy) {
  const separator = process.platform === 'win32' ? '\\' : '/';
  const cwd = command.cwd === '.' ? root : `${root.replace(/[\\/]$/, '')}${separator}${command.cwd.replaceAll('/', separator)}`;
  const started = Date.now();
  const result = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd,
    env: environment(),
    encoding: 'utf8',
    timeout: policy.timeoutMs,
    maxBuffer: policy.maxOutputBytes + 1,
    shell: false,
    windowsHide: true,
  });
  const code = result.error?.code;
  return {
    exitCode: Number.isInteger(result.status) ? result.status : null,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', durationMs: Date.now() - started,
    timedOut: code === 'ETIMEDOUT', outputOverflow: code === 'ENOBUFS', missingExecutable: code === 'ENOENT', shell: false,
  };
}
