import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function shouldAutoOpen({ env = process.env, platform = process.platform } = {}) {
  if (env.AICG_NO_AUTO_OPEN === '1' || env.CI
    || env.SSH_CONNECTION || env.SSH_TTY
    || (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY)) return false;
  return true;
}

export function launchConfigurationPage({ env = process.env, platform = process.platform, installDirectory = process.cwd() } = {}) {
  if (!shouldAutoOpen({ env, platform })) return false;
  const child = spawn(process.execPath, [path.join(packageRoot, 'bin/aicg.js'), 'config', 'open', '--auto-exit'], {
    cwd: installDirectory, detached: true, stdio: 'ignore', env,
  });
  child.on('error', () => {});
  child.unref();
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (launchConfigurationPage()) console.log('AICG configuration page is opening. To reopen it: aicg config open');
  else console.log('Open AICG configuration at any time with: aicg config open');
}
