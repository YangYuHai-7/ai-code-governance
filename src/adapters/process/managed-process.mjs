import { spawn as nodeSpawn } from 'node:child_process';
import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

const SHELL_SEQUENCES = ['&&', '||', ';', '\u0060', '$(', '\n', '\r', '\0'];
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const TERMINAL_STATES = Object.freeze(['exited', 'stopped', 'failed']);
const DEFAULTS = Object.freeze({ timeoutMs: 300000, maxOutputBytes: 4 * 1024 * 1024, graceMs: 2000, signal: 'SIGTERM', killSignal: 'SIGKILL' });
const ABSOLUTE = /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/;

function fail(path, message) {
  throw usageError(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}

function string(value, path, { max = 4096 } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(path, 'expected a non-empty string');
}

function positive(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(path, 'expected a positive integer');
}

function shellFreeArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 256) fail('managedProcess.argv', 'expected a non-empty argv array');
  argv.forEach((entry, index) => {
    string(entry, `managedProcess.argv[${index}]`, { max: 4096 });
    if (SHELL_SEQUENCES.some((token) => entry.includes(token))) fail(`managedProcess.argv[${index}]`, 'shell composition is not allowed; pass an argv array instead');
    if (index > 0 && ['-c', '/c'].includes(entry)) fail(`managedProcess.argv[${index}]`, 'shell command strings are not allowed; pass an argv array instead');
  });
  if (SHELL_INTERPRETERS.has(argv[0].toLowerCase())) fail('managedProcess.argv[0]', 'shell interpreters are not allowed; pass the target executable directly');
  return argv;
}

function safeCwd(root, cwd) {
  string(root, 'managedProcess.root', { max: 4096 });
  if (!ABSOLUTE.test(root)) fail('managedProcess.root', 'expected an absolute repository root');
  const relative = cwd ?? '.';
  if (relative !== '.' && !isSafeRelative(relative)) fail('managedProcess.cwd', 'expected a safe repository-relative cwd');
  const separator = process.platform === 'win32' ? '\\' : '/';
  const base = root.replace(/[\\/]$/, '');
  return relative === '.' ? base : `${base}${separator}${relative.replaceAll('/', separator)}`;
}

function resolveEnvironment(envAllowlist, declared, inherited) {
  if (!Array.isArray(envAllowlist) || envAllowlist.length === 0 || envAllowlist.length > 128) fail('managedProcess.envAllowlist', 'expected 1 to 128 declared keys');
  const keys = new Set();
  envAllowlist.forEach((key, index) => {
    string(key, `managedProcess.envAllowlist[${index}]`, { max: 256 });
    if (keys.has(key)) fail(`managedProcess.envAllowlist[${index}]`, `duplicate key ${key}`);
    keys.add(key);
  });
  const env = {};
  for (const key of keys) if (inherited[key] !== undefined) env[key] = inherited[key];
  if (declared !== undefined) {
    object(declared, 'managedProcess.env');
    for (const [key, value] of Object.entries(declared)) {
      if (!keys.has(key)) fail(`managedProcess.env.${key}`, 'environment key is not declared in envAllowlist');
      string(value, `managedProcess.env.${key}`, { max: 8192 });
      env[key] = value;
    }
  }
  return { env, keys: [...keys] };
}

function readinessPlan(readiness) {
  if (readiness === undefined) return { kind: 'none' };
  object(readiness, 'managedProcess.readiness');
  if (readiness.kind === 'output') {
    string(readiness.pattern, 'managedProcess.readiness.pattern', { max: 256 });
    return { kind: 'output', pattern: readiness.pattern, timeoutMs: readiness.timeoutMs === undefined ? DEFAULTS.timeoutMs : readiness.timeoutMs };
  }
  if (readiness.kind === 'delay') {
    positive(readiness.ms, 'managedProcess.readiness.ms');
    return { kind: 'delay', ms: readiness.ms, timeoutMs: readiness.timeoutMs === undefined ? DEFAULTS.timeoutMs : readiness.timeoutMs };
  }
  return fail('managedProcess.readiness.kind', 'expected output or delay');
}

function shutdownPlan(shutdown) {
  const plan = { signal: DEFAULTS.signal, killSignal: DEFAULTS.killSignal, graceMs: DEFAULTS.graceMs };
  if (shutdown === undefined) return plan;
  object(shutdown, 'managedProcess.shutdown');
  if (shutdown.signal !== undefined) { string(shutdown.signal, 'managedProcess.shutdown.signal', { max: 32 }); plan.signal = shutdown.signal; }
  if (shutdown.killSignal !== undefined) { string(shutdown.killSignal, 'managedProcess.shutdown.killSignal', { max: 32 }); plan.killSignal = shutdown.killSignal; }
  if (shutdown.graceMs !== undefined) { positive(shutdown.graceMs, 'managedProcess.shutdown.graceMs'); plan.graceMs = shutdown.graceMs; }
  return plan;
}

export function createManagedProcessController(dependencies = {}) {
  object(dependencies, 'managedProcess.dependencies');
  const spawnProcess = dependencies.spawn ?? nodeSpawn;
  if (typeof spawnProcess !== 'function') fail('managedProcess.spawn', 'a spawn function is required');
  const clock = dependencies.clock ?? (() => Date.now());
  const setTimer = dependencies.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
  const clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle));
  const inherited = dependencies.environment ?? process.env;
  const entries = new Map();
  const order = [];

  function snapshot(entry) {
    return Object.freeze({
      id: entry.id,
      state: entry.state,
      pid: entry.pid,
      argv: Object.freeze([...entry.argv]),
      cwd: entry.cwd,
      envKeys: Object.freeze([...entry.envKeys]),
      startedAt: entry.startedAt,
      readyAt: entry.readyAt,
      stoppedAt: entry.stoppedAt,
      exitCode: entry.exitCode,
      signal: entry.signal,
      forced: entry.forced,
      truncated: entry.truncated,
      outputBytes: entry.outputBytes,
      stopReason: entry.stopReason,
      failure: entry.failure,
      cleanup: Object.freeze({ status: entry.cleanupStatus, reason: entry.cleanupReason }),
    });
  }

  function notify(entry) { for (const waiter of entry.waiters.splice(0)) waiter(); }

  function clearTimers(entry) {
    if (entry.readinessTimer !== null) { clearTimer(entry.readinessTimer); entry.readinessTimer = null; }
    if (entry.totalTimer !== null) { clearTimer(entry.totalTimer); entry.totalTimer = null; }
    if (entry.graceTimer !== null) { clearTimer(entry.graceTimer); entry.graceTimer = null; }
  }

  function markReady(entry) {
    if (entry.state !== 'running' || entry.failure) return;
    entry.state = 'ready';
    entry.readyAt = clock();
    if (entry.readinessTimer !== null) { clearTimer(entry.readinessTimer); entry.readinessTimer = null; }
    notify(entry);
  }

  function markFailure(entry, reason) {
    if (entry.failure) return;
    entry.failure = reason;
    if (entry.state !== 'ready') entry.state = 'failed';
    notify(entry);
  }

  function finishStop(entry) {
    entry.stopping = true;
    if (!entry.exited) { entry.cleanupStatus = 'failed'; entry.cleanupReason = 'process exit was not confirmed'; }
    else { entry.cleanupStatus = 'clean'; entry.cleanupReason = null; }
    if (!entry.failure && entry.state !== 'failed') entry.state = entry.exited ? 'stopped' : 'failed';
    entry.stoppedAt = entry.stoppedAt ?? clock();
    const index = order.indexOf(entry.id);
    if (index !== -1) order.splice(index, 1);
    notify(entry);
  }

  async function terminate(entry, reason) {
    if (!entry.stopping && TERMINAL_STATES.includes(entry.state) && entry.cleanupStatus !== 'pending') return snapshot(entry);
    entry.stopReason = entry.stopReason ?? reason;
    entry.stopping = true;
    clearTimers(entry);
    if (entry.exited) { finishStop(entry); return snapshot(entry); }
    const exited = new Promise((resolve) => entry.exitResolvers.push(resolve));
    try { entry.child.kill(entry.shutdown.signal); } catch { markFailure(entry, 'termination-signal-failed'); }
    const forced = await Promise.race([
      exited.then(() => false),
      new Promise((resolve) => { entry.graceTimer = setTimer(() => resolve(true), entry.shutdown.graceMs); }),
    ]);
    if (entry.graceTimer !== null) { clearTimer(entry.graceTimer); entry.graceTimer = null; }
    if (forced && !entry.exited) {
      entry.forced = true;
      try { entry.child.kill(entry.shutdown.killSignal); } catch { markFailure(entry, 'forced-termination-failed'); }
      await Promise.race([exited, new Promise((resolve) => setTimer(resolve, entry.shutdown.graceMs))]);
    }
    finishStop(entry);
    return snapshot(entry);
  }

  function lookup(handle) {
    const id = typeof handle === 'string' ? handle : handle?.id;
    if (typeof id !== 'string' || !entries.has(id)) fail('managedProcess.handle', 'unknown managed process handle');
    return entries.get(id);
  }

  function start(spec) {
    object(spec, 'managedProcess.spec');
    string(spec.id, 'managedProcess.id', { max: 128 });
    if (order.includes(spec.id)) fail('managedProcess.id', `duplicate active process ${spec.id}`);
    const argv = shellFreeArgv(spec.argv);
    const cwd = safeCwd(spec.root, spec.cwd);
    const { env, keys } = resolveEnvironment(spec.envAllowlist, spec.env, inherited);
    const timeoutMs = spec.timeoutMs === undefined ? DEFAULTS.timeoutMs : spec.timeoutMs;
    positive(timeoutMs, 'managedProcess.timeoutMs');
    const maxOutputBytes = spec.maxOutputBytes === undefined ? DEFAULTS.maxOutputBytes : spec.maxOutputBytes;
    positive(maxOutputBytes, 'managedProcess.maxOutputBytes');
    const readiness = readinessPlan(spec.readiness);
    if (readiness.timeoutMs !== undefined) positive(readiness.timeoutMs, 'managedProcess.readiness.timeoutMs');
    const shutdown = shutdownPlan(spec.shutdown);

    const entry = {
      id: spec.id, argv, cwd, envKeys: keys, maxOutputBytes, readiness, shutdown,
      state: 'running', pid: null, startedAt: clock(), readyAt: null, stoppedAt: null,
      exitCode: null, signal: null, forced: false, truncated: false, outputBytes: 0,
      stopReason: null, failure: null, cleanupStatus: 'pending', cleanupReason: null,
      stdout: '', child: null, exited: false, stopping: false, waiters: [], exitResolvers: [],
      readinessTimer: null, totalTimer: null, graceTimer: null,
    };
    let child;
    try {
      child = spawnProcess(argv[0], argv.slice(1), { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      fail('managedProcess.spawn', error.message);
    }
    entry.child = child;
    entry.pid = Number.isInteger(child?.pid) ? child.pid : null;

    child.stdout?.on('data', (chunk) => {
      const text = `${chunk}`;
      entry.outputBytes += Buffer.byteLength(text);
      entry.stdout = entry.stdout.length > 65536 ? entry.stdout.slice(-32768) + text : entry.stdout + text;
      if (entry.outputBytes > entry.maxOutputBytes) {
        entry.truncated = true;
        markFailure(entry, 'output-overflow');
        void terminate(entry, 'output-overflow');
        return;
      }
      if (entry.readiness.kind === 'output' && entry.stdout.includes(entry.readiness.pattern)) markReady(entry);
    });
    child.stderr?.on('data', (chunk) => { entry.outputBytes += Buffer.byteLength(`${chunk}`); });
    child.on('error', (error) => {
      // An executable that never started is blocked evidence; it must not keep the gate waiting.
      entry.exited = true;
      entry.failure = entry.failure ?? (error?.code === 'ENOENT' ? 'missing-executable' : 'spawn-error');
      entry.state = 'failed';
      entry.stoppedAt = entry.stoppedAt ?? clock();
      if (entry.cleanupStatus === 'pending') { entry.cleanupStatus = 'clean'; entry.cleanupReason = null; }
      clearTimers(entry);
      for (const resolve of entry.exitResolvers.splice(0)) resolve();
      notify(entry);
    });
    child.on('exit', (code, signal) => {
      entry.exited = true;
      entry.exitCode = Number.isInteger(code) ? code : null;
      entry.signal = signal ?? null;
      entry.stoppedAt = entry.stoppedAt ?? clock();
      if (!entry.failure && !entry.readyAt && !entry.stopping && entry.state === 'running') {
        // A process that ends before it ever became ready never served the gate.
        entry.failure = 'exited-before-ready';
        entry.state = 'failed';
      } else if (!entry.failure && entry.state !== 'failed') entry.state = entry.stopping ? 'stopped' : 'exited';
      if (entry.cleanupStatus === 'pending') { entry.cleanupStatus = 'clean'; entry.cleanupReason = null; }
      clearTimers(entry);
      for (const resolve of entry.exitResolvers.splice(0)) resolve();
      notify(entry);
    });

    if (readiness.kind === 'delay') entry.readinessTimer = setTimer(() => markReady(entry), readiness.ms);
    else if (readiness.kind === 'output') entry.readinessTimer = setTimer(() => {
      markFailure(entry, 'readiness-timeout');
      void terminate(entry, 'readiness-timeout');
    }, readiness.timeoutMs);
    entry.totalTimer = setTimer(() => {
      markFailure(entry, 'timeout');
      void terminate(entry, 'timeout');
    }, timeoutMs);

    entries.set(spec.id, entry);
    order.push(spec.id);
    return snapshot(entry);
  }

  function waitReady(handle) {
    const entry = lookup(handle);
    if (entry.state !== 'running') return Promise.resolve(snapshot(entry));
    return new Promise((resolve) => entry.waiters.push(() => resolve(snapshot(entry))));
  }

  function stop(handle, reason) {
    const entry = lookup(handle);
    string(reason, 'managedProcess.stopReason', { max: 2048 });
    if (TERMINAL_STATES.includes(entry.state) && entry.cleanupStatus === 'clean') return Promise.resolve(snapshot(entry));
    return terminate(entry, reason);
  }

  async function cleanupAll(reason) {
    string(reason, 'managedProcess.cleanupReason', { max: 2048 });
    const active = [...order].reverse().map((id) => entries.get(id)).filter((entry) => entry && !(TERMINAL_STATES.includes(entry.state) && entry.cleanupStatus === 'clean'));
    const cleaned = [];
    const forced = [];
    const failures = [];
    for (const entry of active) {
      const receipt = await terminate(entry, reason);
      cleaned.push(entry.id);
      if (receipt.forced) forced.push(entry.id);
      if (receipt.cleanup.status === 'failed') failures.push(entry.id);
    }
    return Object.freeze({ state: failures.length ? 'failed' : 'clean', cleaned: Object.freeze(cleaned), forced: Object.freeze(forced), failures: Object.freeze(failures), reason });
  }

  return Object.freeze({ start, waitReady, stop, cleanupAll });
}
