import path from 'node:path';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { readText, resolveProjectDirectory } from '../../adapters/filesystem/index.mjs';
import { listenOnLoopback } from '../../adapters/http/index.mjs';
import { openBrowserUrl } from '../../adapters/process/commands.mjs';
import { projectDeliveryInspection } from '../../modules/delivery-core/index.mjs';
import { listDeliveryInspections, readDeliveryInspection } from '../../modules/delivery-inspection/index.mjs';
import { prepareDeliverySessionStart, startDeliverySession } from '../../modules/delivery-start/index.mjs';
import { randomToken } from '../../shared/index.mjs';

const MAX_BODY = 16 * 1024;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function headers(contentType, extra = {}) {
  return { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, ...extra };
}

function json(response, status, value, extra = {}, head = false) {
  response.writeHead(status, headers('application/json; charset=utf-8', extra));
  response.end(head ? undefined : JSON.stringify(value));
}

function error(response, status, code, message, extra = {}) {
  json(response, status, { ok: false, error: { code, message } }, extra);
}

async function readJson(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
    throw Object.assign(new Error('JSON content type is required.'), { status: 415, errorCode: 'unsupported-media-type' });
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY) throw Object.assign(new Error('Request exceeds 16 KiB.'), { status: 413, errorCode: 'request-too-large' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request exceeds 16 KiB.'), { status: 413, errorCode: 'request-too-large' });
    chunks.push(chunk);
  }
  try {
    const bytes = Buffer.concat(chunks);
    const value = bytes.toString('utf8');
    if (Buffer.from(value, 'utf8').compare(bytes) !== 0) throw new Error('invalid UTF-8');
    return JSON.parse(value);
  } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400, errorCode: 'invalid-request' }); }
}

function mappedError(value) {
  if (value.status && value.errorCode) return { status: value.status, code: value.errorCode, message: value.message };
  if (value.deliveryStartCode === 'idempotency-conflict') return { status: 409, code: 'idempotency-conflict', message: 'This submission key belongs to different input.' };
  if (value.deliveryStartCode === 'stale-preview') return { status: 409, code: 'stale-preview', message: 'Preview expired; preview again before submitting.' };
  if (value.deliveryStartCode === 'publication-unresolved') return { status: 409, code: 'publication-unresolved', message: 'Session publication is unresolved; retry the original submission or seek manual recovery.' };
  if (value.code === 'AICG_USAGE' && !/incomplete|unreadable|published input binding|already exists/i.test(value.message)) return { status: 400, code: 'invalid-request', message: 'Invalid delivery start request.' };
  return { status: 500, code: 'persistence-failed', message: 'Delivery session could not be safely persisted or read.' };
}

function requestFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw Object.assign(new Error('Invalid delivery start request.'), { status: 400, errorCode: 'invalid-request' });
  }
  return value;
}

function studioPreviewRequest(value) { return requestFields(value, ['requestText', 'profile']); }
function studioStartRequest(value) { return requestFields(value, ['requestText', 'profile', 'previewDigest', 'idempotencyKey']); }

function apiRoute(root, request, response, pathname, head) {
  if (pathname === '/api/v1/delivery-sessions' && (request.method === 'GET' || head)) {
    return json(response, 200, { ok: true, data: listDeliveryInspections(root) }, {}, head);
  }
  if (pathname.startsWith('/api/v1/delivery-sessions/') && (request.method === 'GET' || head)) {
    const id = pathname.slice('/api/v1/delivery-sessions/'.length);
    if (!SESSION_ID.test(id)) return error(response, 400, 'invalid-request', 'Invalid session id.');
    return json(response, 200, { ok: true, data: readDeliveryInspection(root, id) }, {}, head);
  }
  return false;
}

export async function openStudioPage(target, options = {}) {
  const root = resolveProjectDirectory(path.resolve(target));
  const token = randomToken();
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const clock = options.clock ?? globalThis;
  let server;
  let closeResolve;
  let idleTimer;
  let idleGeneration = 0;
  let activeRequests = 0;
  let closing = false;
  const closed = new Promise((resolve) => { closeResolve = resolve; });
  const clearIdle = () => {
    idleGeneration += 1;
    if (idleTimer !== undefined) clock.clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const close = () => {
    if (closing) return;
    closing = true;
    clearIdle();
    server.close();
    server.closeAllConnections();
  };
  const armIdle = () => {
    clearIdle();
    if (closing || activeRequests > 0) return;
    const generation = idleGeneration;
    idleTimer = clock.setTimeout(() => {
      if (closing || generation !== idleGeneration || activeRequests > 0) return;
      close();
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };
  server = await listenOnLoopback(async (request, response) => {
    clearIdle();
    activeRequests += 1;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      activeRequests -= 1;
      if (activeRequests === 0) armIdle();
    };
    response.once('finish', settle);
    response.once('close', settle);
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== host) return error(response, 403, 'invalid-host', 'Invalid local host.');
      if (typeof request.url !== 'string' || request.url.length > 512) return error(response, 400, 'invalid-request', 'Invalid URL.');
      const url = new URL(request.url, `http://${host}`);
      if (url.search) return error(response, 400, 'invalid-request', 'Query parameters are not supported.');
      const pathname = url.pathname;
      const head = request.method === 'HEAD';
      if (pathname.startsWith('/api/')) {
        if (request.headers['x-aicg-session'] !== token) return error(response, 403, 'invalid-session', 'Invalid local session.');
        const writeRoute = pathname === '/api/v1/delivery-sessions/preview' || pathname === '/api/v1/delivery-sessions';
        if (request.method === 'POST') {
          if (!writeRoute) return error(response, 405, 'method-not-allowed', 'Method not allowed.', { allow: 'GET, HEAD' });
          if (request.headers.origin !== `http://${host}`) return error(response, 403, 'invalid-origin', 'Invalid request origin.');
          const body = await readJson(request);
          if (pathname.endsWith('/preview')) {
            const data = prepareDeliverySessionStart(root, studioPreviewRequest(body));
            return json(response, 200, { ok: true, data });
          }
          const fields = studioStartRequest(body);
          const result = startDeliverySession(root, { ...fields, source: 'studio' });
          const data = { sessionId: result.session.id, replayed: result.replayed, inspection: projectDeliveryInspection(result.session) };
          return json(response, result.replayed ? 200 : 201, { ok: true, data });
        }
        if (writeRoute && request.method !== 'GET' && !head) return error(response, 405, 'method-not-allowed', 'Method not allowed.', { allow: pathname.endsWith('/preview') ? 'POST' : 'GET, HEAD, POST' });
        if (!writeRoute && pathname.startsWith('/api/v1/delivery-sessions/') && request.method !== 'GET' && !head) return error(response, 405, 'method-not-allowed', 'Method not allowed.', { allow: 'GET, HEAD' });
        if ((request.method === 'GET' || head) && pathname.endsWith('/preview')) return error(response, 405, 'method-not-allowed', 'Method not allowed.', { allow: 'POST' });
        const result = apiRoute(root, request, response, pathname, head);
        if (result !== false) return result;
        return error(response, 404, 'not-found', 'Unknown API route.');
      }
      if (!ASSETS.has(pathname)) return error(response, 404, 'not-found', 'Not found.');
      if (request.method !== 'GET' && !head) return error(response, 405, 'method-not-allowed', 'Method not allowed.', { allow: 'GET, HEAD' });
      const [file, contentType] = ASSETS.get(pathname);
      const content = readText(path.join(PACKAGE_ROOT, 'assets/studio', file)).replaceAll('__AICG_SESSION__', token);
      response.writeHead(200, headers(contentType));
      return response.end(head ? undefined : content);
    } catch (cause) {
      const mapped = mappedError(cause);
      return error(response, mapped.status, mapped.code, mapped.message);
    }
  });
  server.once('close', () => {
    closing = true;
    clearIdle();
    closeResolve();
  });
  armIdle();
  return Object.freeze({
    url: `http://127.0.0.1:${server.address().port}/`,
    root,
    closed,
    close,
  });
}

export async function studioCommand(target, options = {}) {
  const studio = await openStudioPage(target);
  const opened = options['no-open'] ? false : await openBrowserUrl(studio.url);
  console.log(options.json ? JSON.stringify({ url: studio.url, root: studio.root, opened }) : `AICG Studio: ${studio.url}${opened ? '' : '\nOpen this URL in your browser.'}`);
  return studio.closed;
}
