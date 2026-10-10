import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedProcessController } from '../src/adapters/process/index.mjs';

const root = process.cwd();

function fakeChild({ onKill } = {}) {
  const handlers = new Map();
  const child = {
    pid: 4242, killed: false, exitCode: null, signalCode: null, killSignals: [],
    stdout: { on(event, handler) { if (event === 'data') child.on('__stdout', handler); } },
    stderr: { on(event, handler) { if (event === 'data') child.on('__stderr', handler); } },
    on(event, handler) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(handler); return child; },
    once(event, handler) { return child.on(event, handler); },
    kill(signal) { child.killed = true; child.killSignals.push(signal); onKill?.(signal, child); return true; },
    write(text) { for (const handler of handlers.get('__stdout') ?? []) handler(text); },
    emit(event, ...args) { for (const handler of handlers.get(event) ?? []) handler(...args); },
    exit(code = 0, signal = null) { child.exitCode = code; child.signalCode = signal; for (const handler of handlers.get('exit') ?? []) handler(code, signal); },
  };
  return child;
}

function timerHarness() {
  let next = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) { next += 1; timers.set(next, { fn, ms }); return next; },
    clearTimer(handle) { timers.delete(handle); },
    fire(ms) { for (const [handle, timer] of [...timers]) if (timer.ms === ms) { timers.delete(handle); timer.fn(); } },
    pending() { return [...timers.values()].map((timer) => timer.ms); },
  };
}

function harness(child, options = {}) {
  const spawned = [];
  const timers = timerHarness();
  let now = 1000;
  const controller = createManagedProcessController({
    spawn(command, args, spawnOptions) { spawned.push({ command, args, options: spawnOptions }); return child; },
    clock: () => (now += 100),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    environment: { PATH: '/usr/bin', API_TOKEN: 'super-secret-value', UNDECLARED: 'x' },
    ...options,
  });
  return { controller, spawned, timers };
}

function spec(overrides = {}) {
  return {
    id: 'api-server',
    root,
    argv: ['node', 'apps/api/dist/main.js'],
    envAllowlist: ['PATH', 'API_TOKEN'],
    timeoutMs: 60000,
    maxOutputBytes: 1024,
    readiness: { kind: 'output', pattern: 'listening', timeoutMs: 5000 },
    shutdown: { signal: 'SIGTERM', graceMs: 500 },
    ...overrides,
  };
}

test('a ready process is observed, receipted, and stopped gracefully', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGTERM') self.exit(0, 'SIGTERM'); } });
  const { controller, spawned } = harness(child);
  const started = controller.start(spec());
  assert.equal(started.state, 'running');
  assert.equal(started.pid, 4242);
  assert.deepEqual(spawned[0].args, ['apps/api/dist/main.js']);
  assert.equal(spawned[0].options.shell, false);
  assert.equal(spawned[0].options.env.API_TOKEN, 'super-secret-value');
  child.write('booting\n');
  child.write('api listening on 3000\n');
  const ready = await controller.waitReady(started);
  assert.equal(ready.state, 'ready');
  assert.ok(Object.isFrozen(ready));
  const stopped = await controller.stop(ready, 'gate-finished');
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.forced, false);
  assert.deepEqual(stopped.cleanup, { status: 'clean', reason: null });
  assert.ok(child.killSignals.includes('SIGTERM'));
  assert.deepEqual(await controller.cleanupAll('noop'), { state: 'clean', cleaned: [], forced: [], failures: [], reason: 'noop' });
});

test('an early exit before readiness is a failure, not a ready process', async () => {
  const child = fakeChild();
  const { controller } = harness(child);
  const started = controller.start(spec({ id: 'early-exit' }));
  child.exit(1, null);
  const receipt = await controller.waitReady(started);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.failure, 'exited-before-ready');
  assert.equal(receipt.exitCode, 1);
  assert.equal(receipt.cleanup.status, 'clean');
});

test('a readiness timeout stops the process and records the failure', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGTERM') self.exit(0, 'SIGTERM'); } });
  const { controller, timers } = harness(child);
  const started = controller.start(spec({ id: 'readiness-timeout' }));
  timers.fire(5000);
  const receipt = await controller.waitReady(started);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.failure, 'readiness-timeout');
  assert.ok(child.killSignals.includes('SIGTERM'));
});

test('output beyond the declared budget stops capture and fails the process', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGTERM') self.exit(0, 'SIGTERM'); } });
  const { controller } = harness(child);
  const started = controller.start(spec({ id: 'output-overflow', maxOutputBytes: 8, readiness: { kind: 'output', pattern: 'listening', timeoutMs: 5000 } }));
  child.write('0123456789');
  const receipt = await controller.waitReady(started);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.failure, 'output-overflow');
  assert.equal(receipt.truncated, true);
  assert.equal(receipt.outputBytes, 10);
});

test('a process that ignores the graceful signal is terminated and recorded as forced', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGKILL') self.exit(null, 'SIGKILL'); } });
  const { controller, timers } = harness(child);
  const started = controller.start(spec({ id: 'forced-stop' }));
  child.write('listening\n');
  await controller.waitReady(started);
  const stopping = controller.stop(started, 'gate-finished');
  timers.fire(500);
  const stopped = await stopping;
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.forced, true);
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(stopped.cleanup.status, 'clean');
});

test('cleanup stops every active process in reverse start order', async () => {
  const children = [fakeChild(), fakeChild(), fakeChild()];
  const stopOrder = [];
  const { controller } = harness(null, {
    spawn: (command, args) => {
      const child = children.shift();
      child.on('exit', () => {});
      child.kill = (signal) => { stopOrder.push({ command, signal }); child.killSignals.push(signal); child.exit(0, signal); return true; };
      return child;
    },
  });
  const first = controller.start(spec({ id: 'service-a' }));
  const second = controller.start(spec({ id: 'service-b', argv: ['node', 'b.js'] }));
  const third = controller.start(spec({ id: 'service-c', argv: ['node', 'c.js'] }));
  const receipt = await controller.cleanupAll('gate-finished');
  assert.deepEqual(receipt.cleaned, ['service-c', 'service-b', 'service-a']);
  assert.deepEqual(stopOrder.map((entry) => entry.command), ['node', 'node', 'node']);
  assert.deepEqual(stopOrder.map((entry) => entry.signal), ['SIGTERM', 'SIGTERM', 'SIGTERM']);
  assert.deepEqual([first.id, second.id, third.id], ['service-a', 'service-b', 'service-c']);
  assert.equal(receipt.state, 'clean');
  assert.ok(Object.isFrozen(receipt));
});

test('an interruption after readiness still leaves no running process', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGTERM') self.exit(0, 'SIGTERM'); } });
  const { controller } = harness(child);
  const started = controller.start(spec({ id: 'interrupted' }));
  child.write('listening\n');
  await controller.waitReady(started);
  const receipt = await controller.cleanupAll('interrupted');
  assert.deepEqual(receipt.cleaned, ['interrupted']);
  assert.equal(receipt.state, 'clean');
  assert.equal((await controller.stop(started, 'again')).state, 'stopped');
  assert.deepEqual(await controller.cleanupAll('after'), { state: 'clean', cleaned: [], forced: [], failures: [], reason: 'after' });
});

test('a missing executable is blocked evidence instead of a hanging process', async () => {
  const child = fakeChild();
  const { controller } = harness(child);
  const started = controller.start(spec({ id: 'missing-executable', argv: ['definitely-not-installed', '--version'] }));
  child.emit('error', Object.assign(new Error('spawn definitely-not-installed ENOENT'), { code: 'ENOENT' }));
  const receipt = await controller.waitReady(started);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.failure, 'missing-executable');
  assert.equal(receipt.cleanup.status, 'clean');
  assert.equal((await controller.stop(started, 'gate-finished')).state, 'failed');
});

test('unsafe specs and duplicate active ids are rejected before spawn', () => {
  const child = fakeChild();
  const { controller, spawned } = harness(child);
  assert.throws(() => controller.start(spec({ argv: ['sh', '-c', 'echo hi'] })), /shell/i);
  assert.throws(() => controller.start(spec({ argv: ['echo', 'hi', '&&', 'rm', '-rf', '/'] })), /shell/i);
  assert.throws(() => controller.start(spec({ argv: ['echo', 'a; rm -rf /'] })), /shell/i);
  assert.throws(() => controller.start(spec({ cwd: '../outside' })), /cwd/i);
  assert.throws(() => controller.start(spec({ cwd: '/etc' })), /cwd/i);
  assert.throws(() => controller.start(spec({ env: { UNDECLARED: 'x' } })), /environment/i);
  assert.throws(() => controller.start(spec({ timeoutMs: 0 })), /timeoutMs/i);
  assert.throws(() => controller.start(spec({ maxOutputBytes: -1 })), /maxOutputBytes/i);
  assert.throws(() => controller.start(spec({ argv: [] })), /argv/i);
  assert.throws(() => controller.start(spec({ argv: ['node', ''] })), /argv/i);
  assert.equal(spawned.length, 0);
  controller.start(spec({ id: 'active' }));
  assert.throws(() => controller.start(spec({ id: 'active' })), /duplicate|active/i);
  assert.equal(spawned.length, 1);
});

test('lifecycle receipts never carry environment values or captured secrets', async () => {
  const child = fakeChild({ onKill: (signal, self) => { if (signal === 'SIGTERM') self.exit(0, 'SIGTERM'); } });
  const { controller } = harness(child);
  const started = controller.start(spec({ id: 'redaction', env: { API_TOKEN: 'super-secret-value' } }));
  child.write('listening\n');
  const ready = await controller.waitReady(started);
  const stopped = await controller.stop(ready, 'gate-finished');
  const serialized = JSON.stringify([started, ready, stopped]);
  assert.ok(!serialized.includes('super-secret-value'));
  assert.deepEqual(stopped.envKeys, ['PATH', 'API_TOKEN']);
  assert.ok(!serialized.includes('UNDECLARED'));
});
