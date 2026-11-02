import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { readDeliveryInspection } from '../src/modules/delivery-inspection/index.mjs';
import { openStudioPage } from '../src/cli/commands/studio.mjs';
import { parseArgs } from '../src/cli/args.mjs';
import { sha256 } from '../src/shared/index.mjs';

function manualClock() {
  const handles = [];
  return {
    setTimeout(callback, delay) { const handle = { callback, delay, cancelled: false, unref() {} }; handles.push(handle); return handle; },
    clearTimeout(handle) { if (handle) handle.cancelled = true; },
    latest() { return handles.at(-1); },
    fire(handle) { handle.callback(); },
  };
}

test('Studio idle timer closes the listener and ignores a superseded timeout', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-idle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = manualClock();
  const studio = await openStudioPage(root, { clock });
  t.after(() => studio.close());
  const firstTimer = clock.latest();
  assert.equal(firstTimer.delay, 60 * 60 * 1000);
  const page = await fetch(studio.url);
  assert.equal(page.status, 200);
  await page.text();
  assert.equal(firstTimer.cancelled, true);
  const secondTimer = clock.latest();
  assert.notEqual(secondTimer, firstTimer);
  clock.fire(firstTimer);
  assert.equal((await fetch(studio.url)).status, 200, 'a stale timer cannot close an active Studio');
  const activeTimer = clock.latest();
  clock.fire(activeTimer);
  await studio.closed;
  studio.close();
  await assert.rejects(fetch(studio.url));
});

test('Studio closes after a real idle timeout', { timeout: 2_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-real-idle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studio = await openStudioPage(root, { idleTimeoutMs: 80 });
  t.after(() => studio.close());
  await studio.closed;
  await assert.rejects(fetch(studio.url));
});

test('Studio does not time out while a request body is still arriving', { timeout: 3_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-active-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = manualClock();
  const studio = await openStudioPage(root, { idleTimeoutMs: 60_000, clock });
  t.after(() => studio.close());
  const html = await (await fetch(studio.url)).text();
  const token = html.match(/name="aicg-session" content="([a-f0-9]+)"/)?.[1];
  assert.ok(token);
  const idleTimer = clock.latest();
  const body = JSON.stringify({ requestText: 'Build one task' });
  let request;
  const result = new Promise((resolve, reject) => {
    request = http.request(new URL('/api/v1/delivery-sessions/preview', studio.url), {
      method: 'POST',
      headers: {
        'x-aicg-session': token,
        origin: studio.url.slice(0, -1),
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.write(body.slice(0, 1));
  });
  t.after(() => request.destroy());
  for (let attempt = 0; !idleTimer.cancelled && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(idleTimer.cancelled, true);
  clock.fire(idleTimer);
  assert.equal(clock.latest(), idleTimer, 'no new idle timer is armed during an active request');
  request.end(body.slice(1));
  assert.equal(await result, 200);
  const resumedTimer = clock.latest();
  assert.notEqual(resumedTimer, idleTimer);
  clock.fire(resumedTimer);
  await studio.closed;
});

test('Studio has an explicit local CLI entrypoint', () => {
  assert.deepEqual(parseArgs(['studio', '.', '--no-open', '--json']), { command: 'studio', target: '.', options: { 'no-open': true, json: true } });
});

test('loopback Studio preview and create preserve the canonical HTTP contract', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-http-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studio = await openStudioPage(root);
  t.after(() => studio.close());
  const page = await fetch(studio.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<script[^>]+type="module"[^>]+src="\/app\.js"/);
  assert.match(html, /空闲 60 分钟后自动停止/);
  const token = html.match(/name="aicg-session" content="([a-f0-9]+)"/)?.[1];
  assert.ok(token);
  const route = (name) => new URL(name, studio.url);
  const post = async (name, body, headers = {}) => {
    const response = await fetch(route(name), { method: 'POST', headers: {
      'x-aicg-session': token, origin: studio.url.slice(0, -1), 'content-type': 'application/json', ...headers,
    }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const preview = await post('api/v1/delivery-sessions/preview', { requestText: '  Build one task  ' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.data.requestText, 'Build one task');
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
  const create = { requestText: 'Build one task', previewDigest: preview.body.data.previewDigest, idempotencyKey: '0123456789abcdef' };
  const first = await post('api/v1/delivery-sessions', create);
  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.data.replayed, false);
  assert.equal(first.body.data.inspection.sessionId, first.body.data.sessionId);
  assert.equal(first.body.data.inspection.state, 'requirements-pending');
  assert.equal(first.body.data.inspection.expert.activeAgentId, null);
  const again = await post('api/v1/delivery-sessions', create);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.replayed, true);
  assert.equal(again.body.data.sessionId, first.body.data.sessionId);
  assert.equal((await post('api/v1/delivery-sessions', { ...create, requestText: 'Different' })).status, 409);
  assert.equal(openDeliverySessionStore(root).list().length, 1);
  const list = await fetch(route('api/v1/delivery-sessions'), { headers: { 'x-aicg-session': token } });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.sessions[0].sessionId, first.body.data.sessionId);
  const detailUrl = route(`api/v1/delivery-sessions/${first.body.data.sessionId}`);
  const detail = await fetch(detailUrl, { headers: { 'x-aicg-session': token } });
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json()).data, readDeliveryInspection(root, first.body.data.sessionId));
  const head = await fetch(detailUrl, { method: 'HEAD', headers: { 'x-aicg-session': token } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const forbiddenDetailWrite = await fetch(route(`api/v1/delivery-sessions/${first.body.data.sessionId}`), { method: 'PUT', headers: { 'x-aicg-session': token } });
  assert.equal(forbiddenDetailWrite.status, 405);
  assert.equal(forbiddenDetailWrite.headers.get('allow'), 'GET, HEAD');
  fs.writeFileSync(path.join(root, '.ai-governance/state/delivery-sessions', first.body.data.sessionId, 'events.jsonl'), 'broken\n');
  const damaged = await post('api/v1/delivery-sessions', create);
  assert.equal(damaged.status, 500);
  assert.deepEqual(Object.keys(damaged.body), ['ok', 'error']);
  assert.equal(damaged.body.error.code, 'persistence-failed');
});

test('Studio rejects unauthorized, oversized, and malformed writes before persistence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-http-deny-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studio = await openStudioPage(root);
  t.after(() => studio.close());
  const html = await (await fetch(studio.url)).text();
  const token = html.match(/name="aicg-session" content="([a-f0-9]+)"/)?.[1];
  const url = new URL('api/v1/delivery-sessions/preview', studio.url);
  const body = JSON.stringify({ requestText: 'Build' });
  const headers = { 'x-aicg-session': token, origin: studio.url.slice(0, -1), 'content-type': 'application/json' };
  const request = async (extraHeaders, value = body) => fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: value });
  assert.equal((await request({ 'x-aicg-session': 'bad' })).status, 403);
  assert.equal((await request({ origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await request({ 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request({}, '{')).status, 400);
  assert.equal((await request({}, JSON.stringify({ requestText: 'x'.repeat(20_000) }))).status, 413);
  assert.equal((await request({}, JSON.stringify({ requestText: 'Build', source: 'cli' }))).status, 400);
  assert.equal((await fetch(new URL('api/v1/delivery-sessions', studio.url), { method: 'POST', headers, body: JSON.stringify({ requestText: 'Build', previewDigest: 'a'.repeat(64), idempotencyKey: '0123456789abcdef', source: 'cli' }) })).status, 400);
  assert.equal((await fetch(url, { method: 'PUT', headers })).status, 405);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
});

test('an unpublished session reservation has a distinct recoverable HTTP error', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-unresolved-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studio = await openStudioPage(root);
  t.after(() => studio.close());
  const token = (await (await fetch(studio.url)).text()).match(/name="aicg-session" content="([a-f0-9]+)"/)?.[1];
  const headers = { 'x-aicg-session': token, origin: studio.url.slice(0, -1), 'content-type': 'application/json' };
  const preview = await fetch(new URL('api/v1/delivery-sessions/preview', studio.url), {
    method: 'POST', headers, body: JSON.stringify({ requestText: 'Build one task' }),
  });
  const previewDigest = (await preview.json()).data.previewDigest;
  const idempotencyKey = '0123456789abcdef';
  const id = `studio.${sha256(`studio-start-v1\0${idempotencyKey}`)}`;
  const reservation = path.join(root, '.ai-governance/state/delivery-sessions', id);
  fs.mkdirSync(reservation, { recursive: true });
  const response = await fetch(new URL('api/v1/delivery-sessions', studio.url), {
    method: 'POST', headers, body: JSON.stringify({ requestText: 'Build one task', previewDigest, idempotencyKey }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).error.code, 'publication-unresolved');
  assert.equal(fs.existsSync(path.join(reservation, 'session.json')), false);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
});

test('the local CLI launches a usable Studio server without opening a browser', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.resolve('bin/aicg.js'), 'studio', root, '--no-open', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Studio CLI did not become ready.')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((entry) => entry.startsWith('{"url"'));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line).url); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Studio CLI exited early: ${code}`)); });
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:/);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AICG Studio/);
});

test('Host spoofing and chunked overflow fail before a session can be published', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-studio-stream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studio = await openStudioPage(root);
  t.after(() => studio.close());
  const token = (await (await fetch(studio.url)).text()).match(/name="aicg-session" content="([a-f0-9]+)"/)?.[1];
  const send = (headers, chunks) => new Promise((resolve, reject) => {
    const url = new URL(studio.url);
    const request = http.request({ hostname: '127.0.0.1', port: url.port, path: '/api/v1/delivery-sessions/preview', method: 'POST', headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
  const headers = { host: new URL(studio.url).host, origin: studio.url.slice(0, -1), 'x-aicg-session': token, 'content-type': 'application/json' };
  assert.equal(await send({ ...headers, host: 'foreign.invalid' }, ['{"requestText":"Build"}']), 403);
  assert.equal(await send(headers, ['x'.repeat(9000), 'x'.repeat(9000)]), 413);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
});
