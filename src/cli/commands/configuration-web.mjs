import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { CONFIG_PATH, PACKAGE_ROOT } from '../../constants.mjs';
import { homeDirectory, listDirectories, listDirectoryEntries, lstatSafe, readText, recentProjects, rememberProject, resolveProjectDirectory, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { listenOnLoopback } from '../../adapters/http/index.mjs';
import { commandExists, openBrowserUrl, runCommand } from '../../adapters/process/commands.mjs';
import { randomToken, sha256, stableJson } from '../../shared/index.mjs';
import { scanProject } from '../../scanner.mjs';
import { classifyProject } from '../../project-assessment.mjs';
import { buildExecutionPlan } from '../../execution-plan.mjs';
import { buildTemplate, safeOutput } from './configuration.mjs';
import { applyRepositoryFamilyInit, detectsRepositoryFamily, initCommand, prepareInit, prepareRepositoryFamilyInit } from './init.mjs';
import { clientSupportFromClients, inspectManagedConfigTrust, loadExistingConfig, mergeConfig, normalizeClientSupport } from '../shared.mjs';

const CONFIG_FILE = 'aicg.config.json';
// Latest worker scan progress, read by GET /api/progress. One loopback server serves one local
// owner, so a single module-level slot is correct.
let scanProgress = null;
/**
 * The tool chooser's curated, ordered client list.
 *
 * These are the clients this owner installs, and the order is how the owner reads them
 * (`deepseek` first). `generic` stays in the registry and the CLI still supports it, but it
 * is not a page choice. Detection, generation and `--clients all` keep reading the registry,
 * so registering a client still needs no generator branch; this list only decides what the
 * visual editor offers.
 */
const CONFIG_UI_CLIENTS = ['deepseek', 'codex', 'cursor', 'claude-code', 'github-copilot'];
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

/**
 * Expand a registry path into a host path.
 *
 * Registry entries run on macOS, Windows and Linux, so they may use ~, POSIX $VAR or
 * Windows %VAR%. Separators are normalised to /, which Node filesystem calls accept on
 * every platform, so a Windows drive path stays comparable in unit tests.
 */
function expandPath(candidate, { home, env }) {
  let value = String(candidate)
    .replace(/[%]([A-Za-z_][A-Za-z0-9_]*)[%]/g, (match, name) => env[name] ?? match)
    .replace(/[$][{]([A-Za-z_][A-Za-z0-9_]*)[}]|[$]([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => env[braced ?? bare] ?? match);
  if (value === '~') value = home;
  else if (/^~[\\/]/.test(value)) value = home + '/' + value.slice(2);
  return value.split('\\').join('/');
}

/**
 * Clients present on this machine, in registry order.
 *
 * A CLI on PATH and a desktop app or user config directory are separate signals: desktop-only
 * installs (Codex, Claude Code, DSH) never expose a command, but the owner still uses them.
 * The command wins when both match so the evidence names the stronger signal. detect_paths runs
 * on every platform; detect_paths_by_platform[platform] only on that one.
 */
export function detectInstalledClients(registry, { commandExists: hasCommand, pathExists, home, platform = process.platform, env = process.env } = {}) {
  const present = [];
  for (const agent of registry.agents) {
    if (agent.id === 'generic') continue;
    const command = (agent.detect_commands ?? []).find((candidate) => hasCommand(candidate));
    if (command) { present.push({ id: agent.id, via: 'command' }); continue; }
    const candidates = [...(agent.detect_paths ?? []), ...((agent.detect_paths_by_platform ?? {})[platform] ?? [])];
    const match = candidates.map((candidate) => expandPath(candidate, { home, env })).find((candidate) => pathExists(candidate));
    if (match) present.push({ id: agent.id, via: 'path', path: match });
  }
  return present;
}

function probePathFor(home, platform, env) {
  const existing = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extra = [];
  if (platform === 'win32') {
    // npm installs global binaries under %APPDATA%/npm; per-user programs live under %LOCALAPPDATA%.
    for (const base of [env.APPDATA, env.LOCALAPPDATA]) if (base) extra.push(path.join(base, 'npm'), path.join(base, 'Programs'));
  } else {
    extra.push(path.join(home, '.npm-global/bin'), path.join(home, '.local/bin'), '/usr/local/bin');
    if (platform === 'darwin') extra.push('/opt/homebrew/bin');
    if (platform === 'linux') extra.push('/snap/bin');
  }
  return [...new Set([...existing, ...extra])].join(path.delimiter);
}

const WINDOWS_FOLDER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = "选择要配置的项目文件夹"',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
].join('; ');

/**
 * The OS folder chooser, so the owner can pick a project without typing a path.
 *
 * A browser cannot read the absolute path of a folder dropped onto the page, so a native
 * dialog is the only reliable selection route. Each platform uses the dialog it already ships.
 */
export function nativePickerCommand(platform = process.platform, { hasCommand = commandExists } = {}) {
  if (platform === 'darwin') {
    if (!hasCommand('osascript')) return null;
    return { command: 'osascript', args: ['-e', 'POSIX path of (choose folder with prompt "选择要配置的项目文件夹")'] };
  }
  if (platform === 'win32') {
    if (!hasCommand('powershell.exe')) return null;
    return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', WINDOWS_FOLDER_SCRIPT] };
  }
  if (platform === 'linux') {
    if (hasCommand('zenity')) return { command: 'zenity', args: ['--file-selection', '--directory', '--title=选择要配置的项目文件夹'] };
    if (hasCommand('kdialog')) return { command: 'kdialog', args: ['--getexistingdirectory', '--title', '选择要配置的项目文件夹'] };
    return null;
  }
  return null;
}

const SEARCH_SKIP = new Set(['node_modules', '.git', 'Library', '.Trash', '.cache', 'venv', '.venv', 'dist', 'build', '.next', 'target', 'Pods', '.gradle', '.npm', '.cargo', '.rustup', 'Applications', 'Movies', 'Music', 'Pictures']);

/**
 * Find a directory the browser dropped but cannot name by path.
 *
 * A browser hides the absolute path of a folder dragged from Finder, but it can read the folder
 * name and its immediate child names. Those are enough to locate a directory the server itself
 * can see, which keeps drag-and-drop working without silently falling back to a native dialog.
 * The walk is bounded by depth, directory count and a deadline so a large home stays responsive.
 */
export function locateDroppedDirectory({ name, entries = [] }, { home, recent = [], list = listDirectoryEntries, maxDepth = 5, maxDirectories = 5000, deadlineMs = 4000 } = {}) {
  const wanted = String(name ?? '').trim();
  if (!wanted || wanted === '.' || wanted === '..') return [];
  const fingerprint = entries.filter((entry) => entry && typeof entry.name === 'string').slice(0, 60);
  const matches = [];
  const seen = new Set();
  const consider = (directory, requireFingerprint) => {
    if (path.basename(directory) !== wanted) return;
    if (requireFingerprint && fingerprint.length === 0) return;
    const names = new Set(list(directory).map((entry) => entry.name));
    if (!fingerprint.every((entry) => names.has(entry.name))) return;
    if (seen.has(directory)) return;
    seen.add(directory);
    matches.push(directory);
  };
  for (const candidate of recent) if (candidate) consider(candidate, false);
  if (!home) return matches.slice(0, 10);
  const started = Date.now();
  const queue = [{ directory: home, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < maxDirectories && Date.now() - started < deadlineMs) {
    const { directory, depth } = queue.shift();
    visited += 1;
    consider(directory, true);
    if (depth >= maxDepth) continue;
    for (const child of list(directory)) {
      if (!child.dir || SEARCH_SKIP.has(child.name) || child.name.startsWith('.')) continue;
      queue.push({ directory: path.join(directory, child.name), depth: depth + 1 });
    }
  }
  return matches.slice(0, 10);
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

// Scanning a large or repository-family project blocks a synchronous call for a long time.
// Run it in a worker so the loopback server keeps answering /api/progress, and forward the
// throttled file counts the scanner emits. The returned scan keeps the caller's code path.
function scanWithProgress(root, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../modules/repository/scan-worker.mjs', import.meta.url), { workerData: { root, options } });
    worker.on('message', (message) => {
      if (message?.type === 'progress') { scanProgress = { ...message.progress, at: Date.now() }; return; }
      if (message?.type === 'result') { worker.terminate(); resolve(message.scan); }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => { if (code !== 0) reject(new Error('scan worker exited with code ' + code)); });
  });
}

// Scanning is the long part, so it runs in a worker and reports progress. Planning stays on
// the main thread because the preview carries a freshness closure the worker cannot clone.
async function prepared(root, config, { rebaseline = false } = {}) {
  const family = detectsRepositoryFamily(root);
  scanProgress = null;
  const scan = await scanWithProgress(root, {});
  const preview = await prepareInit(
    root,
    { yes: true, 'dry-run': true, skipCompletionAssist: true, replaceExisting: true, ...(rebaseline ? { rebaseline: true } : {}), ...(family ? { family: true, ...FAMILY_OPTIONS } : {}) },
    { suppliedConfig: config, providedScan: scan },
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
  const registry = JSON.parse(readText(path.join(PACKAGE_ROOT, 'assets/registries/agent-registry.json')));
  // Display follows the curated order; detection and the all-built-in scope keep registry order,
  // because the validator compares that scope set-for-set in registry order.
  const registryAgents = new Map(registry.agents.map((agent) => [agent.id, agent]));
  const agentEntries = CONFIG_UI_CLIENTS.map((id) => registryAgents.get(id)).filter(Boolean)
    .map(({ id, label, built_in }) => ({ id, label, builtIn: built_in === true }));
  const builtInClients = registry.agents.filter((agent) => agent.built_in === true).map((agent) => agent.id);
  // Default the owner's tool selection to what is actually installed on this machine, so a
  // fresh configuration starts from real evidence instead of a fixed Codex default. A GUI
  // launcher inherits a narrow PATH, so also probe the usual per-platform binary locations.
  const probeEnv = { ...process.env, PATH: probePathFor(homeDirectory(), process.platform, process.env) };
  const nativePicker = nativePickerCommand(process.platform, { hasCommand: (command) => commandExists(command, probeEnv) });
  const detected = detectInstalledClients(registry, {
    commandExists: (command) => commandExists(command, probeEnv),
    pathExists: (candidate) => Boolean(lstatSafe(candidate)),
    home: homeDirectory(),
  });
  // Keep registry order here (an all-built-in scope must match it), but drop clients the page
  // does not offer so a default selection never mentions a hidden tool.
  const detectedClients = detected.map((entry) => entry.id).filter((id) => CONFIG_UI_CLIENTS.includes(id));
  const bootstrap = () => {
    const common = { root: scan?.root ?? null, recent: recentProjects(), home: homeDirectory(), nativePicker: Boolean(nativePicker) };
    if (!scan) return common;
    const current = savedState(file);
    const managed = loadExistingConfig(scan.root);
    const template = buildTemplate(scan, 'zh-CN');
    const withDetectedClients = !managed && !current.config && detectedClients.length > 0
      ? { ...template, clients: detectedClients, clientSupport: clientSupportFromClients(detectedClients, 'inferred-default') }
      : template;
    // A greenfield project has no code to identify, so the owner picks the target stacks: the
    // page does not preselect the scanner's `generic-unknown` fallback. The saved configuration
    // still requires at least one stack, and the page enforces that before saving.
    const scanned = withDetectedClients.initialization?.lifecycle === 'greenfield' ? { ...withDetectedClients, stacks: [] } : withDetectedClients;
    // An applied governance framework is the canonical restore source: opening the page
    // reproduces the version that was actually applied, even when an editable draft also
    // exists. The draft is kept on disk for the owner and is never deleted here.
    const restored = managed ? mergeConfig(template, normalizeClientSupport(managed)) : (current.config ?? scanned);
    return { ...common, template: restored, config: current.config, sha: current.sha,
      configSource: managed ? 'managed' : current.config ? 'editable' : 'scan',
      scanComplete: scan.scanBudget?.complete !== false && (scan.governanceUnits ?? []).every((unit) => ['scanned', 'uninitialized'].includes(unit.status)),
      assessment: classifyProject(scan),
      repositoryFamily: familyFromScan(scan),
      builtInClients,
      // Read-only: the page explains a drifted baseline instead of only echoing the write gate.
      managedTrust: inspectManagedConfigTrust(scan.root),
      detectedClients,
      agents: agentEntries,
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
        // Read-only surfaces stay available while a long scan or plan holds the write lock, so
        // the page can keep showing live progress. They never mutate state and never take the
        // lock; only mutating operations are serialized.
        if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
          return send(response, 200, bootstrap());
        }
        if (request.method === 'GET' && url.pathname === '/api/progress') {
          return send(response, 200, { progress: scanProgress });
        }
        if (request.method === 'GET' && url.pathname === '/api/directories') {
          return send(response, 200, listDirectories(url.searchParams.get('path') ?? homeDirectory()));
        }
        if (busy) return send(response, 409, { error: 'Another operation is running.' });
        busy = true;
        try {
          if (request.method === 'POST' && url.pathname === '/api/choose-folder') {
            if (!nativePicker) return send(response, 501, { error: '本机没有可用的系统文件夹选择框，请手动输入路径。' });
            const picked = runCommand(nativePicker.command, nativePicker.args, { encoding: 'utf8', timeout: 300000, env: probeEnv });
            let selected = picked.error || picked.status !== 0 ? '' : String(picked.stdout ?? '').trim();
            while (selected.length > 1 && selected.endsWith('/')) selected = selected.slice(0, -1);
            return selected ? send(response, 200, { path: selected }) : send(response, 200, { cancelled: true });
          }
          if (request.method === 'POST' && url.pathname === '/api/locate') {
            const { name, entries } = await readBody(request);
            const matches = locateDroppedDirectory({ name, entries }, { home: homeDirectory(), recent: recentProjects() });
            return send(response, 200, { matches });
          }
          if (request.method === 'POST' && url.pathname === '/api/project') {
            const { path: candidate } = await readBody(request);
            scanProgress = null;
            const selected = await scanWithProgress(resolveProjectDirectory(candidate), {});
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
            const { members: requestedMembers } = await readBody(request).catch(() => ({}));
            const current = savedState(file);
            if (!current.config) return send(response, 400, { error: 'Save the configuration before previewing.' });
            const result = await prepared(scan.root, current.config);
            if (result.family) {
              const memberFilter = Array.isArray(requestedMembers) ? requestedMembers : null;
              const family = await prepareRepositoryFamilyInit(result, memberFilter ? { ...FAMILY_OPTIONS, members: memberFilter } : FAMILY_OPTIONS);
              const state = familyFromScan(result.scan);
              lastPreview = { sha: current.sha, hash: family.combined.planHash, family: true, members: memberFilter };
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
              const family = await prepareRepositoryFamilyInit(result, lastPreview.members ? { ...FAMILY_OPTIONS, members: lastPreview.members } : FAMILY_OPTIONS);
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
          if (request.method === 'POST' && url.pathname === '/api/rebaseline') {
            const { config, expectedSha } = await readBody(request);
            const current = savedState(file);
            if (expectedSha !== current.sha) return send(response, 409, { error: 'Configuration changed on disk. Reload before rebuilding the baseline.' });
            const trust = inspectManagedConfigTrust(scan.root);
            if (trust.state !== 'drifted' && trust.state !== 'unrecorded') return send(response, 409, { error: 'No drifted managed configuration to rebuild.' });
            const managedPath = path.join(scan.root, CONFIG_PATH);
            const previous = lstatSafe(managedPath)?.isFile() ? readText(managedPath) : null;
            // Validate the page's in-memory configuration before touching any file: a failed rebuild
            // leaves the editable draft byte-identical, so the page's sha stays valid and a retry
            // is not blocked by "Configuration changed on disk".
            const preview = await prepared(scan.root, config, { rebaseline: true });
            // A rebuild touches the same artifacts as an ordinary apply, so it shares the exact-plan
            // options; members inherit replace/rebaseline through prepareRepositoryFamilyMembers.
            const rebaselineOptions = { ...FAMILY_OPTIONS, replaceExisting: true, rebaseline: true };
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupUnit = (unitRoot, unitPath) => {
              const source = path.join(unitRoot, CONFIG_PATH);
              if (!lstatSafe(source)?.isFile()) return null;
              const relative = `reports/aicg/rebaseline-backup/config-${stamp}.json`;
              writeAtomicFile(path.join(unitRoot, relative), readText(source));
              return unitPath === '.' ? relative : `${unitPath}/${relative}`;
            };
            const skillManagementDropped = (value) => {
              const appliedManaged = readText(path.join(scan.root, CONFIG_PATH), '');
              const appliedConfig = appliedManaged ? JSON.parse(appliedManaged) : {};
              return Boolean((value.skillDiscovery?.enabled || value.agentTeam?.enabled)
                && !appliedConfig.skillDiscovery?.enabled && !appliedConfig.agentTeam?.enabled);
            };
            try {
              if (preview.family) {
                const family = await prepareRepositoryFamilyInit(preview, rebaselineOptions);
                const backupPaths = family.all.map((entry) => backupUnit(entry.scan.root, entry.path)).filter(Boolean);
                const units = applyRepositoryFamilyInit(family, rebaselineOptions);
                lastPreview = null;
                const appliedManaged = readText(managedPath, '');
                if (appliedManaged) writeAtomicFile(file, appliedManaged);
                return send(response, 200, { rebaselined: true, family: true, skillManagementDropped: skillManagementDropped(config),
                  planHash: family.combined.planHash, units, backupPaths, sha: savedState(file).sha });
              }
              const plan = execution(preview);
              const backupRelative = backupUnit(scan.root, '.');
              const applied = await initCommand(scan.root, { suppliedConfig: config, yes: true, approve: plan.planHash, skipCompletionAssist: true, review: true, replaceExisting: true, rebaseline: true });
              lastPreview = null;
              // Keep the editable draft identical to the config that was just applied, so the next
              // preview does not read a stale decision receipt.
              const appliedManaged = readText(managedPath, '');
              if (appliedManaged) writeAtomicFile(file, appliedManaged);
              const appliedConfig = appliedManaged ? JSON.parse(appliedManaged) : {};
              const dropped = Boolean((config.skillDiscovery?.enabled || config.agentTeam?.enabled)
                && !appliedConfig.skillDiscovery?.enabled && !appliedConfig.agentTeam?.enabled);
              return send(response, 200, { rebaselined: true, family: false, skillManagementDropped: dropped, planHash: plan.planHash, sha: savedState(file).sha,
                backupPath: backupRelative, backupPaths: backupRelative ? [backupRelative] : [],
                governanceReview: applied.governanceReview ? {
                  status: applied.governanceReview.independentReview.status,
                  score: applied.governanceReview.score.score,
                  scoreStatus: applied.governanceReview.score.status,
                  reportPath: applied.governanceReview.reportPath,
                } : null });
            } catch (error) {
              // The write transaction restores its own preimages; this is the safety net for the
              // root config when a failure happens before or outside that transaction.
              try { if (previous !== null && readText(managedPath, '') !== previous) writeAtomicFile(managedPath, previous); } catch { /* best effort */ }
              throw error;
            }
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
