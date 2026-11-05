import { spawn, spawnSync } from 'node:child_process';

export function windowsBatchCommandLine(command, args) {
  const words = [command, ...args];
  // cmd.exe expands percent/exclamation references even in quotes. Accept only literal words;
  // callers needing shell syntax must use a separately reviewed execution path.
  let commandLine = '';
  for (const word of words) {
    if (typeof word !== 'string' || !/^[\p{L}\p{N} ._:/\\@=,+-]*$/u.test(word)) {
      throw Object.assign(new Error('Windows batch commands require literal arguments without shell metacharacters.'), { code: 'EINVAL' });
    }
    if (commandLine) commandLine += ' ';
    commandLine += '"' + word + '"';
  }
  return '"' + commandLine + '"';
}

export function runCommand(command, args = [], options = {}) {
  // Node requires an interpreter for batch files. Validate before constructing its command line.
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) {
    let commandLine;
    try { commandLine = windowsBatchCommandLine(command, args); }
    catch (error) { return { error, status: null, signal: null, stdout: null, stderr: null }; }
    return spawnSync('cmd.exe', ['/d', '/v:off', '/s', '/c', commandLine], { ...options, shell: false, windowsVerbatimArguments: true });
  }
  return spawnSync(command, args, { ...options, shell: false });
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

export function openBrowserUrl(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}
