import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCommand, runNpm, windowsBatchCommandLine } from '../src/adapters/process/commands.mjs';

test('direct commands keep shell syntax literal even when options request a shell', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const argument = '$(touch injected); echo injected & < > | %PATH% !PATH! "quoted"';
  const result = runCommand(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', argument], { cwd: root, encoding: 'utf8', shell: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [argument]);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('Windows batch command lines quote literal words and reject shell expansion', () => {
  assert.equal(windowsBatchCommandLine('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'verify', '--prefix', 'C:\\sample 项目', '']), '""C:\\Program Files\\nodejs\\npm.cmd" "run" "verify" "--prefix" "C:\\sample 项目" """');
  for (const word of ['a&b', 'a|b', 'a>b', 'a<b', 'a^b', '%PATH%', '!PATH!', 'a"b', 'a(b)', 'a\nb', 'a\0b']) {
    assert.throws(() => windowsBatchCommandLine('npm.cmd', [word]), { code: 'EINVAL' });
    assert.throws(() => windowsBatchCommandLine(`${word}.cmd`, []), { code: 'EINVAL' });
  }
});

test('Windows runs batch files with spaces and rejects injection before spawning', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-batch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const batch = path.join(root, 'literal command.cmd');
  fs.writeFileSync(batch, '@echo off\r\necho [%~1]\r\n');
  const result = runCommand(batch, ['literal with spaces'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[literal with spaces]');
  assert.equal(runCommand(batch, ['ok & echo injected']).error.code, 'EINVAL');
  const npm = runNpm(['--version'], { encoding: 'utf8' });
  assert.equal(npm.status, 0, npm.stderr);
  assert.match(npm.stdout, /^\d+\./);
});
