import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIntentRegistry, normalizeIntentText, resolveIntent, validateIntentRegistry } from '../src/intents.mjs';

test('normalizes exact Chinese and English intent aliases without fuzzy matching', () => {
  assert.equal(normalizeIntentText('  初始化项目ＡＩ治理框架！ '), '初始化项目ai治理框架');
  assert.equal(resolveIntent('帮我初始化项目 AI 治理框架').id, 'governance.initialize');
  assert.equal(resolveIntent(' CHECK GOVERNANCE ').id, 'governance.validate');
  assert.equal(resolveIntent('晋升项目能力').id, 'capability.promote');
  assert.equal(resolveIntent('给我团队建议').id, 'team.recommend');
  assert.equal(resolveIntent('修复一下治理框架').id, 'environment.diagnose');
  assert.throws(() => resolveIntent('修复一下这个治理框架'), (error) => error.exitCode === 2);
  assert.throws(() => resolveIntent('检查治理框架 && rm -rf /'), (error) => error.exitCode === 2);
});

test('every supported operational CLI handler has at least one exact chat intent', () => {
  const handlers = new Set(loadIntentRegistry().intents.map((intent) => intent.handler));
  assert.deepEqual([...handlers].sort(), [
    'architecture',
    'assess',
    'check',
    'doctor',
    'harvest',
    'init',
    'promote',
    'standards',
    'sync',
    'team',
  ]);
});

test('rejects alias collisions in an intent registry', () => {
  assert.throws(() => validateIntentRegistry({
    schemaVersion: 1,
    intents: [
      { id: 'one', handler: 'check', mode: 'read', aliases: ['same'] },
      { id: 'two', handler: 'doctor', mode: 'read', aliases: [' SAME '] },
    ],
  }), (error) => error.exitCode === 2);
});
