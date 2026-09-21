import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installConfigurationLauncher, linuxDesktopEntry, linuxLauncherScript, macLauncherScript, windowsLauncherScript } from '../src/adapters/filesystem/launcher.mjs';

test('launchers pass one dropped folder to the visual editor on every supported OS', () => {
  const node = '/example/Node Runtime/node';
  const bin = "/example/aicg's package/bin/aicg.js";
  assert.match(macLauncherScript(node, bin), /on open droppedItems/);
  assert.match(macLauncherScript(node, bin), /quoted form of projectPath/);
  assert.match(windowsLauncherScript('C:\\Node Runtime\\node.exe', 'C:\\AICG\\bin\\aicg.js'), /config open "%~f1"/);
  assert.match(linuxLauncherScript(node, bin), /config open "\$1"/);
  assert.match(linuxDesktopEntry('/path with space/aicg-config-drop.sh'), /Exec="\/path with space\/aicg-config-drop.sh" %f/);
});

test('Windows and Linux launcher installation is idempotent and refuses changed files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-launcher-files-'));
  try {
    for (const platform of ['win32', 'linux']) {
      const first = installConfigurationLauncher({ directory, platform, node: '/node', bin: '/aicg/bin/aicg.js' });
      assert.equal(first.status, 'created');
      assert.equal(installConfigurationLauncher({ directory, platform, node: '/node', bin: '/aicg/bin/aicg.js' }).status, 'unchanged');
      assert.equal(fs.statSync(first.path).isFile(), true);
      fs.appendFileSync(first.path, 'modified\n');
      assert.throws(() => installConfigurationLauncher({ directory, platform, node: '/node', bin: '/aicg/bin/aicg.js' }), /Refusing to replace/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('macOS droplet compiles, retries unchanged, and refuses modified script', { skip: process.platform !== 'darwin' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-launcher-app-'));
  try {
    const first = installConfigurationLauncher({ directory });
    assert.equal(first.status, 'created');
    assert.equal(installConfigurationLauncher({ directory }).status, 'unchanged');
    const script = path.join(first.path, 'Contents', 'Resources', 'Scripts', 'main.scpt');
    fs.appendFileSync(script, 'modified');
    assert.throws(() => installConfigurationLauncher({ directory }), /Refusing to replace/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
