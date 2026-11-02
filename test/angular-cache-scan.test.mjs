import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';

test('Angular compiler caches never become source files or governance units', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-angular-cache-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of ['src/main.ts', '.angular/cache/vite/deps/package.json', 'apps/web/.Angular/cache/vite/deps/package.json']) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), relative.endsWith('.json') ? '{"dependencies":{"@angular/core":"21.0.0"}}' : 'export const value = 1;');
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"@angular/core":"21.0.0"}}');
  const scan = scanProject(root, { probeEnvironment: false });
  assert.ok(scan.files.some((file) => file.relative === 'src/main.ts'));
  assert.equal(scan.files.some((file) => /(^|\/)\.angular\//i.test(file.relative)), false);
  assert.equal(scan.governanceUnits.some((unit) => /(^|\/)\.angular\//i.test(unit.path)), false);
});
