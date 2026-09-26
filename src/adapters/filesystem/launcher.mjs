import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { runCommand } from '../process/commands.mjs';
import { createExclusiveFile, lstatSafe, readText } from './files.mjs';

const NAME = 'AICG Configure';

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appleString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function batchString(value) {
  if (/["\r\n]/.test(value)) throw new Error('The launcher cannot be installed from a path containing quotes or line breaks on Windows.');
  return value.replaceAll('%', '%%');
}

export function macLauncherScript(node, bin) {
  const command = `${shellQuote(node)} ${shellQuote(bin)} config open`;
  return `on run\n  do shell script ${appleString(`${command} >/dev/null 2>&1 &`)}\nend run\n\non open droppedItems\n  repeat with itemRef in droppedItems\n    set projectPath to POSIX path of itemRef\n    do shell script ${appleString(`${command} `)} & quoted form of projectPath & " >/dev/null 2>&1 &"\n  end repeat\nend open`;
}

export function windowsLauncherScript(node, bin) {
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nif "%~1"=="" (\r\n  start "" "${batchString(node)}" "${batchString(bin)}" config open\r\n  exit /b 0\r\n)\r\nif not exist "%~f1\\NUL" (\r\n  echo Drop an existing project folder onto this launcher.\r\n  pause\r\n  exit /b 2\r\n)\r\nstart "" "${batchString(node)}" "${batchString(bin)}" config open "%~f1"\r\n`;
}

export function linuxLauncherScript(node, bin) {
  return `#!/bin/sh\nif [ "$#" -eq 0 ]; then\n  exec ${shellQuote(node)} ${shellQuote(bin)} config open\nfi\nif [ ! -d "$1" ]; then\n  printf '%s\\n' 'Drop an existing project folder onto this launcher.' >&2\n  exit 2\nfi\nexec ${shellQuote(node)} ${shellQuote(bin)} config open "$1"\n`;
}

export function linuxDesktopEntry(script) {
  const quoted = script.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return `[Desktop Entry]\nType=Application\nName=AICG Configure\nComment=Drop a project folder to open its AICG configuration\nExec="${quoted}" %f\nIcon=preferences-system\nTerminal=false\nMimeType=inode/directory;\nCategories=Development;\n`;
}

function exactFile(target, content, executable = false) {
  const stat = lstatSafe(target);
  if (!stat) return false;
  // Windows does not represent Unix execute bits in stat mode, so only enforce them on POSIX.
  if (!stat.isFile() || stat.isSymbolicLink() || readText(target) !== content || (executable && process.platform !== 'win32' && (stat.mode & 0o111) === 0)) {
    throw new Error(`Refusing to replace an existing or modified launcher: ${target}`);
  }
  return true;
}

function installFile(target, content, mode) {
  if (exactFile(target, content, mode === 0o755)) return false;
  if (createExclusiveFile(target, content, mode)) return true;
  exactFile(target, content, mode === 0o755);
  return false;
}

function installMac(directory, node, bin) {
  const target = path.join(directory, `${NAME}.app`);
  const markerFile = path.join(target, 'Contents', 'Resources', 'aicg-launcher.json');
  const scriptFile = path.join(target, 'Contents', 'Resources', 'Scripts', 'main.scpt');
  const script = macLauncherScript(node, bin);
  const sourceSha256 = crypto.createHash('sha256').update(script).digest('hex');
  const owned = () => {
    try {
      const markerStat = lstatSafe(markerFile);
      if (!markerStat?.isFile() || markerStat.isSymbolicLink() || markerStat.size > 4096) return false;
      const marker = JSON.parse(readText(markerFile));
      const stat = lstatSafe(scriptFile);
      return marker.schemaVersion === 1 && marker.node === node && marker.bin === bin
        && marker.sourceSha256 === sourceSha256
        && stat?.isFile() && !stat.isSymbolicLink()
        && marker.scriptSha256 === crypto.createHash('sha256').update(fs.readFileSync(scriptFile)).digest('hex');
    } catch { return false; }
  };
  const existing = lstatSafe(target);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink() || !owned()) {
      throw new Error(`Refusing to replace an existing or modified launcher: ${target}`);
    }
    return { status: 'unchanged', path: target, platform: 'darwin' };
  }
  const lock = `${target}.install.lock`;
  if (!createExclusiveFile(lock, `${process.pid}\n`, 0o600)) throw new Error(`Launcher installation is already in progress: ${lock}`);
  let staging;
  try {
    if (lstatSafe(target)) throw new Error(`Refusing to replace an existing launcher: ${target}`);
    staging = fs.mkdtempSync(path.join(directory, '.aicg-launcher-'));
    const stagedApp = path.join(staging, `${NAME}.app`);
    const result = runCommand('osacompile', ['-o', stagedApp, '-e', script], { encoding: 'utf8', timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error(`Cannot create macOS launcher: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
    const scriptSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(stagedApp, 'Contents', 'Resources', 'Scripts', 'main.scpt'))).digest('hex');
    fs.writeFileSync(path.join(stagedApp, 'Contents', 'Resources', 'aicg-launcher.json'), JSON.stringify({ schemaVersion: 1, node, bin, sourceSha256, scriptSha256 }), { flag: 'wx' });
    if (lstatSafe(target)) throw new Error(`Refusing to replace an existing launcher: ${target}`);
    fs.renameSync(stagedApp, target);
    return { status: 'created', path: target, platform: 'darwin' };
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    fs.unlinkSync(lock);
  }
}

export function installConfigurationLauncher({ directory = path.join(os.homedir(), 'Desktop'), platform = process.platform,
  node = process.execPath, bin = path.join(PACKAGE_ROOT, 'bin', 'aicg.js') } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Launcher output must be an absolute directory.');
  const directoryStat = lstatSafe(directory);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) throw new Error(`Launcher output directory does not exist or is a link: ${directory}`);
  const safeDirectory = fs.realpathSync(directory);
  if (platform === 'darwin') return installMac(safeDirectory, node, bin);
  if (platform === 'win32') {
    const target = path.join(safeDirectory, `${NAME}.cmd`);
    return { status: installFile(target, windowsLauncherScript(node, bin)) ? 'created' : 'unchanged', path: target, platform };
  }
  if (platform === 'linux') {
    const script = path.join(safeDirectory, 'aicg-config-drop.sh');
    const desktop = path.join(safeDirectory, `${NAME}.desktop`);
    const scriptContent = linuxLauncherScript(node, bin);
    const desktopContent = linuxDesktopEntry(script);
    exactFile(script, scriptContent, true);
    exactFile(desktop, desktopContent, true);
    const first = installFile(script, scriptContent, 0o755);
    const second = installFile(desktop, desktopContent, 0o755);
    return { status: first || second ? 'created' : 'unchanged', path: desktop, platform };
  }
  throw new Error(`Desktop drag launcher is not supported on ${platform}.`);
}
