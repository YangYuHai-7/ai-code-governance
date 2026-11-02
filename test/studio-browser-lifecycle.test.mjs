import assert from 'node:assert/strict';
import test from 'node:test';
import { mountStudio } from '../assets/studio/app.js';

class Node {
  constructor() { this.handlers = new Map(); this.children = []; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; }
  addEventListener(type, handler) { const handlers = this.handlers.get(type) ?? new Set(); handlers.add(handler); this.handlers.set(type, handlers); }
  removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
  dispatch(type) { for (const handler of this.handlers.get(type) ?? []) handler({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

function documentFixture() {
  const ids = ['request-text', 'profile', 'preview-button', 'submit-button', 'retry-button', 'new-intent-button', 'status', 'preview', 'preview-text', 'preview-details', 'refresh-button', 'session-list', 'session-detail'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Node()]));
  elements.profile.value = 'advisory';
  return { elements, doc: { defaultView: new Node(), getElementById: (id) => elements[id], createElement: () => new Node(), querySelector: () => ({ content: 'token' }) } };
}

function reply(data, status = 200) { return { ok: status >= 200 && status < 300, json: async () => ({ ok: true, data }) }; }
function errorReply(code, message, status = 409) { return { ok: false, status, json: async () => ({ ok: false, error: { code, message } }) }; }
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
const visibleText = (node) => [node.textContent, ...node.children.map(visibleText)].join('\n');

test('edited preview cannot win, unknown create keeps its key, and dispose removes owned listeners', async () => {
  const { doc, elements } = documentFixture();
  const previews = [];
  const submits = [];
  const fetcher = (route, options) => {
    if (options.method === 'GET') return Promise.resolve(reply({ sessions: [] }));
    if (route.endsWith('/preview')) { const next = deferred(); previews.push({ next, signal: options.signal }); return next.promise; }
    const next = deferred(); submits.push({ next, input: JSON.parse(options.body), signal: options.signal }); return next.promise;
  };
  const dispose = mountStudio(doc, { fetch: fetcher, randomKey: () => '0123456789abcdef' });
  elements['request-text'].value = 'Old task';
  elements['preview-button'].dispatch('click');
  elements['request-text'].value = 'New task';
  elements['request-text'].dispatch('input');
  assert.equal(previews[0].signal.aborted, true);
  previews[0].next.resolve(reply({ requestText: 'Old task' }));
  await tick();
  assert.equal(elements.preview.hidden, true);
  elements['preview-button'].dispatch('click');
  previews[1].next.resolve(reply({ requestText: 'New task', profile: 'advisory', previewDigest: 'a'.repeat(64), repositoryDigest: 'b'.repeat(64), authority: { allowedPaths: [], allowedCommands: [], allowNetwork: false, allowExternalEffects: false }, budgets: { maxAgentTurns: 12, maxCommands: 32 } }));
  await tick();
  assert.equal(elements['preview-text'].textContent, 'New task');
  elements['submit-button'].dispatch('click');
  assert.equal(submits.length, 1);
  submits[0].next.reject(new Error('connection lost'));
  await tick();
  assert.equal(elements['retry-button'].hidden, false);
  elements['retry-button'].dispatch('click');
  assert.equal(submits.length, 2);
  assert.deepEqual(submits[1].input, submits[0].input);
  dispose();
  assert.equal(submits[1].signal.aborted, true);
  submits[1].next.resolve(reply({ sessionId: 'studio.one', replayed: true, inspection: { sessionId: 'studio.one' } }));
  await tick();
  assert.equal(elements['session-detail'].children.length, 0);
  elements['preview-button'].dispatch('click');
  assert.equal(previews.length, 2);
  assert.equal(doc.defaultView.handlers.get('pagehide')?.size, 0);
});

test('refresh and remount do not retain duplicate session button handlers', async () => {
  const { doc, elements } = documentFixture();
  let gets = 0;
  const fetcher = () => { gets += 1; return Promise.resolve(reply({ sessions: [{ sessionId: 'session.one', state: 'requirements-pending' }] })); };
  const first = mountStudio(doc, { fetch: fetcher });
  await tick();
  const oldButton = elements['session-list'].children[0].children[0];
  assert.equal(oldButton.handlers.get('click')?.size, 1);
  elements['refresh-button'].dispatch('click');
  await tick();
  assert.equal(oldButton.handlers.get('click')?.size, 0);
  first();
  const second = mountStudio(doc, { fetch: fetcher });
  await tick();
  elements['refresh-button'].dispatch('click');
  await tick();
  assert.equal(gets, 4);
  second();
});

test('unresolved publication retains the original submission key and explains manual recovery', async () => {
  const { doc, elements } = documentFixture();
  const submits = [];
  const fetcher = (route, options) => {
    if (options.method === 'GET') return Promise.resolve(reply({ sessions: [] }));
    if (route.endsWith('/preview')) return Promise.resolve(reply({ requestText: 'Build', profile: 'advisory', previewDigest: 'a'.repeat(64), repositoryDigest: 'b'.repeat(64), authority: { allowedPaths: [], allowedCommands: [], allowNetwork: false, allowExternalEffects: false }, budgets: { maxAgentTurns: 12, maxCommands: 32 } }));
    submits.push(JSON.parse(options.body));
    return Promise.resolve(errorReply('publication-unresolved', 'Publication is unresolved.'));
  };
  const dispose = mountStudio(doc, { fetch: fetcher, randomKey: () => '0123456789abcdef' });
  elements['request-text'].value = 'Build';
  elements['preview-button'].dispatch('click');
  await tick();
  elements['submit-button'].dispatch('click');
  await tick();
  assert.match(elements.status.textContent, /人工恢复/);
  assert.equal(elements['retry-button'].hidden, false);
  elements['retry-button'].dispatch('click');
  await tick();
  assert.deepEqual(submits[1], submits[0]);
  dispose();
});

test('a lost local connection explains safe inspection without replacing the submission key', async () => {
  const { doc, elements } = documentFixture();
  const submits = [];
  let reads = 0;
  const fetcher = (route, options) => {
    if (options.method === 'GET') return ++reads === 1 ? Promise.resolve(reply({ sessions: [] })) : Promise.reject(new TypeError('fetch failed'));
    if (route.endsWith('/preview')) return Promise.resolve(reply({ requestText: 'Build', profile: 'advisory', previewDigest: 'a'.repeat(64), repositoryDigest: 'b'.repeat(64), authority: { allowedPaths: [], allowedCommands: [], allowNetwork: false, allowExternalEffects: false }, budgets: { maxAgentTurns: 12, maxCommands: 32 } }));
    submits.push(JSON.parse(options.body));
    return Promise.reject(new TypeError('fetch failed'));
  };
  const dispose = mountStudio(doc, { fetch: fetcher, randomKey: () => '0123456789abcdef' });
  elements['request-text'].value = 'Build';
  elements['preview-button'].dispatch('click');
  await tick();
  elements['submit-button'].dispatch('click');
  await tick();
  assert.match(elements.status.textContent, /本地服务可能已停止/);
  assert.match(elements.status.textContent, /不要创建新请求/);
  assert.equal(elements['retry-button'].hidden, false);
  elements['retry-button'].dispatch('click');
  await tick();
  assert.deepEqual(submits[1], submits[0]);
  elements['refresh-button'].dispatch('click');
  await tick();
  assert.match(elements.status.textContent, /重新运行 aicg studio/);
  dispose();
});

test('guided session list and detail remain Chinese without exposing technical ids as labels', async () => {
  const { doc, elements } = documentFixture();
  const sessionId = `studio.${'a'.repeat(64)}`;
  const inspection = {
    sessionId, state: 'requirements-pending',
    guided: { status: 'needs-decision', evidence: { status: 'incomplete' } },
    expert: { activeAgentId: null, authority: { allowedPaths: [], allowedCommands: [] } },
  };
  const fetcher = (route) => Promise.resolve(reply(route.endsWith(sessionId) ? inspection : { sessions: [inspection] }));
  const dispose = mountStudio(doc, { fetch: fetcher });
  await tick();
  const button = elements['session-list'].children[0].children[0];
  assert.equal(button.textContent, '会话 1 · 等待确认需求');
  button.dispatch('click');
  await tick();
  const detailText = elements['session-detail'].children.map((entry) => entry.textContent).join('\n');
  assert.match(detailText, /等待确认需求/);
  assert.match(detailText, /证据未齐/);
  assert.match(detailText, /下一步：确认业务需求/);
  assert.doesNotMatch(detailText, /studio\.|requirements-pending|incomplete|Requirements/);
  dispose();
});

test('guided completed state stays blocked when the current evidence is blocked', async () => {
  const { doc, elements } = documentFixture();
  const inspection = {
    sessionId: 'studio.completed', state: 'completed',
    guided: { status: 'blocked', evidence: { status: 'incomplete' } },
    expert: { activeAgentId: null, authority: { allowedPaths: [], allowedCommands: [] } },
  };
  const fetcher = (route) => Promise.resolve(reply(route.endsWith('studio.completed') ? inspection : { sessions: [inspection] }));
  const dispose = mountStudio(doc, { fetch: fetcher });
  await tick();
  elements['session-list'].children[0].children[0].dispatch('click');
  await tick();
  const detailText = elements['session-detail'].children.map((entry) => entry.textContent).join('\n');
  assert.match(detailText, /不得作为已完成交付/);
  assert.doesNotMatch(detailText, /交付已完成/);
  dispose();
});

test('Studio detail exposes recorded decisions, risks, recovery, and exact expert facts', async () => {
  const { doc, elements } = documentFixture();
  const inspection = {
    sessionId: 'session.inspect', state: 'blocked',
    guided: {
      status: 'blocked', evidence: { status: 'incomplete', required: 2, passed: 0, failed: 1, missing: 1 },
      decisions: [{ kind: 'question', status: 'open', text: 'Which user owns this task?' }],
      risks: [{ code: 'quality-matrix-failed', severity: 'blocking', detail: 'Unit tests failed.' }],
      recovery: { available: true, checkpointCount: 2, lastFailure: { category: 'verification', message: 'A check failed.' } },
    },
    expert: {
      activeAgentId: null, authority: { allowedPaths: [], allowedCommands: [] },
      budgets: { maxAgentTurns: 4 }, usage: { agentTurns: 1 },
      digests: { request: 'a'.repeat(64) }, checkpoints: [{ id: 'checkpoint.one' }], evidence: { status: 'failed' },
    },
  };
  const fetcher = (route) => Promise.resolve(reply(route.endsWith('session.inspect') ? inspection : { sessions: [inspection] }));
  const dispose = mountStudio(doc, { fetch: fetcher });
  await tick();
  elements['session-list'].children[0].children[0].dispatch('click');
  await tick();
  const detail = visibleText(elements['session-detail']);
  assert.match(detail, /待决事项/);
  assert.match(detail, /Which user owns this task\?/);
  assert.match(detail, /风险/);
  assert.match(detail, /Unit tests failed\./);
  assert.match(detail, /恢复/);
  assert.match(detail, /2 个检查点/);
  assert.match(detail, /专家详情/);
  assert.match(detail, /"maxAgentTurns": 4/);
  assert.match(detail, /"agentTurns": 1/);
  assert.match(detail, /"checkpoint.one"/);
  dispose();
});
