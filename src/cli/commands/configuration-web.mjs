import path from 'node:path';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { homeDirectory, listDirectories, lstatSafe, readText, recentProjects, rememberProject, resolveProjectDirectory, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { listenOnLoopback } from '../../adapters/http/index.mjs';
import { openBrowserUrl } from '../../adapters/process/commands.mjs';
import { randomToken, sha256, stableJson } from '../../shared/index.mjs';
import { scanProject } from '../../scanner.mjs';
import { classifyProject } from '../../project-assessment.mjs';
import { buildExecutionPlan } from '../../execution-plan.mjs';
import { buildTemplate, safeOutput } from './configuration.mjs';
import { applyRepositoryFamilyInit, detectsRepositoryFamily, initCommand, prepareInit, prepareRepositoryFamilyInit } from './init.mjs';
import { loadExistingConfig, mergeConfig, normalizeClientSupport } from '../shared.mjs';

const CONFIG_FILE = 'aicg.config.json';
const MAX_BODY = 128 * 1024;
const IDLE_MS = 30 * 60 * 1000;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/selector.css', ['selector.css', 'text/css; charset=utf-8']],
  ['/progress.css', ['progress.css', 'text/css; charset=utf-8']],
]);

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function savedState(file) {
  const stat = lstatSafe(file);
  if (!stat) return { content: null, sha: null, config: null };
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BODY) throw new Error('Configuration must be a regular JSON file smaller than 128 KiB.');
  const content = readText(file);
  return { content, sha: sha256(content), config: JSON.parse(content) };
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Configuration request exceeds 128 KiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Repository-family members are generated deterministically; the same options must be used
// for the preview and for the apply, because the combined plan hash binds both.
const FAMILY_OPTIONS = Object.freeze({ yes: true, 'no-assist': true });

function familyFromScan(scan) {
  if (!scan || scan.projectMode !== 'repository-family') return { family: false, members: [], skipped: [] };
  const units = scan.governanceUnits ?? [];
  return {
    family: units.some((unit) => unit.status === 'scanned'),
    members: units.filter((unit) => unit.status === 'scanned').map((unit) => unit.path),
    skipped: units.filter((unit) => unit.status !== 'scanned').map((unit) => unit.path),
  };
}

async function prepared(root, config) {
  const family = detectsRepositoryFamily(root);
  const preview = await prepareInit(
    root,
    { yes: true, 'dry-run': true, skipCompletionAssist: true, replaceExisting: true, ...(family ? { family: true, ...FAMILY_OPTIONS } : {}) },
    { suppliedConfig: config },
  );
  return { ...preview, family, assistSuppressed: family && config?.features?.aiAssist === true };
}

function execution(preview) {
  return buildExecutionPlan({
    intent: { id: 'governance.initialize', handler: 'init', mode: 'write' },
    scan: preview.scan,
    artifactPlan: preview.plan,
    config: preview.config,
  });
}

export async function openConfigurationPage(root, options = {}) {
  let scan = null;
  let file = null;
  if (root !== null) {
    scan = scanProject(resolveProjectDirectory(root), { probeEnvironment: false });
    file = safeOutput(scan.root, CONFIG_FILE);
    try { rememberProject(scan.root); } catch { /* Recent history is optional. */ }
  }
  const token = randomToken();
  let server;
  let timer;
  let lastPreview = null;
  let busy = false;
  const bootstrap = () => {
    const common = { root: scan?.root ?? null, recent: recentProjects(), home: homeDirectory() };
    if (!scan) return common;
    const current = savedState(file);
    const managed = loadExistingConfig(scan.root);
    const template = buildTemplate(scan, 'zh-CN');
    const suggested = managed ? mergeConfig(template, normalizeClientSupport(managed)) : template;
    return { ...common, template: suggested, config: current.config, sha: current.sha,
      configSource: current.config ? 'editable' : managed ? 'managed' : 'scan',
      scanComplete: scan.scanBudget?.complete !== false && (scan.governanceUnits ?? []).every((unit) => ['scanned', 'uninitialized'].includes(unit.status)),
      assessment: classifyProject(scan),
      repositoryFamily: familyFromScan(scan),
      agents: JSON.parse(readText(path.join(PACKAGE_ROOT, 'assets/registries/agent-registry.json'))).agents.map(({ id, label }) => ({ id, label })),
      stacks: JSON.parse(readText(path.join(PACKAGE_ROOT, 'assets/registries/capability-pack-registry.json'))).packs.map(({ id, family }) => ({ id, family })) };
  };
  const close = () => {
    clearTimeout(timer);
    server?.close();
    server?.closeAllConnections();
  };
  const refreshIdle = () => {
    if (!options['auto-exit']) return;
    clearTimeout(timer);
    timer = setTimeout(close, IDLE_MS);
    timer.unref();
  };
  server = await listenOnLoopback(async (request, response) => {
    refreshIdle();
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== host) return send(response, 403, { error: 'Invalid local host.' });
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (request.headers['x-aicg-session'] !== token) return send(response, 403, { error: 'Invalid session.' });
        if (request.method === 'POST' && request.headers.origin !== `http://${host}`) return send(response, 403, { error: 'Invalid origin.' });
        if (busy) return send(response, 409, { error: 'Another operation is running.' });
        busy = true;
        try {
          if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
            return send(response, 200, bootstrap());
          }
          if (request.method === 'GET' && url.pathname === '/api/directories') {
            return send(response, 200, listDirectories(url.searchParams.get('path') ?? homeDirectory()));
          }
          if (request.method === 'POST' && url.pathname === '/api/project') {
            const { path: candidate } = await readBody(request);
            const selected = scanProject(resolveProjectDirectory(candidate), { probeEnvironment: false });
            const selectedFile = safeOutput(selected.root, CONFIG_FILE);
            savedState(selectedFile);
            scan = selected;
            file = selectedFile;
            lastPreview = null;
            try { rememberProject(scan.root); } catch { /* Recent history is optional. */ }
            return send(response, 200, bootstrap());
          }
          if (request.method === 'POST' && url.pathname === '/api/close') {
            send(response, 200, { closed: true });
            setImmediate(close);
            return;
          }
          if (!scan) return send(response, 409, { error: 'Select a project directory first.' });
          if (request.method === 'POST' && url.pathname === '/api/validate') {
            const { config } = await readBody(request);
            const result = await prepared(scan.root, config);
            return send(response, 200, { valid: true, lifecycle: result.config.initialization.lifecycle, operations: result.plan.operations.length, conflicts: result.plan.conflicts });
          }
          if (request.method === 'POST' && url.pathname === '/api/save') {
            const { config, expectedSha } = await readBody(request);
            const current = savedState(file);
            if (expectedSha !== current.sha) return send(response, 409, { error: 'Configuration changed on disk. Reload before saving.' });
            await prepared(scan.root, config);
            const content = `${stableJson(config)}\n`;
            writeAtomicFile(file, content);
            lastPreview = null;
            return send(response, 200, { saved: true, sha: sha256(content) });
          }
          if (request.method === 'POST' && url.pathname === '/api/preview') {
            const current = savedState(file);
            if (!current.config) return send(response, 400, { error: 'Save the configuration before previewing.' });
            const result = await prepared(scan.root, current.config);
            if (result.family) {
              const family = await prepareRepositoryFamilyInit(result, FAMILY_OPTIONS);
              const state = familyFromScan(result.scan);
              lastPreview = { sha: current.sha, hash: family.combined.planHash, family: true };
              return send(response, 200, {
                family: true,
                planHash: family.combined.planHash,
                units: family.combined.units,
                members: state.members,
                files: family.combined.executions.flatMap(({ path: unitPath, execution: unitExecution }) => unitExecution.operations
                  .filter((operation) => operation.kind !== 'manifest')
                  .map(({ path: relative, action }) => ({ path: unitPath === '.' ? relative : `${unitPath}/${relative}`, action, changed: action !== 'keep', unit: unitPath }))),
                conflicts: family.all.flatMap((entry) => entry.plan.conflicts.map((conflict) => `${entry.path}: ${conflict}`)),
                requiredPermissions: [...new Set(family.combined.units.flatMap((unit) => unit.requiredPermissions))],
                linksToMigrate: [],
                skippedMembers: state.skipped,
                notices: result.assistSuppressed
                  ? ['This repository family is generated deterministically, so AI assist is skipped. Run AI completion separately per member.']
                  : [],
              });
            }
            const plan = execution(result);
            lastPreview = { sha: current.sha, hash: plan.planHash, family: false };
            return send(response, 200, { planHash: plan.planHash, files: plan.operations.filter((entry) => entry.kind !== 'manifest').map(({ path: relative, action }) => ({ path: relative, action, changed: action !== 'keep' })),
              conflicts: result.plan.conflicts, requiredPermissions: plan.requiredPermissions, linksToMigrate: plan.linksToMigrate,
              skippedMembers: (result.scan.governanceUnits ?? []).filter((unit) => unit.status === 'uninitialized').map((unit) => unit.path) });
          }
          if (request.method === 'POST' && url.pathname === '/api/apply') {
            const { planHash } = await readBody(request);
            const current = savedState(file);
            if (!current.config || !lastPreview || lastPreview.sha !== current.sha || lastPreview.hash !== planHash) return send(response, 409, { error: 'Preview the saved configuration again before applying.' });
            if (lastPreview.family) {
              const result = await prepared(scan.root, current.config);
              const family = await prepareRepositoryFamilyInit(result, FAMILY_OPTIONS);
              if (family.combined.planHash !== planHash) return send(response, 409, { error: 'The family plan changed since the preview. Preview again before applying.' });
              lastPreview = null;
              const units = applyRepositoryFamilyInit(family, FAMILY_OPTIONS);
              return send(response, 200, { applied: true, family: true, planHash, units, governanceReview: null });
            }
            lastPreview = null;
            const applied = await initCommand(scan.root, { config: file, yes: true, approve: planHash, skipCompletionAssist: true, review: true, replaceExisting: true });
            return send(response, 200, { applied: true, planHash,
              governanceReview: applied.governanceReview ? {
                status: applied.governanceReview.independentReview.status,
                score: applied.governanceReview.score.score,
                scoreStatus: applied.governanceReview.score.status,
                reportPath: applied.governanceReview.reportPath,
              } : null });
          }
          return send(response, 404, { error: 'Unknown API route.' });
        } finally { busy = false; }
      }
      if (request.method !== 'GET' || !ASSETS.has(url.pathname)) return send(response, 404, { error: 'Not found.' });
      const [name, contentType] = ASSETS.get(url.pathname);
      const content = readText(path.join(PACKAGE_ROOT, 'assets/config-ui', name)).replaceAll('__AICG_SESSION__', token);
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      response.end(content);
    } catch (error) { send(response, 400, { error: error.message, verificationErrors: error.verification?.errors ?? [] }); }
  });
  refreshIdle();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const opened = options['no-open'] ? false : await openBrowserUrl(url);
  console.log(options.json ? JSON.stringify({ url, root: scan?.root ?? null, opened }) : `AICG configuration: ${url}\nProject: ${scan?.root ?? 'choose in the browser'}${opened ? '' : '\nOpen this URL in your browser.'}`);
  return new Promise((resolve) => server.once('close', resolve));
}
