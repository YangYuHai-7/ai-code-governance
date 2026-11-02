import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { prepareDeliverySessionStart, startDeliverySession } from '../src/modules/delivery-start/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

const serviceUrl = new URL('../src/modules/delivery-start/index.mjs', import.meta.url).href;
const storeUrl = new URL('../src/adapters/filesystem/index.mjs', import.meta.url).href;
const publisherScript = `
import fs from 'node:fs';
const { startDeliverySession } = await import(${JSON.stringify(serviceUrl)});
const { openDeliverySessionStore } = await import(${JSON.stringify(storeUrl)});
const [root, serialized, signal, release, pauseAt = 'after-reserve'] = process.argv.slice(1);
const input = JSON.parse(serialized);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const storeFactory = (directory) => openDeliverySessionStore(directory, { onCreateStep(step) {
  if (step !== pauseAt) return;
  fs.writeFileSync(signal, step);
  while (!fs.existsSync(release)) Atomics.wait(sleeper, 0, 0, 10);
} });
try { const result = startDeliverySession(root, input, { storeFactory }); console.log(JSON.stringify({ ok: true, replayed: result.replayed, id: result.session.id })); }
catch (error) { console.log(JSON.stringify({ ok: false, message: error.message })); }
`;
const contenderScript = `
const { startDeliverySession } = await import(${JSON.stringify(serviceUrl)});
const [root, serialized] = process.argv.slice(1);
try { const result = startDeliverySession(root, JSON.parse(serialized)); console.log(JSON.stringify({ ok: true, replayed: result.replayed, id: result.session.id })); }
catch (error) { console.log(JSON.stringify({ ok: false, message: error.message })); }
`;

function launch(script, args) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const completed = new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`Worker exited ${code}: ${errors}`));
      try { resolve(JSON.parse(output.trim())); } catch { reject(new Error(`Worker produced invalid output: ${output} ${errors}`)); }
    });
  });
  return { child, completed };
}

async function awaitFile(file) {
  const started = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - started > 5000) throw new Error('Reserved-session barrier was not reached.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('same-key concurrent starts converge after one process reserves the session', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-race-project-'));
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-race-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(control, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ready = true;\n');
  const preview = prepareDeliverySessionStart(root, { requestText: 'Build one task' });
  const input = { source: 'studio', requestText: 'Build one task', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' };
  const signal = path.join(control, 'reserved');
  const release = path.join(control, 'release');
  const publisher = launch(publisherScript, [root, JSON.stringify(input), signal, release]);
  t.after(() => publisher.child.kill());
  await awaitFile(signal);
  const contender = launch(contenderScript, [root, JSON.stringify(input)]);
  t.after(() => contender.child.kill());
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.writeFileSync(release, 'go');
  const [first, second] = await Promise.all([publisher.completed, contender.completed]);
  assert.equal(first.ok, true, first.message);
  assert.equal(second.ok, true, second.message);
  assert.equal(second.replayed, true);
  assert.equal(second.id, first.id);
  assert.equal(openDeliverySessionStore(root).list().length, 1);
});

test('an abandoned reservation stays invisible and cannot silently create a second session', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-abandoned-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requestText = 'Build one task';
  const idempotencyKey = '0123456789abcdef';
  const previewDigest = prepareDeliverySessionStart(root, { requestText }).previewDigest;
  const id = `studio.${sha256(`studio-start-v1\0${idempotencyKey}`)}`;
  const directory = path.join(root, '.ai-governance/state/delivery-sessions', id);
  fs.mkdirSync(directory, { recursive: true });
  assert.throws(() => startDeliverySession(root, { source: 'studio', requestText, previewDigest, idempotencyKey }), /incomplete|manual recovery/i);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
  assert.equal(fs.existsSync(path.join(directory, 'session.json')), false);
});

test('a killed publisher leaves an incomplete reservation that same-key retry does not publish', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-killed-project-'));
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-killed-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(control, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ready = true;\n');
  const requestText = 'Build one task';
  const idempotencyKey = '0123456789abcdef';
  const previewDigest = prepareDeliverySessionStart(root, { requestText }).previewDigest;
  const input = { source: 'studio', requestText, previewDigest, idempotencyKey };
  const signal = path.join(control, 'reserved');
  const release = path.join(control, 'never-released');
  const child = spawn(process.execPath, ['--input-type=module', '-e', publisherScript, root, JSON.stringify(input), signal, release], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const exited = new Promise((resolve) => child.once('exit', (code, exitSignal) => resolve({ code, exitSignal })));
  await awaitFile(signal);
  assert.equal(child.kill(), true);
  assert.notEqual((await exited).code, 0);
  const id = `studio.${sha256(`studio-start-v1\0${idempotencyKey}`)}`;
  const directory = path.join(root, '.ai-governance/state/delivery-sessions', id);
  assert.equal(fs.existsSync(directory), true);
  assert.equal(fs.existsSync(path.join(directory, 'session.json')), false);
  assert.throws(() => startDeliverySession(root, input), /incomplete|manual recovery/i);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
  assert.equal(fs.existsSync(path.join(directory, 'session.json')), false);
});

test('a killed publisher after durable publication is recovered by the original key only', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-published-project-'));
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-published-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(control, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ready = true;\n');
  const requestText = 'Build one task';
  const idempotencyKey = '0123456789abcdef';
  const previewDigest = prepareDeliverySessionStart(root, { requestText }).previewDigest;
  const input = { source: 'studio', requestText, previewDigest, idempotencyKey };
  const signal = path.join(control, 'published');
  const release = path.join(control, 'never-released');
  const child = spawn(process.execPath, ['--input-type=module', '-e', publisherScript, root, JSON.stringify(input), signal, release, 'after-publish'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await awaitFile(signal);
  assert.equal(child.kill(), true);
  assert.notEqual(await exited, 0);
  const id = `studio.${sha256(`studio-start-v1\0${idempotencyKey}`)}`;
  const store = openDeliverySessionStore(root);
  assert.equal(store.read(id).id, id);
  assert.equal(store.list().length, 1);
  const replay = startDeliverySession(root, input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.session.id, id);
  assert.equal(store.list().length, 1);
  assert.throws(() => startDeliverySession(root, { ...input, requestText: 'Different task' }), /conflict/i);
  assert.equal(store.list().length, 1);
});

test('same-key concurrent request with changed input is rejected after the winner publishes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-race-conflict-'));
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-race-conflict-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(control, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ready = true;\n');
  const preview = prepareDeliverySessionStart(root, { requestText: 'Build one task' });
  const input = { source: 'studio', requestText: 'Build one task', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' };
  const signal = path.join(control, 'reserved');
  const release = path.join(control, 'release');
  const publisher = launch(publisherScript, [root, JSON.stringify(input), signal, release]);
  t.after(() => publisher.child.kill());
  await awaitFile(signal);
  const contender = launch(contenderScript, [root, JSON.stringify({ ...input, requestText: 'Different task' })]);
  t.after(() => contender.child.kill());
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.writeFileSync(release, 'go');
  const [first, second] = await Promise.all([publisher.completed, contender.completed]);
  assert.equal(first.ok, true, first.message);
  assert.equal(second.ok, false);
  assert.match(second.message, /conflict/i);
  assert.equal(openDeliverySessionStore(root).list().length, 1);
});
