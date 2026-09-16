import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryFixture, write } from '../helpers/memory-fixture.mjs';
import { unitFixture } from '../helpers/work-unit-fixture.mjs';

test('login page, three APIs, schema, migration, service, clients and tests stay one vertical unit', async (t) => {
  const root = memoryFixture(t);
  const paths = ['src/pages/Login.mjs', 'src/api/session.mjs', 'src/server/session.mjs', 'src/server/service.mjs', 'src/data/session.schema.json', 'db/migrations/session.sql', 'test/session.test.mjs'];
  write(root, paths[0], 'export function Login() { return null; }\n');
  write(root, paths[1], "export function login() { return fetch('/login', {method: 'POST'}); }\n");
  write(root, paths[2], "import {Router} from 'express'; const router = Router(); router.post('/register', handler); router.post('/login', handler); router.post('/reset-password', handler);\n");
  write(root, paths[4], '{}\n'); write(root, paths[5], 'CREATE TABLE sessions (id INTEGER);\n'); write(root, paths[6], '// tests\n');
  const { planWorkUnit } = await import('../../src/modules/work-units/index.mjs');
  const unit = unitFixture(root, paths, {taskLevel: 'L3', reviewMode: 'high-consequence-pk'});
  unit.scope = [{id: 'ui', paths: paths.slice(0, 2)}, {id: 'server-data', paths: paths.slice(2)}];
  const preview = planWorkUnit(root, unit);
  assert.equal(preview.workUnit.id, 'feature');
  assert.equal(preview.workUnit.scope.length, 2);
  assert.equal(preview.coverage.filter((entry) => entry.kind === 'api').length, 3);
  assert.equal(preview.workUnit.testCases.length, 6);
  assert.equal('tasks' in preview, false);
  assert.deepEqual(preview.actionsPerformed, []);
});
