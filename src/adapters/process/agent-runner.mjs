import { spawn } from 'node:child_process';
import { digestFileInventory, resolvePath } from '../filesystem/index.mjs';

const IGNORED = new Set(['.git', 'node_modules', '.aicg-evaluation', 'dist', 'build', 'test-results', 'playwright-report']);

function inventory(root) { return digestFileInventory(root, { ignored: [...IGNORED] }); }

function changed(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter((entry) => before.get(entry) !== after.get(entry));
}

export function createAgentProcessRunner({ environment = process.env } = {}) {
  const active = new Map();
  return Object.freeze({
    async run(spec) {
      const cwd = resolvePath(spec.cwd ?? process.cwd());
      const trackWorkspace = Array.isArray(spec.artifactPaths ? Object.keys(spec.artifactPaths) : null);
      const before = trackWorkspace ? inventory(cwd) : null;
      const started = Date.now();
      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let bytes = 0;
        let settled = false;
        let timedOut = false;
        let overflow = false;
        let timer;
        const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd, env: environment, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        if (spec.turnId) active.set(spec.turnId, child);
        const finish = (exitCode, error = null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (spec.turnId) active.delete(spec.turnId);
          const after = before ? inventory(cwd) : null;
          resolve({
            exitCode: timedOut ? 124 : overflow ? 125 : Number.isInteger(exitCode) ? exitCode : (error?.code === 'ENOENT' ? 127 : 1),
            stdout,
            stderr: error ? `${stderr}${stderr ? '\n' : ''}${error.message}` : stderr,
            durationMs: Date.now() - started,
            changedPaths: before && after ? changed(before, after) : [],
            timedOut,
          });
        };
        const append = (kind, chunk) => {
          const text = String(chunk);
          bytes += Buffer.byteLength(text);
          if (bytes > (spec.maxOutputBytes ?? 2 * 1024 * 1024)) {
            overflow = true;
            stderr += '\nAgent output exceeded the configured byte budget.';
            child.kill('SIGTERM');
            return;
          }
          if (kind === 'stdout') stdout += text;
          else stderr += text;
        };
        child.stdout.on('data', (chunk) => append('stdout', chunk));
        child.stderr.on('data', (chunk) => append('stderr', chunk));
        child.on('error', (error) => finish(null, error));
        child.on('close', (code) => finish(code));
        child.stdin.end(String(spec.stdin ?? ''));
        timer = setTimeout(() => {
          timedOut = true;
          stderr += `\nAgent process exceeded ${spec.timeoutMs ?? 120000}ms.`;
          child.kill('SIGTERM');
        }, spec.timeoutMs ?? 120000);
      });
    },
    async cancel(turnId) {
      const child = active.get(turnId);
      if (!child) return { cancelled: false, turnId };
      const cancelled = child.kill('SIGTERM');
      return { cancelled, turnId };
    },
  });
}
