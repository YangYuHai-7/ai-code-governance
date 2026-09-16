import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
export function write(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}
export function memoryFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-memory-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', JSON.stringify({ type: 'module', dependencies: { express: '5.1.0', react: '19.0.0' } }));
  write(root, 'src/pages/Widgets.mjs', "import { listWidgets } from '../api/widgets.mjs';\nexport function Widgets() { return listWidgets(); }\n");
  write(root, 'src/api/widgets.mjs', "export function listWidgets() { return fetch('/api/widgets'); }\nexport function getWidget() { return fetch('/api/widgets/one'); }\n");
  write(root, 'src/server/routes.mjs', "import { Router } from 'express';\nimport { listWidgets } from './service.mjs';\nconst router = Router();\nrouter.get('/api/widgets', listWidgets);\nrouter.get('/api/widgets/one', listWidgets);\n");
  write(root, 'src/server/service.mjs', 'export function listWidgets() { return []; }\n');
  write(root, 'src/data/widget.schema.json', '{"type":"object","properties":{"id":{"type":"string"}}}\n');
  write(root, 'test/widgets.test.mjs', "import { listWidgets } from '../src/server/service.mjs';\n");
  return root;
}
export function baseline(root) {
  for (const args of [['init'], ['config', 'user.email', 'test@example.test'], ['config', 'user.name', 'Test'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'baseline']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status) throw new Error(result.stderr);
  }
}
